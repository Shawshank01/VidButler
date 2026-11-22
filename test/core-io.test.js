import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { attachLineStreamFilters } from '../src/core/log-filter.ts';
import { findHardsubSourceFiles, findMatchingThumbnail } from '../src/core/media-files.ts';
import { buildFfmpegHardsubArgs, buildFfmpegReEncodeArgs } from '../src/core/ffmpeg.ts';
import { taskManager } from '../src/core/task-manager.ts';
import { cancelCurrentTask, listSubtitles, runYtDlp } from '../src/core/tools.ts';

async function makeFolder(files) {
    const dir = await fs.mkdtemp(join(tmpdir(), 'ytdl-core-io-test-'));
    for (const [name, mtime] of Object.entries(files)) {
        const path = join(dir, name);
        await fs.writeFile(path, 'x');
        await fs.utimes(path, mtime, mtime);
    }
    return dir;
}

// ---------- output decoding ----------

test('line filters keep multi-byte characters that are split across chunks intact', () => {
    const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    const lines = [];
    const flush = attachLineStreamFilters(child, (line) => lines.push(line));

    const bytes = Buffer.from('[download] Destination: 日本語のタイトル 🎬.mp4\nnext line\n', 'utf8');
    // Cut inside the three-byte character "本" and inside the four-byte emoji.
    const cutInCjk = bytes.indexOf(Buffer.from('本')) + 1;
    const cutInEmoji = bytes.indexOf(Buffer.from('🎬')) + 2;
    child.stdout.emit('data', bytes.subarray(0, cutInCjk));
    child.stdout.emit('data', bytes.subarray(cutInCjk, cutInEmoji));
    child.stdout.emit('data', bytes.subarray(cutInEmoji));
    flush();

    assert.deepEqual(lines, ['[download] Destination: 日本語のタイトル 🎬.mp4', 'next line']);
});

test('line filters deliver a final line that has no trailing newline when flushed', () => {
    const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    const lines = [];
    const flush = attachLineStreamFilters(child, (line) => lines.push(line));
    child.stderr.emit('data', Buffer.from('ERROR: something'));
    assert.deepEqual(lines, []);
    flush();
    assert.deepEqual(lines, ['ERROR: something']);
});

// ---------- hardsub source discovery ----------

test('hardsub source discovery never picks a file the app produced itself', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 60_000);
    // The files the app produces are the newest in the folder; the real source is older.
    const folder = await makeFolder({
        'Talk.mp4': older,
        'Talk.en.vtt': older,
        'Talk_H264.mp4': now,
        'Talk_HEVC.mp4': now,
        'Talk_H264_temp.mp4': now,
        'Talk_hardsub.mp4': now
    });
    const found = await findHardsubSourceFiles(folder, 'en', null);
    assert.equal(found.videoFile, 'Talk.mp4');
    assert.equal(found.subtitlePath, join(folder, 'Talk.en.vtt'));
});

test('hardsub source discovery still accepts a source whose title merely mentions H264', async () => {
    const folder = await makeFolder({
        'H264 explained.mp4': new Date(),
        'H264 explained.en.vtt': new Date()
    });
    const found = await findHardsubSourceFiles(folder, 'en', null);
    assert.equal(found.videoFile, 'H264 explained.mp4');
});

test('thumbnail lookup prefers an exact name and otherwise a name that starts with the video name', () => {
    assert.equal(findMatchingThumbnail(['a.mp4', 'a.webp', 'a.jpg'], 'a'), 'a.jpg');
    assert.equal(findMatchingThumbnail(['a.mp4', 'a (1).png'], 'a'), 'a (1).png');
    assert.equal(findMatchingThumbnail(['a.mp4', 'b.jpg'], 'a'), null);
});

// ---------- yt-dlp arguments ----------

test('listing subtitles asks yt-dlp for the single video, not every entry of a playlist link', {
    skip: process.platform === 'win32' ? 'uses a shell-script stand-in for yt-dlp' : false
}, async () => {
    const binDir = await fs.mkdtemp(join(tmpdir(), 'ytdl-fake-bin-'));
    const argsFile = join(binDir, 'args.txt');
    const info = JSON.stringify({ subtitles: { en: [{ name: 'English' }] } });
    await fs.writeFile(
        join(binDir, 'yt-dlp'),
        `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > '${argsFile}'\nprintf '%s' '${info}'\n`,
        { mode: 0o755 }
    );

    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath}`;
    try {
        const res = await listSubtitles('https://www.youtube.com/watch?v=abc&list=PL123', '', '');
        assert.equal(res.success, true, res.message);
        assert.deepEqual(res.subtitles, [{ code: 'en', name: 'English', type: 'manual' }]);
    } finally {
        process.env.PATH = oldPath;
    }

    const args = (await fs.readFile(argsFile, 'utf8')).split('\n').filter(Boolean);
    assert.ok(args.includes('--no-playlist'), `yt-dlp was called with: ${args.join(' ')}`);
    assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=abc&list=PL123');
});

test('cancelling yt-dlp also stops a downloader child process', {
    skip: process.platform === 'win32' ? 'uses a POSIX process group' : false
}, async (t) => {
    const binDir = await fs.mkdtemp(join(tmpdir(), 'ytdl-cancel-bin-'));
    const oldPath = process.env.PATH;
    t.after(async () => {
        process.env.PATH = oldPath;
        await fs.rm(binDir, { recursive: true, force: true });
    });
    await fs.writeFile(join(binDir, 'yt-dlp'), `#!/bin/sh
sleep 30 &
printf '[download] %s\\n' "$!"
wait
`, { mode: 0o755 });
    process.env.PATH = `${binDir}:${oldPath}`;

    let childPid;
    let stoppedInTime = true;
    const cleanup = setTimeout(() => {
        stoppedInTime = false;
        if (childPid) process.kill(childPid, 'SIGKILL');
    }, 3000);
    try {
        const result = await runYtDlp([], (line) => {
            childPid = Number(line.split(' ')[1]);
            cancelCurrentTask();
        });
        assert.ok(childPid);
        assert.deepEqual(result, {
            success: false,
            cancelled: true,
            code: -1,
            output: 'Action cancelled by user.',
            error: 'Action cancelled by user.'
        });
        assert.ok(stoppedInTime, 'the child downloader kept running after cancellation');
    } finally {
        clearTimeout(cleanup);
    }
});

test('cancelling before spawn keeps the media lock until the cancelled task ends', () => {
    const task = taskManager.startTask('hardsub');
    try {
        assert.equal(cancelCurrentTask(), true);
        assert.throws(() => taskManager.spawnProcess(task, 'ffmpeg', []), /cancelled by user/);
        assert.throws(() => taskManager.startTask('run-command'), /Another task is already running/);
    } finally {
        taskManager.endTask(task);
    }

    const next = taskManager.startTask('run-command');
    try {
        assert.equal(next.isCancelled, false);
        assert.equal(next.isDone, false);
    } finally {
        taskManager.endTask(next);
    }
    assert.equal(cancelCurrentTask(), false);
});

// ---------- ffmpeg arguments ----------

test('re-encode and hardsub commands overwrite their temporary output instead of waiting for a prompt', () => {
    const reEncode = buildFfmpegReEncodeArgs({ filePath: '/in.mp4', outputPath: '/out.mp4', audioCodec: 'aac' });
    assert.equal(reEncode[0], '-y');
    assert.equal(reEncode.at(-1), '/out.mp4');
    assert.deepEqual(reEncode.slice(1, 3), ['-i', '/in.mp4']);

    for (const thumbnailPath of [null, '/thumb.jpg']) {
        const hardsub = buildFfmpegHardsubArgs({
            videoPath: '/in.mp4',
            outputPath: '/out.mp4',
            subtitlePath: '/in.en.vtt',
            thumbnailPath,
            codec: 'h264',
            audioCodec: 'aac'
        });
        assert.equal(hardsub[0], '-y');
        assert.equal(hardsub.at(-1), '/out.mp4');
        assert.deepEqual(hardsub.slice(1, 3), ['-i', '/in.mp4']);
    }
});

test('hardsub uses the shared resolution tiers and keeps the original bitrates when dimensions are unknown', () => {
    for (const [codec, videoHeight, thumbnailPath, bitrate] of [
        ['h264', undefined, null, '5000k'],
        ['hevc', undefined, null, '3000k'],
        ['h264', 1080, null, '8000k'],
        ['hevc', 1080, '/thumb.jpg', '4800k'],
        ['h264', 2160, '/thumb.jpg', '24000k'],
        ['hevc', 2160, null, '14400k']
    ]) {
        const args = buildFfmpegHardsubArgs({
            videoPath: '/in.mp4', outputPath: '/out.mp4', subtitlePath: '/in.en.vtt',
            thumbnailPath, codec, audioCodec: 'aac_at', videoHeight
        });
        const stream = thumbnailPath ? ':0' : '';
        assert.equal(args[args.indexOf(`-b:v${stream}`) + 1], bitrate);
        assert.equal(args[args.indexOf(`-c:a${stream}`) + 1], 'aac_at');
        assert.equal(args[args.indexOf('-aac_at_mode') + 1], 'cvbr');
        assert.equal(args[args.indexOf(`-b:a${stream}`) + 1], '128k');
    }
});

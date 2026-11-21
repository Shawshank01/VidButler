import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskManager } from '../src/core/task-manager.js';
import { runAgent } from '../src/llm/agent.js';
import { MESSAGES } from '../src/llm/messages.js';
import { getTool } from '../src/llm/tool-registry.js';

const clip = getTool('download_section');
const clipArgs = { url: 'https://example.test/video', media_type: 'video', start_time: '15', end_time: '30.5' };
const downloadFolder = tmpdir();
const compressionError = '[h264_videotoolbox @ 0x123] Cannot create compression session: -12903';
const audioToolboxError = '[aac_at @ 0x456] AudioToolbox init error: 1718449215';

function stubDownloads(t, responses) {
    return t.mock.method(taskManager, 'spawnProcess', (_task, _command, args) => {
        const report = argValue(args, '--print-to-file', 2);
        const [error, filename] = responses.shift() ?? ['Unexpected download attempt'];
        return spawn(process.execPath, ['-e', `
            const [report, error, filename] = process.argv.slice(1);
            if (error) {
                console.error(error);
                process.exitCode = 1;
            } else {
                require('node:fs').writeFileSync(report, filename + '\\n');
            }
        `, report, error || '', filename ? join(downloadFolder, filename) : '']);
    });
}

function argValue(args, flag, offset = 1) {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + offset];
}

test('macOS MP4 sections prefer VideoToolbox H.264 without changing the input format selection', async (t) => {
    t.mock.property(process, 'platform', 'darwin');
    const downloader = stubDownloads(t, [[null, 'Sample.mp4']]);
    const result = await clip.run({ ...clipArgs, max_height: 1080 }, { downloadFolder });

    assert.equal(result.ok, true);
    assert.equal(downloader.mock.callCount(), 1);
    const [, , args] = downloader.mock.calls[0].arguments;
    assert.match(argValue(args, '-f'), /height<=1080/);
    assert.equal(argValue(args, '--remux-video'), 'mp4');
    assert.equal(argValue(args, '--downloader-args'),
        'ffmpeg_o:-abort_on empty_output -c:v h264_videotoolbox -allow_sw 1 -b:v 8000k -c:a aac_at -aac_at_mode cvbr -b:a 128k -f mp4');
    assert.deepEqual(result.files, ['Sample.mp4']);
});

test('a VideoToolbox failure retries the same section with the default encoder', async (t) => {
    t.mock.property(process, 'platform', 'darwin');
    const downloader = stubDownloads(t, [[compressionError], [null, 'Sample.mp4']]);
    const progress = [];
    const result = await clip.run(clipArgs, {
        downloadFolder, browser: 'brave', proxy: 'http://127.0.0.1:8080', onProgress: (line) => progress.push(line)
    });

    assert.equal(result.ok, true);
    assert.equal(downloader.mock.callCount(), 2);
    const [preferred, fallback] = downloader.mock.calls.map(({ arguments: [, , args] }) => args);
    assert.match(argValue(preferred, '--downloader-args'), /h264_videotoolbox.*-b:v 12000k/);
    assert.equal(argValue(fallback, '--downloader-args'),
        'ffmpeg_o:-abort_on empty_output -b:v 12000k -c:a aac_at -aac_at_mode cvbr -b:a 128k -f mp4');
    for (const flag of ['--download-sections', '--cookies-from-browser', '--proxy', '-P', '-o']) {
        assert.equal(argValue(fallback, flag), argValue(preferred, flag));
    }
    assert.equal(fallback.at(-1), preferred.at(-1));
    assert.deepEqual(progress, [MESSAGES.clipVideoToolboxFallback]);
    assert.deepEqual(result.files, ['Sample.mp4']);
});

test('AudioToolbox failure keeps VideoToolbox and the bitrate targets for the retry', async (t) => {
    t.mock.property(process, 'platform', 'darwin');
    const downloader = stubDownloads(t, [[audioToolboxError], [null, 'Sample.mp4']]);
    const progress = [];
    const result = await clip.run({ ...clipArgs, max_height: 2160 }, { downloadFolder, onProgress: (line) => progress.push(line) });

    assert.equal(result.ok, true);
    const encoders = downloader.mock.calls.map(({ arguments: [, , args] }) => argValue(args, '--downloader-args'));
    assert.deepEqual(encoders, [
        'ffmpeg_o:-abort_on empty_output -c:v h264_videotoolbox -allow_sw 1 -b:v 24000k -c:a aac_at -aac_at_mode cvbr -b:a 128k -f mp4',
        'ffmpeg_o:-abort_on empty_output -c:v h264_videotoolbox -allow_sw 1 -b:v 24000k -c:a aac -b:a 128k -f mp4'
    ]);
    assert.deepEqual(progress, [MESSAGES.clipAudioToolboxFallback]);
});

test('M4A on macOS encodes directly to AAC and keeps the 128 kbps target if the encoder is unavailable', async (t) => {
    t.mock.property(process, 'platform', 'darwin');
    const downloader = stubDownloads(t, [["Unrecognized option 'aac_at_mode'"], [null, 'Sample.m4a']]);
    const result = await clip.run({ ...clipArgs, media_type: 'audio', format: 'm4a' }, { downloadFolder });

    assert.deepEqual(result.files, ['Sample.m4a']);
    assert.equal(downloader.mock.callCount(), 2);
    const encoders = downloader.mock.calls.map(({ arguments: [, , args] }) => {
        assert.equal(argValue(args, '--audio-format'), 'm4a');
        return argValue(args, '--downloader-args');
    });
    assert.deepEqual(encoders, [
        'ffmpeg_o:-abort_on empty_output -vn -c:a aac_at -aac_at_mode cvbr -b:a 128k -f mp4',
        'ffmpeg_o:-abort_on empty_output -vn -c:a aac -b:a 128k -f mp4'
    ]);
});

test('a missing VideoToolbox encoder retries once, while a network failure ends the clip', async (t) => {
    t.mock.property(process, 'platform', 'darwin');
    const connectionError = 'ERROR: [generic] Unable to download webpage: HTTP Error 403';
    const downloader = stubDownloads(t, [["Unknown encoder 'h264_videotoolbox'"], [connectionError], [connectionError]]);
    const fallbackFailure = await clip.run(clipArgs, { downloadFolder });
    assert.equal(fallbackFailure.ok, false);
    assert.equal(fallbackFailure.output, connectionError);
    assert.equal(downloader.mock.callCount(), 2);

    const initialFailure = await clip.run(clipArgs, { downloadFolder });
    assert.equal(initialFailure.ok, false);
    assert.equal(initialFailure.output, connectionError);
    assert.equal(downloader.mock.callCount(), 3);
});

test('stopping the AI request between attempts prevents the software retry', async (t) => {
    t.mock.property(process, 'platform', 'darwin');
    const downloader = stubDownloads(t, [[compressionError]]);
    const controller = new AbortController();
    const history = [];
    const result = await runAgent({
        provider: { async chat() { return { toolCalls: [{ id: 'clip', name: clip.name, args: clipArgs }] }; } },
        system: 's', history, userText: `Download 0:15 to 0:30.5 from ${clipArgs.url}`,
        ctx: { downloadFolder, onProgress: () => controller.abort() }, signal: controller.signal
    });

    assert.equal(result.stoppedBecause, 'aborted');
    assert.equal(downloader.mock.callCount(), 1);
    assert.equal(history.find((message) => message.role === 'tool').result.cancelled, true);
});

test('MP4 sections on other platforms use the bitrate policy and macOS non-AAC sections use the existing defaults', async (t) => {
    const downloader = stubDownloads(t, Array.from({ length: 4 }, () => [null, 'Sample']));
    const platform = t.mock.property(process, 'platform', 'linux');
    assert.equal((await clip.run(clipArgs, { downloadFolder })).ok, true);
    platform.mock.restore();
    t.mock.property(process, 'platform', 'darwin');
    for (const variant of [{ container: 'mkv' }, { container: 'webm' }, { media_type: 'audio' }]) {
        assert.equal((await clip.run({ ...clipArgs, ...variant }, { downloadFolder })).ok, true);
    }

    assert.deepEqual(downloader.mock.calls.map(({ arguments: [, , args] }) => argValue(args, '--downloader-args')), [
        'ffmpeg_o:-abort_on empty_output -b:v 12000k', 'ffmpeg_o:-abort_on empty_output',
        'ffmpeg_o:-abort_on empty_output', 'ffmpeg_o:-abort_on empty_output -vn'
    ]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import {
    AI_KEYS_FILE, SETTINGS_FILE, TOOL_DATA_DIR, deleteLocalDataFiles, getScratchDirectory,
    isManagedDownloadFolder, lockToolData, prepareToolData, spawnYtDlp, toolEnvironment, unlockToolData
} from '../src/core/local-data.js';

async function makeProfile(t) {
    const root = await fs.mkdtemp(join(tmpdir(), 'vidbutler-local-data-test-'));
    t.after(() => fs.rm(root, { force: true, recursive: true }));
    return root;
}

test('startup prepares a private scratch session and prunes only known sessions from dead processes', async (t) => {
    const root = await makeProfile(t);
    const scratchRoot = join(root, TOOL_DATA_DIR, 'scratch');
    const deadSession = join(scratchRoot, 'run-2147483647-AbC123');
    const activeSession = join(scratchRoot, `run-${process.pid}-AbC123`);
    const unrelated = join(scratchRoot, 'other-folder');
    await Promise.all([deadSession, activeSession, unrelated].map((dir) => fs.mkdir(dir, { recursive: true })));
    await fs.writeFile(join(deadSession, 'abandoned.vtt'), 'stale caption');

    await prepareToolData(root);
    const scratch = getScratchDirectory();
    assert.equal(dirname(scratch), scratchRoot);
    assert.notEqual(scratch, activeSession);
    await assert.rejects(fs.access(deadSession), { code: 'ENOENT' });
    await fs.access(activeSession);
    await fs.access(unrelated);
    assert.deepEqual(toolEnvironment({ DENO_DIR: 'shared', TMPDIR: 'shared', OTHER: 'x' }), {
        DENO_DIR: join(root, TOOL_DATA_DIR, 'deno'), TMPDIR: scratch, TMP: scratch, TEMP: scratch, OTHER: 'x'
    });
});

test('yt-dlp receives its own cache and scratch paths and holds the cleanup lock while running', {
    skip: process.platform === 'win32' ? 'uses a POSIX executable stub' : false
}, async (t) => {
    const root = await makeProfile(t);
    await prepareToolData(root);
    const executable = join(root, 'yt-dlp');
    await fs.writeFile(executable, `#!/usr/bin/env node
console.log(JSON.stringify({
    args: process.argv.slice(2), deno: process.env.DENO_DIR, temp: process.env.TMPDIR,
    bypass: Object.keys(process.env).filter((key) => key.toUpperCase() === 'NO_PROXY')
}));
`, { mode: 0o755 });
    const args = ['--proxy', 'http://localhost:8118/', '--skip-download', 'https://example.test/video'];
    const env = { ...process.env, NO_PROXY: '*', no_proxy: 'example.test' };
    const child = spawnYtDlp(executable, args, { env });
    assert.equal(lockToolData(), false);
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    assert.deepEqual(await once(child, 'close'), [0, null]);
    assert.deepEqual(JSON.parse(stdout), {
        args: ['--cache-dir', join(root, TOOL_DATA_DIR, 'yt-dlp'), ...args],
        deno: join(root, TOOL_DATA_DIR, 'deno'), temp: getScratchDirectory(), bypass: []
    });
    assert.equal(env.no_proxy, 'example.test');
    assert.equal(lockToolData(), true);
    try {
        assert.throws(() => spawnYtDlp(executable, []), /cleanup is in progress/);
    } finally {
        unlockToolData();
    }
});

test('local data cleanup preserves a custom download folder under the shared profile', async (t) => {
    const root = await makeProfile(t);
    await prepareToolData(root);
    const downloads = join(root, 'My Videos');
    await fs.mkdir(downloads);
    const filenames = [SETTINGS_FILE, AI_KEYS_FILE, 'user-settings.json.123.tmp', 'ai-keys.json.456.tmp'];
    await Promise.all([
        ...filenames.map((name) => fs.writeFile(join(root, name), '{}')),
        fs.writeFile(join(downloads, 'Video.mp4'), 'media'),
        fs.writeFile(join(downloads, 'Video.mp4.part'), 'partial'),
        fs.writeFile(join(root, 'notes.txt'), 'unrelated')
    ]);
    assert.equal(await isManagedDownloadFolder(root, downloads), false);
    assert.equal(await isManagedDownloadFolder(root, join(root, TOOL_DATA_DIR, 'scratch')), true);
    assert.equal(await isManagedDownloadFolder(root, join(root, 'Cache', 'nested')), true);
    if (process.platform !== 'win32') {
        const alias = join(root, 'scratch-alias');
        await fs.symlink(getScratchDirectory(), alias, 'dir');
        assert.equal(await isManagedDownloadFolder(root, alias), true);
    }

    await deleteLocalDataFiles(root);
    for (const name of [...filenames, TOOL_DATA_DIR]) {
        await assert.rejects(fs.access(join(root, name)), { code: 'ENOENT' });
    }
    assert.equal(await fs.readFile(join(downloads, 'Video.mp4'), 'utf8'), 'media');
    assert.equal(await fs.readFile(join(downloads, 'Video.mp4.part'), 'utf8'), 'partial');
    assert.equal(await fs.readFile(join(root, 'notes.txt'), 'utf8'), 'unrelated');
});

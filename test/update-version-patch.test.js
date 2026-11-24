import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const git = (cwd, ...args) => execFileSync('git', [
    '-c', 'user.name=Patch Test', '-c', 'user.email=patch@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args,
], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('the patch launcher syncs main and tags before running the updater', {
    skip: !existsSync('/bin/zsh'),
}, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'vidbutler-patch-'));
    t.after(() => rmSync(root, { force: true, recursive: true }));
    const remote = join(root, 'remote');
    const local = join(root, 'local');
    const bin = join(root, 'bin');
    mkdirSync(remote);
    mkdirSync(bin);

    git(remote, 'init', '-b', 'main');
    writeFileSync(join(remote, 'package.json'), '{"version":"1.0.0"}\n');
    writeFileSync(join(remote, 'update-version.js'), `
        const { execFileSync } = require('node:child_process');
        const { version } = require('./package.json');
        const tag = execFileSync('git', ['tag', '--points-at', 'HEAD'], { encoding: 'utf8' }).trim();
        console.log('Updater saw', process.argv[2], version, tag);
    `);
    git(remote, 'add', '.');
    git(remote, 'commit', '-m', 'Initial version');
    git(root, 'clone', remote, local);
    writeFileSync(join(remote, 'package.json'), '{"version":"1.0.1"}\n');
    git(remote, 'commit', '-am', 'Update version on remote');
    git(remote, 'tag', 'v1.0.1');

    const launcher = join(local, 'update-version-patch.command');
    copyFileSync(new URL('../update-version-patch.command', import.meta.url), launcher);
    for (const command of ['osascript', 'sleep']) {
        writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    const runLauncher = () => spawnSync('/bin/zsh', [launcher], {
        cwd: root,
        encoding: 'utf8',
        input: '\n',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });

    const synced = runLauncher();
    assert.equal(synced.status, 0, synced.stderr);
    assert.match(synced.stdout, /Updater saw patch 1\.0\.1 v1\.0\.1/);

    git(local, 'remote', 'set-url', 'origin', join(root, 'missing'));
    const failedPull = runLauncher();
    assert.equal(failedPull.status, 1, failedPull.stderr);
    assert.match(failedPull.stdout, /Git pull failed/);
    assert.doesNotMatch(failedPull.stdout, /Updater saw/);

    git(local, 'switch', '-c', 'other');
    const wrongBranch = runLauncher();
    assert.equal(wrongBranch.status, 1, wrongBranch.stderr);
    assert.match(wrongBranch.stdout, /Switch to the main branch/);
    assert.doesNotMatch(wrongBranch.stdout, /Git pull failed|Updater saw/);
});

async function runVersionUpdater(cwd) {
    const child = spawn(process.execPath, ['update-version.js', 'patch'], { cwd, timeout: 15_000 });
    const answers = [
        ['Select version type', '\n'],
        ['Confirm update from', '\n'],
        ['Do you want to write custom release notes?', 'n\n'],
    ];
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk;
        if (answers.length && stdout.includes(answers[0][0])) {
            const [, answer] = answers.shift();
            child.stdin.write(answer);
        }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const [status] = await once(child, 'close');
    return { status, output: stdout + stderr };
}

test('the version updater publishes the branch and release tag atomically', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'vidbutler-publish-'));
    t.after(() => rmSync(root, { force: true, recursive: true }));
    const remote = join(root, 'remote.git');
    const local = join(root, 'local');
    const other = join(root, 'other');
    git(root, 'init', '--bare', '-b', 'main', remote);
    git(root, 'clone', remote, local);
    git(local, 'config', 'user.name', 'Patch Test');
    git(local, 'config', 'user.email', 'patch@example.invalid');
    git(local, 'config', 'commit.gpgsign', 'false');
    git(local, 'config', 'tag.gpgsign', 'false');
    writeFileSync(join(local, 'package.json'), '{"type":"module","version":"1.0.0"}\n');
    copyFileSync(new URL('../update-version.js', import.meta.url), join(local, 'update-version.js'));
    git(local, 'add', '.');
    git(local, 'commit', '-m', 'Initial version');
    git(local, 'push', 'origin', 'main');
    git(local, 'tag', '-am', 'Unrelated local tag', 'v0.9.0');
    git(local, 'config', 'push.followTags', 'true');

    const success = await runVersionUpdater(local);
    assert.equal(success.status, 0, success.output);
    assert.equal(git(remote, 'rev-parse', 'main'), git(remote, 'rev-parse', 'v1.0.1^{}'));
    assert.equal(git(remote, 'tag', '--list', 'v0.9.0'), '');

    git(root, 'clone', remote, other);
    git(other, 'commit', '--allow-empty', '-m', 'Advance remote main');
    git(other, 'push', 'origin', 'main');

    const failure = await runVersionUpdater(local);
    assert.equal(failure.status, 1, failure.output);
    assert.match(failure.output, /Failed to create\/push tag/);
    assert.equal(git(local, 'tag', '--list', 'v1.0.2'), 'v1.0.2');
    assert.equal(git(remote, 'tag', '--list', 'v1.0.2'), '');
    assert.equal(git(remote, 'rev-parse', 'main'), git(other, 'rev-parse', 'main'));
});

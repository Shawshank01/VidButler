import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import prepareMacSigning from '../scripts/prepare-mac-signing.mjs';

const execFileAsync = promisify(execFile);
const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('macOS builds enable ad hoc signing and prepare bundled tools before signing', async () => {
    const { build } = JSON.parse(await readProjectFile('package.json'));
    assert.equal(build.mac.identity, '-');
    assert.equal(build.mac.hardenedRuntime, false);
    assert.equal(build.mac.notarize, false);
    assert.equal(build.afterPack, './scripts/prepare-mac-signing.mjs');
    assert.ok(build.mac.signIgnore.some((pattern) => new RegExp(pattern).test('/VidButler.app/Contents/Resources/tools/yt-dlp')));
});

test('both macOS build workflows verify the packaged app before uploading it', async () => {
    for (const name of ['release', 'build-mac']) {
        const workflow = await readProjectFile(`.github/workflows/${name}.yml`);
        const buildAndVerify = workflow.match(/electron-builder build[\s\S]*?uses: actions\/upload-artifact/)?.[0];
        assert.ok(buildAndVerify);
        assert.match(buildAndVerify, /bash scripts\/verify-mac-package\.sh dist\/VidButler-mac-[^\n]+\.zip/);
        assert.match(buildAndVerify, /bash scripts\/verify-mac-package\.sh dist\/VidButler-mac-[^\n]+\.dmg/);
    }
});

test('the signing hook preserves valid tools and repairs unsigned tools and their checksums', {
    skip: process.platform !== 'darwin'
}, async (t) => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'vidbutler-signing-'));
    t.after(() => rm(appOutDir, { recursive: true, force: true }));
    const toolsDir = join(appOutDir, 'VidButler.app', 'Contents', 'Resources', 'tools');
    await mkdir(toolsDir, { recursive: true });

    const ytDlp = join(toolsDir, 'yt-dlp');
    const deno = join(toolsDir, 'deno');
    await copyFile('/usr/bin/true', ytDlp);
    await execFileAsync('codesign', ['--force', '--sign', '-', '--timestamp=none', ytDlp]);
    const signedBytes = await readFile(ytDlp);
    await copyFile(ytDlp, deno);
    await execFileAsync('codesign', ['--remove-signature', deno]);
    await assert.rejects(execFileAsync('codesign', ['--verify', deno]));
    await writeFile(join(toolsDir, 'SHA256SUMS'), 'old checksums\n');

    await prepareMacSigning({
        appOutDir,
        electronPlatformName: 'darwin',
        packager: { appInfo: { productFilename: 'VidButler' } }
    });

    assert.deepEqual(await readFile(ytDlp), signedBytes);
    await execFileAsync('codesign', ['--verify', '--strict', deno]);
    const { stdout } = await execFileAsync('shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: toolsDir });
    assert.match(stdout, /^yt-dlp: OK$/m);
    assert.match(stdout, /^deno: OK$/m);
});

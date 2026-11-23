import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as asar from '@electron/asar';
import { evaluateRenderer, verifyAppArchive } from '../scripts/verify-package.mjs';

test('the release smoke check rejects missing runtime files and packaged TypeScript', async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), 'vidbutler-asar-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const app = join(scratch, 'app');
    await mkdir(join(app, 'out', 'llm'), { recursive: true });
    await mkdir(join(app, 'out', 'i18n'), { recursive: true });
    const { main, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    await writeFile(join(app, 'package.json'), JSON.stringify({ main, version }));
    await writeFile(join(app, 'tools-versions.json'), await readFile(new URL('../tools-versions.json', import.meta.url)));
    for (const file of [
        'main.js', 'index.html', 'styles.css', 'preload.cjs', 'renderer.js', 'ai-ui.js',
        'ui-language.js', 'i18n/catalog.cjs', 'llm/agent.js'
    ]) {
        await writeFile(join(app, 'out', file), '');
    }

    const valid = join(scratch, 'valid.asar');
    await asar.createPackage(app, valid);
    verifyAppArchive(valid);

    const withSource = join(scratch, 'with-source.asar');
    await writeFile(join(app, 'out', 'llm', 'agent.ts'), '');
    await asar.createPackage(app, withSource);
    assert.throws(() => verifyAppArchive(withSource), /Unexpected source file.*agent\.ts/);

    const missingPreload = join(scratch, 'missing-preload.asar');
    await rm(join(app, 'out', 'preload.cjs'));
    await asar.createPackage(app, missingPreload);
    assert.throws(() => verifyAppArchive(missingPreload), /Missing out\/preload\.cjs/);
});

class TestRendererSocket extends EventTarget {
    close() {
        this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, reason: '' }));
    }
}

test('a smoke-test deadline aborts an in-flight renderer command and closes its socket', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Smoke-test deadline', 'TimeoutError');
    const socket = new TestRendererSocket();
    socket.send = (payload) => {
        assert.deepEqual(JSON.parse(payload), {
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression: 'window.electronAPI.getAppInfo()', awaitPromise: true, returnByValue: true }
        });
        controller.abort(reason);
    };
    const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
    const result = evaluateRenderer('ws://localhost', 'window.electronAPI.getAppInfo()', controller.signal, function () {
        return socket;
    });
    socket.dispatchEvent(new Event('open'));
    await assert.rejects(result, (error) => error === reason);
    await closed;
});

test('the smoke test reports a lost DevTools connection even before the socket opens', async () => {
    const socket = new TestRendererSocket();
    const result = evaluateRenderer('ws://localhost', 'document.readyState', new AbortController().signal, function () {
        return socket;
    });
    socket.dispatchEvent(Object.assign(new Event('close'), { code: 1006, reason: '' }));
    await assert.rejects(result, /DevTools connection closed \(code 1006\)/);
});

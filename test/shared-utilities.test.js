import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import classification from '../src/log-classification.cjs';

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('log classifications work in Node and classic scripts with distinct filtering policies', () => {
    const context = {};
    runInNewContext(read('log-classification.cjs'), context);
    for (const rules of [classification, context.LogClassification]) {
        assert.equal(rules.isProgressLine('[download] 50% of 10MiB'), true);
        assert.equal(rules.isProgressLine('[download] Destination: file.mp4'), false);
        assert.equal(rules.isExtractorOrNoiseLine('[youtube] Extracting URL: https://example.com'), true);
        assert.equal(rules.shouldSuppressLogLine('[youtube] Extracting URL: https://example.com'), false);
        assert.equal(rules.shouldSuppressLogLine('Stream #0:0: Video: h264'), true);
        assert.equal(rules.isExtractorOrNoiseLine('Stream #0:0: Video: h264'), false);
        assert.equal(rules.shouldSuppressLogLine('ERROR: failed to download'), false);
        assert.equal(rules.isExtractorOrNoiseLine('ERROR: failed to download'), false);
        assert.equal(rules.shouldSuppressLogLine('Extracted 12 cookies from browser'), true);
        assert.equal(rules.isExtractorOrNoiseLine('Extracted 12 cookies from browser'), true);
    }
});

test('shared proxy helper reads the current controls', () => {
    const elements = {
        proxyEnabled: { checked: true }, proxyType: { value: 'socks5' }, proxyAddress: { value: ' localhost:1080 ' }
    };
    const context = { window: {}, document: { getElementById: (id) => elements[id] } };
    runInNewContext(read('shared-context.js'), context);
    assert.equal(context.window.SharedContext.getProxyUrl(), 'socks5://localhost:1080/');
    elements.proxyType.value = 'http';
    elements.proxyAddress.value = ' [::1]:8118 ';
    assert.equal(context.window.SharedContext.getProxyUrl(), 'http://[::1]:8118/');
    elements.proxyEnabled.checked = false;
    assert.equal(context.window.SharedContext.getProxyUrl(), '');
    elements.proxyEnabled.checked = true;
    elements.proxyAddress.value = '  ';
    assert.equal(context.window.SharedContext.getProxyUrl(), '');
});

test('renderer restores the proxy type, keeps existing settings on SOCKS5, and saves control changes', async () => {
    const renderer = ts.transpileModule(read('renderer.ts'), {
        fileName: 'renderer.ts',
        compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023, strict: true }
    }).outputText;
    function control(properties) {
        return { ...properties, addEventListener(event, listener) { this[event] = listener; } };
    }
    for (const [savedType, type] of [[undefined, 'socks5'], ['http', 'http']]) {
        const proxyEnabled = control({ checked: false });
        const proxyType = control({ value: 'socks5', disabled: true });
        const proxyAddress = control({ value: '127.0.0.1:1080', disabled: true });
        const elements = { proxyEnabled, proxyType, proxyAddress };
        const updates = [];
        let initialize;
        const context = {
            console: { log() {} },
            window: {
                LogClassification: classification,
                electronAPI: {
                    getSettings: async () => ({ proxyEnabled: true, proxyType: savedType, proxyAddress: 'localhost:8118' }),
                    setSettings: async (update) => { updates.push({ ...update }); }
                }
            },
            document: {
                getElementById: (id) => elements[id] ?? null,
                addEventListener: (_event, listener) => { initialize = listener; }
            }
        };
        runInNewContext(read('shared-context.js'), context);
        runInNewContext(renderer, context);
        await initialize();

        assert.equal(proxyType.value, type);
        assert.equal(proxyType.disabled, false);
        assert.equal(proxyAddress.disabled, false);
        assert.deepEqual(Array.from(context.getProxyArgs()), ['--proxy', `${type}://localhost:8118/`]);

        proxyType.value = 'http';
        proxyType.change();
        proxyEnabled.checked = false;
        proxyEnabled.change();
        assert.equal(proxyType.disabled, true);
        assert.equal(proxyAddress.disabled, true);
        assert.deepEqual(Array.from(context.getProxyArgs()), []);
        assert.deepEqual(updates, [{ proxyType: 'http' }, { proxyEnabled: false }]);
    }
});

test('shared utilities load before both renderer scripts', () => {
    const html = read('index.html');
    for (const name of ['log-classification.cjs', 'shared-context.js']) {
        const pos = html.indexOf(`src="${name}"`);
        assert.ok(pos >= 0 && pos < html.indexOf('src="renderer.js"'));
        assert.ok(pos < html.indexOf('src="ai-ui.js"'));
    }
});

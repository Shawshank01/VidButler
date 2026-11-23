import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import classification from '../src/log-classification.cjs';

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const renderer = ts.transpileModule(read('renderer.ts'), {
    fileName: 'renderer.ts',
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023, strict: true }
}).outputText;

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
                UiLanguage: { restore() {} },
                electronAPI: {
                    onUpdateAvailable() {},
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
        let lineBreakPrevented = false;
        proxyAddress.beforeinput({ inputType: 'insertLineBreak', preventDefault: () => { lineBreakPrevented = true; } });
        assert.equal(lineBreakPrevented, true);
        proxyAddress.value = 'proxy.example.test\n:8080';
        proxyAddress.input();
        proxyAddress.change();
        assert.deepEqual(Array.from(context.getProxyArgs()), ['--proxy', 'http://proxy.example.test:8080/']);
        proxyEnabled.checked = false;
        proxyEnabled.change();
        assert.equal(proxyType.disabled, true);
        assert.equal(proxyAddress.disabled, true);
        assert.deepEqual(Array.from(context.getProxyArgs()), []);
        assert.deepEqual(updates, [{ proxyType: 'http' }, { proxyAddress: 'proxy.example.test:8080' }, { proxyEnabled: false }]);
    }
});

test('the shared browser picker offers Safari only on macOS', async () => {
    for (const [platform, savedBrowser, expected] of [
        ['darwin', 'safari', 'safari'],
        ['win32', 'safari', ''],
        ['linux', 'safari', ''],
        ['linux', 'firefox', 'firefox']
    ]) {
        const safari = { value: 'safari', remove: () => { browser.options.pop(); } };
        const browser = {
            value: '',
            options: [{ value: '' }, { value: 'firefox' }, safari],
            querySelector: (selector) => selector === 'option[value="safari"]' ? safari : null,
            addEventListener() {}
        };
        let initialize;
        runInNewContext(renderer, {
            console: { log() {} },
            window: {
                LogClassification: classification,
                UiLanguage: { restore() {} },
                electronAPI: { platform, onUpdateAvailable() {}, getSettings: async () => ({ browser: savedBrowser }) }
            },
            document: {
                getElementById: (id) => id === 'browser' ? browser : null,
                addEventListener: (_event, listener) => { initialize = listener; }
            }
        });
        await initialize();
        assert.equal(browser.options.includes(safari), platform === 'darwin');
        assert.equal(browser.value, expected);
    }
});

test('the startup update shows download progress and can be deferred until the next manual check', async () => {
    class Control extends EventTarget {
        style = {};
        focus() {}
        removeAttribute(name) { delete this[name]; }
        click() { this.dispatchEvent(new Event('click')); }
    }
    const elements = Object.fromEntries([
        'updateModal', 'updateModalActionBtn', 'updateModalCancelBtn', 'updateModalProgress'
    ].map((id) => [id, new Control()]));
    const action = elements.updateModalActionBtn;
    const progressBar = elements.updateModalProgress;
    const document = Object.assign(new EventTarget(), {
        getElementById: (id) => elements[id] ?? null,
        querySelector: (selector) => elements[selector.slice(1)] ?? null
    });
    const update = { supported: true, installSupported: true, hasUpdate: true, currentVersion: '5.3.3', version: '5.4.0' };
    const download = Promise.withResolvers();
    let offerUpdate;
    let reportProgress;
    let downloads = 0;
    let installs = 0;
    const window = {
        LogClassification: classification,
        UiLanguage: { text: (key) => key, restore() {} },
        electronAPI: {
            onUpdateAvailable: (callback) => { offerUpdate = callback; },
            onUpdateProgress: (callback) => {
                reportProgress = callback;
                return () => { reportProgress = undefined; };
            },
            getCurrentVersion: async () => update.currentVersion,
            checkAppUpdate: async () => ({ ...update, downloaded: true }),
            downloadAppUpdate: () => { downloads += 1; return download.promise; },
            installAppUpdate: async () => { installs += 1; return true; }
        }
    };
    runInNewContext(renderer, { window, document, console: { log() {} } });
    document.dispatchEvent(new Event('DOMContentLoaded'));
    offerUpdate(update);

    assert.equal(action.textContent, 'downloadUpdate');
    assert.equal(downloads, 0);
    action.click();
    await setImmediate();
    assert.equal(downloads, 1);
    assert.equal(progressBar.hidden, false);
    assert.equal(progressBar.value, undefined);
    assert.equal(action.hidden, true);
    reportProgress({ percent: 42.5 });
    assert.equal(progressBar.value, 42.5);

    download.resolve({ success: true, version: update.version });
    await setImmediate();
    assert.equal(progressBar.hidden, true);
    assert.equal(reportProgress, undefined);
    assert.equal(action.textContent, 'restartNow');
    assert.equal(installs, 0);
    elements.updateModalCancelBtn.click();
    await setImmediate();
    assert.equal(installs, 0);

    const check = window.checkUpdate();
    await setImmediate();
    assert.equal(action.textContent, 'restartNow');
    assert.equal(downloads, 1);
    action.click();
    await check;
    assert.equal(installs, 1);
});

test('shared utilities load before both renderer scripts', () => {
    const html = read('index.html');
    for (const name of ['log-classification.cjs', 'shared-context.js']) {
        const pos = html.indexOf(`src="${name}"`);
        assert.ok(pos >= 0 && pos < html.indexOf('src="renderer.js"'));
        assert.ok(pos < html.indexOf('src="ai-ui.js"'));
    }
});

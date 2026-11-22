import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import catalog from '../src/i18n/catalog.cjs';
import { sanitizeClassicSettings } from '../src/settings-schema.js';

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const codes = ['en', 'de', 'fr', 'es', 'it', 'pl', 'nl', 'pt', 'zh-Hans', 'zh-Hant', 'ja'];

test('system language matches supported regional tags and preferences use an allow-list', () => {
    assert.deepEqual(Object.keys(catalog.languages), codes);
    assert.equal(catalog.resolveLanguage(['ko-KR', 'FR-CA', 'en-GB']), 'fr');
    assert.equal(catalog.resolveLanguage(['pt_BR']), 'pt');
    assert.equal(catalog.resolveLanguage(['ko-KR', null, 'constructor']), 'en');
    assert.equal(catalog.translate('xx', 'run'), 'Run');
    for (const uiLanguage of ['auto', ...codes]) {
        assert.deepEqual(sanitizeClassicSettings({ uiLanguage }), { uiLanguage });
    }
    assert.deepEqual(sanitizeClassicSettings({ uiLanguage: 'fr-CA', systemLanguage: 'de' }), {});
    assert.deepEqual(sanitizeClassicSettings({ uiLanguage: '__proto__' }), {});
});

test('system language distinguishes Chinese scripts and recognizes Japanese', () => {
    for (const tag of ['zh', 'zh-CN', 'zh_SG', 'zh-Hans', 'zh-Hans-TW']) {
        assert.equal(catalog.resolveLanguage([tag]), 'zh-Hans', tag);
    }
    for (const tag of ['zh-TW', 'ZH_hk', 'zh-MO', 'zh-Hant', 'zh-Hant-CN']) {
        assert.equal(catalog.resolveLanguage([tag]), 'zh-Hant', tag);
    }
    assert.equal(catalog.resolveLanguage(['ko-KR', 'ja-JP', 'zh-TW']), 'ja');
    assert.equal(catalog.resolveLanguage(['zh-Hant-HK', 'ja-JP']), 'zh-Hant');
});

test('catalog entries cover localizable HTML and preserve interpolation placeholders in every locale', () => {
    const keys = [...read('i18n/catalog.cjs').matchAll(/^(\w+)\|/gm)].map((match) => match[1]);
    const placeholders = (text) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
    for (const [, key] of read('index.html').matchAll(/data-i18n(?:-[-\w]+)?="([^"]+)"/g)) {
        assert.ok(keys.includes(key), `Missing HTML translation for ${key}`);
    }
    for (const key of keys) {
        const expected = placeholders(catalog.translate('en', key));
        for (const code of codes) {
            const translated = catalog.translate(code, key);
            assert.ok(translated.trim(), `${code}/${key} is empty`);
            assert.deepEqual(placeholders(translated), expected, `${code}/${key} has different placeholders`);
        }
    }
    const path = '/Downloads/<clip>{version}.mp4';
    assert.ok(catalog.translate('pt', 'initialFolder', { path }).includes(`\n${path}\n`));
});

test('renderer switches labels and accessibility attributes without changing action values', async () => {
    const pendingWrites = [];
    const option = { dataset: { i18n: 'customFormat' }, value: 'Download (Custom Format)' };
    const input = {
        value: 'https://example.test/video',
        getAttribute: () => 'enterVideoUrl',
        setAttribute(attribute, value) { this[attribute] = value; }
    };
    const picker = {
        options: [],
        add(option) { this.options.push(option); },
        addEventListener(_event, listener) { this.change = listener; }
    };
    const document = {
        documentElement: {},
        querySelector: () => picker,
        querySelectorAll(selector) {
            if (selector === '[data-i18n]') return [option];
            if (selector === '[data-i18n-placeholder]') return [input];
            return [];
        },
        dispatchEvent() {}
    };
    const context = {
        document, Event, navigator: { languages: ['nl-NL'] },
        Option: class { constructor(text, value) { Object.assign(this, { text, value }); } },
        window: { UiCatalog: catalog, electronAPI: { setSettings: async (updates) => pendingWrites.push({ ...updates }) } }
    };
    const renderer = ts.transpileModule(read('ui-language.ts'), {
        compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 }
    }).outputText;
    runInNewContext(renderer, context);
    assert.equal(picker.disabled, true);
    context.window.UiLanguage.restore({ systemLanguage: 'fr', uiLanguage: 'de' });
    assert.equal(picker.disabled, false);
    assert.equal(picker.value, 'de');
    assert.equal(option.textContent, 'Herunterladen (eigenes Format)');
    assert.equal(document.documentElement.lang, 'de');

    picker.value = 'auto';
    await picker.change();
    assert.deepEqual(pendingWrites, [{ uiLanguage: 'auto' }]);
    assert.equal(document.documentElement.lang, 'fr');
    assert.equal(option.textContent, 'Télécharger (format personnalisé)');
    assert.equal(input.placeholder, 'Saisissez l’URL de la vidéo');
    assert.equal(option.value, 'Download (Custom Format)');
    assert.equal(input.value, 'https://example.test/video');

    context.window.UiLanguage.restore({ systemLanguage: 'zh-TW' });
    assert.equal(document.documentElement.lang, 'zh-Hant');
    assert.equal(option.textContent, '下載（自訂格式）');
    assert.equal(input.placeholder, '輸入影片網址');
    assert.equal(picker.options.find(({ value }) => value === 'zh-Hant').lang, 'zh-Hant');

    picker.value = 'ja';
    await picker.change();
    assert.deepEqual(pendingWrites.at(-1), { uiLanguage: 'ja' });
    assert.equal(document.documentElement.lang, 'ja');
    assert.equal(option.textContent, 'ダウンロード（カスタム形式）');
});

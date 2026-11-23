import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import catalog from '../src/i18n/catalog.cjs';

// Static checks that catch the most common UI wiring mistakes without needing a window:
// a script looking up an element id that does not exist, or the preload/IPC names drifting apart.
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf-8');
const aiUi = readFileSync(new URL('../src/ai-ui.ts', import.meta.url), 'utf-8');
const preload = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf-8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf-8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf-8');
const rendererScript = readFileSync(new URL('../src/renderer.ts', import.meta.url), 'utf-8');

const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test('window startup does not wait for secure storage', () => {
    const startup = main.match(/^async function startApp\(\) \{([\s\S]*?)^\}/m)?.[1] ?? '';
    assert.match(startup, /\bcreateWindow\(\);/);
    assert.doesNotMatch(startup, /safeStorage|getChatService/i);
});

test('API key storage uses Electron’s asynchronous encryption methods', () => {
    for (const [method, asyncMethod] of [
        ['isEncryptionAvailable', 'isAsyncEncryptionAvailable'],
        ['encryptString', 'encryptStringAsync'],
        ['decryptString', 'decryptStringAsync']
    ]) {
        assert.doesNotMatch(main, new RegExp(`\\bsafeStorage\\.${method}\\b`));
        assert.match(main, new RegExp(`\\bsafeStorage\\.${asyncMethod}\\b`));
    }
});

test('html ids are unique', () => {
    const dupes = htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i);
    assert.deepEqual(dupes, []);
});

test('every id looked up by the AI renderer exists in index.html', () => {
    const used = new Set([...aiUi.matchAll(/\$(?:<\w+>)?\('([^']+)'\)/g)].map((m) => m[1]));
    assert.ok(used.size > 20, 'expected to find many lookups');
    const missing = [...used].filter((id) => !htmlIds.includes(id));
    assert.deepEqual(missing, []);
});

test('Gemini key help does not describe the API key as free', () => {
    assert.match(html, /id="aiKeyHelpLink"[^>]*data-i18n="geminiKeyHelp"/);
    assert.match(aiUi, /label: 'geminiKeyHelp'/);
    assert.equal(catalog.translate('en', 'geminiKeyHelp'), 'Get a Gemini API key from Google AI Studio');
});

test('AI empty chat groups examples by section and shows re-encode above Delete', () => {
    assert.match(aiUi, /title.textContent = t\('examplesIntro'\);/);
    const downloads = aiUi.match(/category: 'exampleDownload',\s*items: \[([^\]]*)\]/)?.[1] ?? '';
    const subtitles = aiUi.match(/category: 'exampleSubtitles',\s*items: \[([^\]]*)\]/)?.[1] ?? '';
    const information = aiUi.match(/category: 'exampleInformation',\s*items: \[([^\]]*)\]/)?.[1] ?? '';
    const fileManagement = aiUi.match(/category: 'exampleFiles',\s*items: \[([^\]]*)\]/)?.[1] ?? '';
    for (const example of ['exampleAudio', 'exampleExtract', 'exampleClip']) assert.ok(downloads.includes(`'${example}'`));
    for (const example of ['exampleDownloadSubtitles', 'exampleSubtitleType', 'exampleSubtitlesTop']) {
        assert.ok(subtitles.includes(`'${example}'`));
    }
    assert.ok(!information.includes("'exampleSubtitleType'"));
    assert.ok(information.includes("'exampleVideoInfo'"));
    assert.ok(information.includes("'exampleSummary'"));
    assert.match(fileManagement, /'exampleReencode',\s*'exampleDelete'/);
});

test('renderer scripts load as classic scripts in the expected order', () => {
    const files = [...html.matchAll(/<script\b([^>]*)>/g)].map(([, attributes]) => {
        assert.doesNotMatch(attributes, /\btype\s*=\s*["']?module\b/i);
        return attributes.match(/\bsrc="([^"]+)"/)?.[1];
    });
    assert.deepEqual(files, ['log-classification.cjs', 'shared-context.js', 'i18n/catalog.cjs', 'ui-language.js', 'renderer.js', 'markdown.js', 'ai-ui.js']);
});

test('assistant messages are rendered as Markdown, user and error messages as plain text', () => {
    assert.match(aiUi, /kind === 'assistant' && window\.MarkdownLite/);
    assert.match(aiUi, /window\.MarkdownLite\.render\(text, document/);
    assert.match(aiUi, /el\.textContent = text;/, 'plain-text fallback exists');
});

test('streaming responses render as Markdown live on every text delta', () => {
    assert.match(aiUi, /streamingText\s*\+=\s*event\.text/);
    assert.match(aiUi, /updateStreamingMessage\(streamingText\)/);
});

test('the AI renderer only calls API methods that preload exposes', () => {
    const exposed = new Set(
        [...preload.slice(preload.indexOf('ai: {')).matchAll(/^\s{8}(\w+): /gm)].map((m) => m[1])
    );
    const called = [...aiUi.matchAll(/\bapi\.(\w+)\(/g)].map((m) => m[1]);
    assert.ok(called.length > 5);
    const unknown = [...new Set(called)].filter((name) => !exposed.has(name));
    assert.deepEqual(unknown, []);
});

test('AI mode hides every classic-only control via CSS and the switch is wired', () => {
    assert.match(css, /body\[data-mode='ai'\] \.classic-only\s*\{\s*display:\s*none !important/);
    for (const id of ['url', 'action', 'formatCodeGroup', 'codecGroup', 'subtitlePositionGroup', 'cancelActionControls', 'output']) {
        const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
        const inClassicGroup = html.match(new RegExp(`<div[^>]*classic-only[^>]*>(?:(?!</div>)[\\s\\S])*id="${id}"`));
        assert.ok(/classic-only/.test(tag) || inClassicGroup, `${id} should be hidden in AI mode`);
    }
    // These must stay usable in AI mode because they feed the assistant's context.
    for (const id of ['downloadFolder', 'browser', 'proxyEnabled', 'proxyType', 'proxyAddress']) {
        const group = html.match(new RegExp(`<div[^>]*class="input-group[^"]*"[^>]*>(?:(?!<div class="input-group)[\\s\\S])*?id="${id}"`));
        assert.ok(!group || !/classic-only/.test(group[0]), `${id} must remain visible in AI mode`);
    }
});

test('the proxy selector starts disabled and offers SOCKS5 and HTTP', () => {
    const options = html.match(/<select id="proxyType"[^>]*\bdisabled\b[^>]*>([\s\S]*?)<\/select>/)?.[1];
    assert.ok(options);
    assert.match(options, /<option value="socks5" selected>SOCKS5<\/option>/);
    assert.match(options, /<option value="http">HTTP<\/option>/);
});

test('model text is never rendered as HTML', () => {
    const code = aiUi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(code));
});

test('the AI UI sends only the three context fields the main process validates', () => {
    assert.match(aiUi, /downloadFolder:[\s\S]*browser:[\s\S]*proxy: window\.SharedContext\.getProxyUrl\(\)/);
});

test('retry countdown and in-progress status update in real time with styled indicator', () => {
    assert.match(aiUi, /function startRetryProgress/);
    assert.match(aiUi, /function clearRetryProgress/);
    assert.match(aiUi, /t\('retryIn', \{ seconds: secondsLeft, details \}\)/);
    assert.match(aiUi, /t\('retryNow', \{ details \}\)/);
    assert.match(css, /\.ai-progress\.retrying\s*\{/);
});

test('classic download progress bar and #019D9C theme styling are present', () => {
    assert.match(css, /--run-button-bg:\s*#019D9C;/);
    assert.match(css, /\.classic-progress-container\s*\{/);
    assert.match(css, /\.classic-progress-fill\s*\{/);
    assert.match(html, /id="classicProgressBarContainer"[^>]*class="[^"]*classic-only/);
});

test('re-encode and hardsub support progress bar updates', () => {
    assert.match(rendererScript, /updateDownloadProgress\(progress,\s*['"]hardsubProgress['"]\)/);
    assert.match(rendererScript, /updateDownloadProgress\(text: string,\s*encodingTitle/);
    assert.match(rendererScript, /download\|ffmpeg/);
});

test('app info modal is wired to the brand icon and exposes info', () => {
    assert.match(html, /id="appInfoBtn"/);
    assert.match(html, /id="appInfoModal"/);
    assert.match(html, /id="appInfoGithubLink"/);
    assert.match(html, /https:\/\/github\.com\/Shawshank01\/Vidbutler/);
    assert.match(html, /id="checkDependenciesBtn"/);
    assert.match(html, /id="checkUpdateBtn"/);
    assert.match(html, /id="deleteLocalDataBtn"[^>]*>Delete Local Data/);
    assert.match(html, /Michifumi/);
    assert.match(rendererScript, /appInfoBtn\.addEventListener\('click'/);
    assert.match(rendererScript, /window\.electronAPI\?\.getAppInfo/);
    assert.match(rendererScript, /window\.electronAPI\.checkDependencies/);
    assert.match(rendererScript, /window\.electronAPI\.deleteLocalData\(/);
    assert.match(rendererScript, /appInfoGithubLink/);
});

test('the language picker is labeled and lives in About', () => {
    const about = html.slice(html.indexOf('id="appInfoModal"'), html.indexOf('id="updateModal"'));
    assert.match(about, /<label for="uiLanguage" data-i18n="language">Language<\/label>/);
    assert.match(about, /<select id="uiLanguage" disabled>/);
    assert.equal([...html.matchAll(/id="uiLanguage"/g)].length, 1);
});

test('update prompt modal exists, matches app info modal structure, and is wired in renderer', () => {
    assert.match(html, /id="updateModal"/);
    assert.match(html, /id="updateModalTitle"/);
    assert.match(html, /id="updateModalVersion"/);
    assert.match(html, /id="updateModalCloseBtn"/);
    assert.match(html, /id="updateModalStatus"/);
    assert.match(html, /id="updateModalCurrentVersion"/);
    assert.match(html, /id="updateModalLatestVersion"/);
    assert.match(html, /id="updateModalNotesSection"/);
    assert.match(html, /id="updateModalNotes"/);
    assert.match(html, /id="updateModalActionBtn"/);
    assert.match(html, /id="updateModalCancelBtn"/);
    assert.match(html, /id="updateModalSecondaryBtn"/);
    assert.match(rendererScript, /function showUpdateModal/);
    assert.match(rendererScript, /showUpdateModal\(/);
    assert.match(rendererScript, /downloadAppUpdate\(\)/);
    assert.match(rendererScript, /installAppUpdate\(\)/);
    assert.match(rendererScript, /classicText\('downloadRestart'\)/);
    assert.match(rendererScript, /classicText\('copyHomebrew'\)/);
    assert.match(rendererScript, /copyMacUpdateCommand\(\)/);
    assert.match(preload, /invoke\('copy-mac-update-command'\)/);
    assert.match(main, /handle\('copy-mac-update-command'/);
    assert.match(preload, /subscribe\('app-update-progress'/);
    assert.match(main, /checkForUpdatesOnLaunch\(win\)/);
    assert.match(css, /#updateModal,\s*#confirmModal\s*\{\s*z-index:\s*2200;/);
});

test('download-folder-updated event is exposed by preload, handled by main and received in renderer', () => {
    assert.match(preload, /onDownloadFolderUpdated:\s*\(callback\)\s*=>/);
    assert.match(preload, /subscribe\('download-folder-updated'/);
    assert.match(main, /sendEvent\(win\.webContents, 'download-folder-updated'/);
    assert.match(main, /async function promptInitialDownloadFolder/);
    assert.match(rendererScript, /window\.electronAPI\?\.onDownloadFolderUpdated\?\.\(/);
});

test('context errors (download folder, browser, proxy) do not show Open AI Settings button and folder errors offer Choose Download Folder', () => {
    assert.match(aiUi, /text: error\.contextField \? t\(contextKeys\[error\.contextField\]\)/);
    assert.match(aiUi, /const needsSettings = !error\.contextField &&/);
    assert.match(aiUi, /t\('chooseDownloadFolder'\)/);
    assert.match(aiUi, /window\.chooseFolder/);
});

test('app branding and title is "VidButler"', () => {
    assert.match(html, /<title>VidButler<\/title>/);
    assert.match(html, /<h1>VidButler<\/h1>/);
    assert.ok(!html.includes('YT-DLP Downloader'));
});

test('list_formats tool output attaches an expandable raw format viewer with safe pre element and styling', () => {
    assert.match(aiUi, /event\.name === 'list_formats'/);
    assert.match(aiUi, /document\.createElement\('details'\)/);
    assert.match(aiUi, /document\.createElement\('summary'\)/);
    assert.match(aiUi, /document\.createElement\('pre'\)/);
    assert.match(aiUi, /pre\.textContent = event\.result\.output\.trim\(\)/);
    assert.match(css, /\.ai-step-expander\s*\{/);
    assert.match(css, /\.ai-step-raw\s*\{/);
    assert.doesNotMatch(aiUi, /expander\.addEventListener\('toggle'/);
});

test('chat messages container scrolling avoids scrollIntoView traps and flex clamping', () => {
    assert.doesNotMatch(aiUi, /\.scrollIntoView\(/);
    assert.match(aiUi, /els\.messages\.scrollTop\s*=\s*els\.messages\.scrollHeight/);
    assert.match(css, /\.ai-messages\s*>\s*\*\s*\{\s*flex-shrink:\s*0;\s*\}/);
    assert.match(css, /overflow-anchor:\s*none;/);
});

test('mode switch notice accommodates full text without artificial truncation', () => {
    assert.doesNotMatch(css, /\.mode-notice\s*\{[^}]*max-width:\s*280px/);
    assert.match(css, /\.mode-notice\s*\{/);
    assert.match(css, /\.mode-notice:empty\s*\{\s*display:\s*none;\s*\}/);
    assert.match(aiUi, /els\.notice\.title\s*=\s*text/);
});

test('aiThinkingSelect has no static options in index.html', () => {
    assert.match(html, /<select\b[^>]*id="aiThinkingSelect"[^>]*>\s*<\/select>/);
});

test('index.html enforces a strict Content-Security-Policy without inline handlers', () => {
    const cspMatch = html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i);
    assert.ok(cspMatch, 'index.html should define a Content-Security-Policy meta tag');
    const csp = cspMatch[1];
    assert.match(csp, /\bdefault-src 'none'/);
    assert.match(csp, /\bscript-src 'self' 'report-sample'/);
    assert.match(csp, /\bconnect-src 'none'/);
    assert.match(csp, /\bobject-src 'none'/);
    assert.match(csp, /\bbase-uri 'none'/);
    assert.match(csp, /\bform-action 'none'/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.doesNotMatch(csp, /\bframe-ancestors\b/);
    const scriptSrc = csp.match(/\bscript-src[^;]*/)?.[0] ?? '';
    assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test('the Classic renderer wires Choose, Run, and Check for Updates with addEventListener', () => {
    for (const id of ['chooseFolderBtn', 'runCommandBtn', 'checkUpdateBtn']) {
        assert.match(html, new RegExp(`id="${id}"`));
        assert.match(rendererScript, new RegExp(`getElementById\\('${id}'\\)[\\s\\S]*?addEventListener\\('click'`));
    }
});

test('the main process denies new windows and unexpected navigations', () => {
    assert.match(main, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/);
    assert.match(main, /win\.webContents\.on\('will-navigate'/);
    assert.match(main, /event\.preventDefault\(\)/);
});





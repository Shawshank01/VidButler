import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file) => readFileSync(join(src, file), 'utf8');

/** Member names declared at `indent` spaces inside `interface <name> { ... }`. */
function interfaceMembers(dts, name, indent = 4) {
    const body = dts.match(new RegExp(`interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    return [...body.matchAll(new RegExp(`^ {${indent}}(\\w+)\\??:`, 'gm'))].map((m) => m[1]);
}

/** Keys of the object literal exposed by preload.cjs; `ai` has its own nested block. */
function preloadKeys(preload) {
    const [top, aiBlock = ''] = preload.split(/^ {4}ai: \{/m);
    const topKeys = [...top.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
    const aiKeys = [...aiBlock.matchAll(/^ {8}(\w+):/gm)].map((m) => m[1]);
    return { topKeys: [...topKeys, 'ai'], aiKeys };
}

test('electron.d.ts declares exactly what preload.cjs exposes', () => {
    const dts = read('types/electron.d.ts');
    const { topKeys, aiKeys } = preloadKeys(read('preload.cjs'));
    assert.deepEqual(interfaceMembers(dts, 'ElectronAPI').sort(), topKeys.sort());
    assert.deepEqual(interfaceMembers(dts, 'AiApi').sort(), aiKeys.sort());
});

test('the preload exposes exactly the IPC request channels declared and registered by the app', () => {
    const channels = new Set([...read('preload.cjs').matchAll(/\binvoke\(\s*'([^']+)'/g)].map((m) => m[1]));
    const handled = new Set([...read('main.ts').matchAll(/\bhandle\('([^']+)'/g)].map((m) => m[1]));
    const declarations = read('types/ipc.ts').split('export interface IpcEvents')[0];
    const declared = new Set([...declarations.matchAll(/^ {4}'([^']+)':/gm)].map((m) => m[1]));
    assert.ok(channels.size > 10);
    assert.deepEqual(channels, handled);
    assert.deepEqual(channels, declared);
});

test('preload subscriptions forward only the payload and remove the matching listener', () => {
    const ipcRenderer = new EventEmitter();
    let api;
    runInNewContext(read('preload.cjs'), {
        process: { platform: 'darwin' },
        require: (module) => {
            assert.equal(module, 'electron');
            return {
                ipcRenderer,
                contextBridge: { exposeInMainWorld: (key, value) => {
                    assert.equal(key, 'electronAPI');
                    api = value;
                } }
            };
        }
    });

    for (const [subscribe, channel, payload] of [
        [api.onProgress, 'download-progress', '75%'],
        [api.onDownloadFolderUpdated, 'download-folder-updated', '/example'],
        [api.onUpdateProgress, 'app-update-progress', { percent: 75 }],
        [api.ai.onEvent, 'ai-event', { type: 'progress', text: '75%' }]
    ]) {
        const observed = [];
        const unsubscribe = subscribe((...args) => observed.push(args));
        const otherListener = () => { };
        ipcRenderer.on(channel, otherListener);
        ipcRenderer.emit(channel, { sender: ipcRenderer }, payload);
        assert.deepEqual(observed, [[payload]]);
        unsubscribe();
        ipcRenderer.emit(channel, { sender: ipcRenderer }, payload);
        assert.deepEqual(observed, [[payload]]);
        assert.deepEqual(ipcRenderer.listeners(channel), [otherListener]);
    }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Script } from 'node:vm';
import { compileApp } from '../scripts/compile-app.mjs';

const execFileAsync = promisify(execFile);
const source = (file) => new URL(`../src/${file}`, import.meta.url);

test('Linux AppImages use the static runtime toolset with zstd compression', async () => {
    const { build } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(build.toolsets.appimage, '1.0.3');
    assert.equal(build.appImage.compression, 'zstd');
});

test('the compiled app loads the AI backend as JavaScript and preserves Electron assets', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'vidbutler-app-build-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { main, type, build } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(build.beforePack, './scripts/compile-app.mjs');
    assert.ok(build.files.includes('out/**/*'));
    assert.ok(build.files.includes('build/icon.png'));
    assert.ok(build.files.includes('tools-versions.json'));

    const output = join(directory, 'out');
    await compileApp(output);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type }));
    const appFiles = await readdir(output, { recursive: true });
    assert.ok(appFiles.includes(relative(output, join(directory, main))));
    assert.ok(appFiles.every((file) => !file.endsWith('.ts')));

    const html = await readFile(source('index.html'), 'utf8');
    const scriptsAndStyles = Array.from(html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g), ([, file]) => file);
    const compiledScripts = new Set(['ai-ui.js', 'renderer.js', 'ui-language.js', 'i18n/catalog.cjs']);
    for (const file of ['index.html', 'preload.cjs', ...scriptsAndStyles]) {
        const built = await readFile(join(output, file));
        if (compiledScripts.has(file)) new Script(built.toString('utf8'), { filename: file });
        else assert.deepEqual(built, await readFile(source(file)), file);
    }

    await execFileAsync(process.execPath, ['--no-strip-types', '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import catalog from './out/i18n/catalog.cjs';
        import { ChatService } from './out/llm/chat-service.js';
        import { createProvider } from './out/llm/providers/index.js';
        import { getTool } from './out/llm/tool-registry.js';
        import { cancelCurrentTask } from './out/core/tools.js';
        assert.equal(catalog.translate('de', 'run'), 'Ausführen');
        assert.equal(typeof ChatService, 'function');
        assert.equal(getTool('download_video').name, 'download_video');
        assert.equal(cancelCurrentTask(), false);
        for (const type of ['gemini', 'xai', 'cohere', 'ollama', 'openai-compatible']) {
            assert.equal(createProvider({ type }).id, type);
        }
    `], { cwd: directory });
});

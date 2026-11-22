import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import asar from '@electron/asar';

const execFileAsync = promisify(execFile);
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const toolVersions = JSON.parse(await readFile(new URL('../tools-versions.json', import.meta.url), 'utf8'));
const tools = ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno'];

export function verifyAppArchive(archive) {
    const entries = new Set(asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/')));
    const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
    assert.equal(packaged.main, metadata.main);
    assert.equal(packaged.version, metadata.version);
    for (const entry of [
        metadata.main, 'out/index.html', 'out/styles.css', 'out/preload.cjs', 'out/renderer.js',
        'out/ai-ui.js', 'out/llm/agent.js', 'tools-versions.json'
    ]) {
        assert(entries.has('/' + entry), `Missing ${entry} in ${archive}`);
    }
    const source = [...entries].find((entry) => entry.startsWith('/src/') || /^\/out\/.*\.[cm]?tsx?$/.test(entry));
    assert.equal(source, undefined, `Unexpected source file in the package: ${source}`);
    assert.deepEqual(JSON.parse(asar.extractFile(archive, 'tools-versions.json')), toolVersions);
}

async function locatePackage(target, outputDir, scratch) {
    const [platform, arch] = target.split('-');
    const suffix = arch === 'x64' ? '' : `-${arch}`;
    const { productName } = metadata.build;
    if (platform === 'darwin') {
        const zip = join(outputDir, `${productName}-mac-${arch}-${metadata.version}.zip`);
        await execFileAsync('ditto', ['-x', '-k', zip, scratch], { timeout: 120_000 });
        const contents = join(scratch, `${productName}.app`, 'Contents');
        return { executable: join(contents, 'MacOS', productName), resources: join(contents, 'Resources') };
    }
    if (platform === 'win32') {
        const root = join(outputDir, `win${suffix}-unpacked`);
        const installer = join(outputDir, `${productName}-win-${arch}-${metadata.version}.exe`);
        await realpath(installer);
        return { executable: join(root, `${productName}.exe`), resources: join(root, 'resources') };
    }

    const imageArch = arch === 'x64' ? 'x86_64' : arch;
    const image = join(outputDir, `${productName}-linux-${imageArch}-${metadata.version}.AppImage`);
    // Inspect and launch the actual files from the AppImage without requiring a FUSE mount.
    await execFileAsync(image, ['--appimage-extract'], { cwd: scratch, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const root = join(scratch, 'squashfs-root');
    return { executable: join(root, metadata.name), resources: join(root, 'resources') };
}

async function waitForRenderer(profile, child, signal) {
    while (!signal.aborted) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('VidButler exited during startup.');
        try {
            const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
            const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal });
            const targets = await response.json();
            const page = targets.find(({ type, url }) => type === 'page' && url.endsWith('/app.asar/out/index.html'));
            if (page) return page.webSocketDebuggerUrl;
        } catch { /* Wait for Chromium to publish the packaged renderer target. */ }
        await delay(100, undefined, { signal });
    }
    signal.throwIfAborted();
}

export async function evaluateRenderer(address, expression, signal, Socket = WebSocket) {
    signal.throwIfAborted();
    const socket = new Socket(address);
    const listeners = new AbortController();
    try {
        const reply = await new Promise((resolveReply, reject) => {
            const once = { once: true, signal: listeners.signal };
            signal.addEventListener('abort', () => reject(signal.reason), once);
            socket.addEventListener('close', ({ code, reason }) => {
                reject(new Error(`The renderer's DevTools connection closed (code ${code}${reason ? `, ${reason}` : ''}).`));
            }, once);
            socket.addEventListener('open', () => socket.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression, awaitPromise: true, returnByValue: true }
            })), once);
            socket.addEventListener('message', ({ data }) => {
                try {
                    const message = JSON.parse(data);
                    if (message.id === 1) resolveReply(message);
                } catch (error) {
                    reject(error);
                }
            }, { signal: listeners.signal });
        });
        if (reply.error || reply.result?.exceptionDetails || !reply.result?.result) {
            throw new Error(JSON.stringify(reply));
        }
        return reply.result.result.value;
    } finally {
        listeners.abort();
        socket.close();
    }
}

async function runStage(stage, operation, timeout = 120_000) {
    console.log(`Smoke test: ${stage}`);
    const signal = AbortSignal.timeout(timeout);
    try {
        return await operation(signal);
    } catch (error) {
        const detail = signal.aborted ? `timed out after ${timeout / 1000}s` : error.message;
        throw new Error(`${stage}: ${detail}`, { cause: error });
    }
}

async function stopApp(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const terminate = (signal) => {
        if (process.platform === 'win32') child.kill(signal);
        else {
            try { process.kill(-child.pid, signal); }
            catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
    };
    if (process.platform === 'win32') {
        await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { timeout: 5000 })
            .catch(() => terminate('SIGTERM'));
    } else terminate('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) {
        await once(child, 'exit', { signal: AbortSignal.timeout(5000) }).catch((error) => {
            if (error.name !== 'AbortError') throw error;
            terminate('SIGKILL');
        });
    }
}

async function waitForAppUi(address, signal) {
    while (!signal.aborted) {
        const state = await evaluateRenderer(address, `({
            mode: document.body?.dataset.mode,
            classicLoaded: typeof window.runCommand === 'function'
        })`, signal);
        if (state.mode) return state;
        await delay(100, undefined, { signal });
    }
    signal.throwIfAborted();
}

// This function runs in the actual packaged renderer via DevTools.
async function checkAiStreaming(downloadFolder) {
    const api = window.electronAPI;
    const events = [];
    const unsubscribe = api.ai.onEvent(({ type }) => events.push(type));
    try {
        const ai = await api.ai.send('Reply to the packaged app smoke test.', { downloadFolder, browser: '', proxy: '' });
        return { ai, events };
    } finally {
        unsubscribe();
    }
}

async function smokePackage(target, outputDir, scratch) {
    const { executable, resources } = await locatePackage(target, outputDir, scratch);
    verifyAppArchive(join(resources, 'app.asar'));
    const toolPath = (name) => join(resources, 'tools', name + (process.platform === 'win32' ? '.exe' : ''));
    for (const name of tools) {
        const flag = name.startsWith('ff') ? '-version' : '--version';
        await execFileAsync(toolPath(name), [flag], { timeout: 45_000 });
        console.log(`Bundled ${name} runs.`);
    }

    const fixturePath = join(scratch, 'fixture.mp4');
    await execFileAsync(toolPath('ffmpeg'), [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10',
        '-t', '1', '-an', '-c:v', 'mpeg4', '-movflags', '+faststart', fixturePath
    ], { timeout: 30_000 });
    const fixture = await readFile(fixturePath);
    const server = createServer((req, res) => {
        req.resume();
        if (req.method === 'POST' && req.url === '/api/chat') {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            res.end(JSON.stringify({ message: { content: 'Packaged smoke test passed.' }, done: true }) + '\n');
        } else if (req.url === '/fixture.mp4') {
            res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fixture.length });
            res.end(req.method === 'HEAD' ? undefined : fixture);
        } else {
            res.writeHead(404).end();
        }
    });

    let child;
    let output = '';
    const profile = join(scratch, 'profile');
    const downloadFolder = join(scratch, 'downloads');
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        await mkdir(profile);
        await mkdir(downloadFolder);
        await writeFile(join(profile, 'user-settings.json'), JSON.stringify({
            firstRunFolderPrompted: true,
            downloadFolder,
            aiMode: 'ai',
            aiProvider: 'ollama',
            aiProviderConfigs: { ollama: { baseUrl: base, model: 'packaged-smoke' } }
        }));
        const args = [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'];
        if (process.platform === 'darwin') args.push('--use-mock-keychain');
        if (process.platform === 'linux' && process.env.VIDBUTLER_SMOKE_NO_SANDBOX === '1') args.push('--no-sandbox');
        child = spawn(executable, args, {
            cwd: dirname(executable),
            detached: process.platform !== 'win32',
            env: { ...process.env, VIDBUTLER_SKIP_LAUNCH_UPDATE_CHECK: '1' }
        });
        for (const stream of [child.stdout, child.stderr]) {
            stream.on('data', (bytes) => { output = (output + bytes.toString()).slice(-8000); });
        }
        await once(child, 'spawn');
        // Allow for cold starts on macOS before timing the renderer checks.
        const address = await runStage('Find the packaged renderer', (signal) => waitForRenderer(profile, child, signal), 180_000);
        const evaluate = (stage, expression) => runStage(stage, (signal) => evaluateRenderer(address, expression, signal));

        const { mode, classicLoaded } = await runStage('Load the app UI', (signal) => waitForAppUi(address, signal));
        assert.equal(mode, 'ai');
        assert.equal(classicLoaded, true);

        const info = await evaluate('Read app info through IPC', 'window.electronAPI.getAppInfo()');
        assert.equal(info.isPackaged, true);
        assert.equal(info.platform, process.platform);
        assert.deepEqual(info.bundledTools, toolVersions);

        const dependencies = await evaluate('Check bundled dependencies through IPC', 'window.electronAPI.checkDependencies()');
        assert.equal(dependencies.allInstalled, true);
        for (const name of ['yt-dlp', 'ffmpeg']) {
            const detected = dependencies.dependencies.find((tool) => tool.name === name);
            assert(detected?.installed, `App did not find ${name}`);
            assert.equal(await realpath(detected.path), await realpath(toolPath(name)));
        }
        const classicArgs = ['--ignore-config', '--no-playlist', '-P', downloadFolder, base + '/fixture.mp4'];
        const classic = await evaluate('Download the local fixture in Classic mode', `window.electronAPI.runCommand(${JSON.stringify(classicArgs)})`);
        assert.equal(classic.success, true, classic.output);
        const saved = (await readdir(downloadFolder)).find((name) => name.endsWith('.mp4'));
        assert(saved, 'Classic download did not produce an MP4.');
        assert.deepEqual(await readFile(join(downloadFolder, saved)), fixture);
        const { ai, events } = await evaluate('Stream a reply from the local AI fixture', `(${checkAiStreaming.toString()})(${JSON.stringify(downloadFolder)})`);
        assert.equal(ai.ok, true, JSON.stringify(ai));
        assert.equal(ai.text, 'Packaged smoke test passed.');
        assert.deepEqual(events, ['assistant_delta', 'assistant_text']);
        console.log(`${target}: packaged renderer, bundled tools, Classic download, and AI streaming passed.`);
    } catch (error) {
        if (output) console.error(output);
        throw error;
    } finally {
        server.close();
        server.closeAllConnections();
        await stopApp(child);
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const [, , target, outputDir = metadata.build.directories.output] = process.argv;
    assert(/^(darwin|win32|linux)-(x64|arm64)$/.test(target), 'Usage: node scripts/verify-package.mjs <target> [output-directory]');
    assert(target.startsWith(process.platform + '-'), `Run the ${target} smoke test on its own platform.`);
    const scratch = await mkdtemp(join(tmpdir(), 'vidbutler-package-'));
    try {
        await smokePackage(target, resolve(outputDir), scratch);
    } finally {
        await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

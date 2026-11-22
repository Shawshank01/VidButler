import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const SETTINGS_FILE = 'user-settings.json';
export const AI_KEYS_FILE = 'ai-keys.json';
export const TOOL_DATA_DIR = 'tool-data';
export const PROFILE_DATA_ENTRIES = [
    SETTINGS_FILE, AI_KEYS_FILE, TOOL_DATA_DIR,
    'Cache', 'Code Cache', 'Crashpad', 'DIPS', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Extension State',
    'GPUCache', 'GPUPersistentCache', 'GraphiteDawnCache', 'Local State', 'Local Storage', 'Network',
    'Network Persistent State', 'Preferences', 'Session Storage', 'Shared Dictionary', 'Trust Tokens',
    'Trust Tokens-journal', 'blob_storage', 'declarative_performance_observer.db',
    'declarative_performance_observer.db-journal'
];

const SCRATCH_SESSION = /^run-(\d+)-[a-zA-Z0-9]{6}$/;
const SETTINGS_TEMP = /^(?:user-settings|ai-keys)\.json\.\d+\.tmp$/;
let runtime;
let activeTools = 0;
let toolsLocked = false;

function processIsGone(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid) return false;
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return error.code === 'ESRCH';
    }
}

export async function prepareToolData(userData) {
    const root = join(userData, TOOL_DATA_DIR);
    const scratchRoot = join(root, 'scratch');
    await fs.mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(scratchRoot, { withFileTypes: true })) {
        const owner = SCRATCH_SESSION.exec(entry.name)?.[1];
        if (entry.isDirectory() && owner && processIsGone(Number(owner))) {
            await fs.rm(join(scratchRoot, entry.name), { recursive: true, force: true, maxRetries: 2 }).catch((error) => {
                console.warn('[local-data] Could not clear a stale scratch session:', error.message);
            });
        }
    }
    runtime = {
        ytDlpCache: join(root, 'yt-dlp'),
        denoCache: join(root, 'deno'),
        scratch: await fs.mkdtemp(join(scratchRoot, `run-${process.pid}-`))
    };
}

export function getScratchDirectory() {
    return runtime?.scratch ?? tmpdir();
}

export function toolEnvironment(env = process.env) {
    return runtime ? {
        ...env, DENO_DIR: runtime.denoCache, TMPDIR: runtime.scratch, TMP: runtime.scratch, TEMP: runtime.scratch
    } : env;
}

export function spawnYtDlp(executable, args, options = {}) {
    if (toolsLocked) throw new Error('Local data cleanup is in progress.');
    const cacheArgs = runtime ? ['--cache-dir', runtime.ytDlpCache, ...args] : args;
    const env = toolEnvironment(options.env);
    const proxyIndex = args.indexOf('--proxy');
    const proxy = proxyIndex >= 0 ? args[proxyIndex + 1] : undefined;
    // FFmpeg honors inherited proxy exceptions even when yt-dlp sets http_proxy explicitly.
    const usesHttpProxy = typeof proxy === 'string' && proxy.startsWith('http://');
    const childEnv = usesHttpProxy
        ? Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'NO_PROXY'))
        : env;
    const child = spawn(executable, cacheArgs, { ...options, env: childEnv });
    activeTools += 1;
    child.once('close', () => { activeTools -= 1; });
    return child;
}

// The cleanup handler holds this lock until quit, or releases it if cleanup fails.
export function lockToolData() {
    if (activeTools || toolsLocked) return false;
    toolsLocked = true;
    return true;
}

export function unlockToolData() {
    toolsLocked = false;
}

function contains(parent, child) {
    const path = relative(parent, child);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

async function resolveExistingPath(path) {
    try {
        return await fs.realpath(path);
    } catch (error) {
        if (error.code === 'ENOENT') return resolve(path);
        throw error;
    }
}

export async function isManagedDownloadFolder(userData, folder) {
    if (typeof folder !== 'string' || !folder.trim()) return false;
    const absoluteFolder = resolve(folder.trim());
    const resolvedFolder = await resolveExistingPath(absoluteFolder);
    for (const entry of PROFILE_DATA_ENTRIES) {
        const path = join(userData, entry);
        if (contains(path, absoluteFolder) || contains(await resolveExistingPath(path), resolvedFolder)) return true;
    }
    return false;
}

export async function deleteLocalDataFiles(userData) {
    const entries = await fs.readdir(userData);
    const names = [SETTINGS_FILE, AI_KEYS_FILE, TOOL_DATA_DIR, ...entries.filter((name) => SETTINGS_TEMP.test(name))];
    for (const name of names) {
        await fs.rm(join(userData, name), { recursive: name === TOOL_DATA_DIR, force: true, maxRetries: 2 });
    }
}

import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } from 'electron';
import updaterPackage from 'electron-updater';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { mkdir, stat } from 'fs/promises';

import { AppUpdateService, MAC_UPDATE_COMMAND } from './update.js';
import {
    setupEnvironmentPaths,
    checkSystemDependencies
} from './dependencies.js';
import {
    cancelCurrentTask,
    runYtDlp,
    getFormatInfo,
    listSubtitles,
    reEncodeToMp4,
    downloadWithHardsub,
    deleteTemporaryFiles
} from './core/tools.js';
import { ChatService, AiSettingsError } from './llm/chat-service.js';
import { sanitizeClassicSettings } from './settings-schema.js';
import { SettingsStore } from './settings-store.js';
import { KeyStore } from './llm/key-store.js';

const { autoUpdater } = updaterPackage;

// ESM-compatible dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent user settings. New installations start in AI mode; existing ones keep what they saved.
const FIRST_RUN_SETTINGS = { aiMode: 'ai' };

let settingsStore = null;

// Created lazily because app.getPath('userData') is only reliable once Electron is set up.
function getSettingsStore() {
    if (!settingsStore) {
        settingsStore = new SettingsStore({
            filePath: join(app.getPath('userData'), 'user-settings.json'),
            firstRunDefaults: FIRST_RUN_SETTINGS,
            log: (message) => console.error(`[settings] ${message}`)
        });
    }
    return settingsStore;
}

const readSettings = () => getSettingsStore().read();
const mergeSettings = (updates) => getSettingsStore().merge(updates);

let appUpdateService = null;

function getAppUpdateService() {
    if (!appUpdateService) {
        appUpdateService = new AppUpdateService({
            app,
            updater: autoUpdater,
            log: console
        });
        appUpdateService.onProgress((progress) => {
            for (const win of BrowserWindow.getAllWindows()) {
                if (win.isDestroyed()) continue;
                win.setProgressBar(progress.percent / 100);
                if (!win.webContents.isDestroyed()) {
                    win.webContents.send('app-update-progress', progress);
                }
            }
        });
    }
    return appUpdateService;
}

function clearUpdateProgress() {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setProgressBar(-1);
    }
}

ipcMain.handle('get-settings', async () => readSettings());

ipcMain.handle('set-settings', async (_event, updates) => {
    // Only the classic UI's own preferences are accepted here (allow-list). AI settings may only
    // change through the validated ai-* handlers below.
    return mergeSettings(sanitizeClassicSettings(updates));
});

// Fix PATH globally so yt-dlp and ffmpeg are found across all environments (MacPorts, Homebrew, system)
setupEnvironmentPaths();

// Helper: forward progress text from core operations to the renderer that requested them
function progressReporter(event) {
    return (text) => event.sender.send('download-progress', text);
}

// Unified IPC handler for cancelling the current action
ipcMain.handle('cancel-command', async () => {
    return cancelCurrentTask();
});

async function promptInitialDownloadFolder(win) {
    if (!win || win.isDestroyed()) return;

    const settings = await readSettings();
    if (win.isDestroyed()) return;

    let defaultFolder;
    try {
        defaultFolder = join(app.getPath('downloads'), 'VidButler');
    } catch {
        defaultFolder = join(app.getPath('home'), 'Downloads', 'VidButler');
    }

    let hasValidFolder = false;
    if (typeof settings.downloadFolder === 'string' && settings.downloadFolder.trim() !== '') {
        try {
            const s = await stat(settings.downloadFolder.trim());
            hasValidFolder = s.isDirectory();
        } catch {
            hasValidFolder = false;
        }
    }

    if (hasValidFolder) {
        return;
    }
    if (settings.firstRunFolderPrompted && !settings.downloadFolder) {
        return;
    }

    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Create Default Folder', 'Select Existing Folder…', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Welcome to VidButler',
        message: 'Set Download Location',
        detail: `Where would you like to save your downloads?\n\nYou can create the default folder:\n${defaultFolder}\n\nor select a different folder instead.`
    });

    if (win.isDestroyed()) return;

    if (response === 0) {
        try {
            await mkdir(defaultFolder, { recursive: true });
            await mergeSettings({ downloadFolder: defaultFolder, firstRunFolderPrompted: true });
            if (!win.isDestroyed()) {
                win.webContents.send('download-folder-updated', defaultFolder);
            }
        } catch (err) {
            console.error('[main] Failed to access or create Downloads folder:', err);
            if (!win.isDestroyed()) {
                await dialog.showMessageBox(win, {
                    type: 'error',
                    title: 'Folder Access Failed',
                    message: 'Could not access or create the Downloads folder.',
                    detail: `${err.message}\n\nPlease select an existing folder instead.`
                });
                const result = await dialog.showOpenDialog(win, {
                    properties: ['openDirectory'],
                    title: 'Select Download Folder'
                });
                if (!win.isDestroyed()) {
                    if (!result.canceled && result.filePaths.length > 0) {
                        const chosen = result.filePaths[0];
                        await mergeSettings({ downloadFolder: chosen, firstRunFolderPrompted: true });
                        win.webContents.send('download-folder-updated', chosen);
                    } else {
                        await mergeSettings({ firstRunFolderPrompted: true });
                    }
                }
            }
        }
    } else if (response === 1) {
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
            title: 'Select Download Folder'
        });
        if (!win.isDestroyed()) {
            if (!result.canceled && result.filePaths.length > 0) {
                const chosen = result.filePaths[0];
                await mergeSettings({ downloadFolder: chosen, firstRunFolderPrompted: true });
                if (!win.isDestroyed()) {
                    win.webContents.send('download-folder-updated', chosen);
                }
            } else {
                await mergeSettings({ firstRunFolderPrompted: true });
            }
        }
    } else {
        await mergeSettings({ firstRunFolderPrompted: true });
    }
}

function plainReleaseNotes(notes) {
    return String(notes || '')
        .replace(/<[^>]*>/g, '')
        .trim()
        .slice(0, 2000);
}

async function checkForUpdatesOnLaunch(win) {
    const service = getAppUpdateService();
    if (!service.canCheckForUpdates() || !win || win.isDestroyed()) return;

    const update = await service.checkForUpdates();
    if (update.error) {
        console.error(`[update] Launch check failed: ${update.message}`);
        return;
    }
    if (!update.hasUpdate || win.isDestroyed()) return;

    const notes = plainReleaseNotes(update.releaseNotes);
    if (update.updateMethod === 'homebrew') {
        const { response } = await dialog.showMessageBox(win, {
            type: 'info',
            buttons: ['Copy Homebrew Command', 'Open GitHub Release', 'Later'],
            defaultId: 0,
            cancelId: 2,
            title: 'VidButler Update Available',
            message: `VidButler ${update.version} is available`,
            detail:
                `You are using version ${update.currentVersion}. This unsigned macOS build updates through Homebrew.\n\n` +
                `Recommended command:\n${MAC_UPDATE_COMMAND}\n\n` +
                'If you installed VidButler from a DMG instead, open the GitHub release.' +
                (notes ? `\n\n${notes}` : '')
        });

        if (response === 0) {
            clipboard.writeText(MAC_UPDATE_COMMAND);
        } else if (response === 1) {
            await shell.openExternal(update.releaseUrl);
        }
        return;
    }

    const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Download and Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'VidButler Update Available',
        message: `VidButler ${update.version} is available`,
        detail:
            `You are using version ${update.currentVersion}. ` +
            'Download the verified update now? VidButler will restart automatically when it is ready.' +
            (notes ? `\n\n${notes}` : '')
    });

    if (response !== 0 || win.isDestroyed()) return;

    const result = await service.downloadUpdate();
    clearUpdateProgress();
    if (!result.success) {
        if (!win.isDestroyed()) {
            await dialog.showMessageBox(win, {
                type: 'error',
                title: 'Update Failed',
                message: 'VidButler could not download the update.',
                detail: result.error
            });
        }
        return;
    }

    service.installUpdate();
}

function createWindow() {
    const iconPath = join(__dirname, '../build/icon.png');
    const win = new BrowserWindow({
        fullscreenable: true,
        ...(existsSync(iconPath) ? { icon: iconPath } : {}),
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    win.loadFile(join(__dirname, 'index.html'));

    // Maximise the window
    win.maximize();

    win.webContents.once('did-finish-load', async () => {
        try {
            await promptInitialDownloadFolder(win);
            await checkForUpdatesOnLaunch(win);
        } catch (err) {
            console.error('[main] Error during launch setup:', err);
        }
    });
}

let asyncEncryptionAvailable = null;

async function initSafeStorageAvailability() {
    if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
        try {
            asyncEncryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
        } catch {
            asyncEncryptionAvailable = false;
        }
    } else if (typeof safeStorage.isEncryptionAvailable === 'function') {
        try {
            asyncEncryptionAvailable = safeStorage.isEncryptionAvailable();
        } catch {
            asyncEncryptionAvailable = false;
        }
    } else {
        asyncEncryptionAvailable = false;
    }
}

app.whenReady().then(async () => {
    const iconPath = join(__dirname, '../build/icon.png');
    if (process.platform === 'darwin' && app.dock && existsSync(iconPath)) {
        try {
            app.dock.setIcon(iconPath);
        } catch (err) {
            console.error('[main] Failed to set dock icon:', err);
        }
    }
    await initSafeStorageAvailability();
    createWindow();
}).catch(console.error);

// IPC handler for folder picker
ipcMain.handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    return result.canceled || result.filePaths.length === 0 ? '' : result.filePaths[0];
});

// IPC handler to fetch format metadata for a specific format code
ipcMain.handle('get-format-info', async (_event, args) => getFormatInfo(args));

// IPC handler for running yt-dlp commands
ipcMain.handle('run-command', async (event, args) => runYtDlp(args, progressReporter(event)));

// IPC handler for re-encoding videos to MP4 with H.264 and AAC
ipcMain.handle('re-encode-to-mp4', async (event, downloadFolder, videoId) =>
    reEncodeToMp4(downloadFolder, videoId, progressReporter(event))
);

// IPC handler for opening external links
ipcMain.handle('open-external', async (_event, url) => {
    if (typeof url !== 'string' || url.trim() === '') {
        return false;
    }

    try {
        await shell.openExternal(url);
        return true;
    } catch (error) {
        console.error('Failed to open external URL:', error);
        return false;
    }
});

// App update-related IPC handlers. Checking never downloads; the renderer asks for explicit
// consent before calling download-app-update, and installation is allowed only after that download.
ipcMain.handle('check-app-update', async () => getAppUpdateService().checkForUpdates());
ipcMain.handle('download-app-update', async () => {
    const result = await getAppUpdateService().downloadUpdate();
    clearUpdateProgress();
    return result;
});
ipcMain.handle('install-app-update', async () => getAppUpdateService().installUpdate());
ipcMain.handle('copy-mac-update-command', async () => {
    clipboard.writeText(MAC_UPDATE_COMMAND);
    return true;
});
ipcMain.handle('get-current-version', async () => app.getVersion());
ipcMain.handle('is-auto-updater-supported', async () => getAppUpdateService().canInstallUpdate());
ipcMain.handle('get-app-info', async () => {
    let bundledTools = {
        'yt-dlp': '2026.10.26',
        ffmpeg: '9.0.2',
        deno: '2.9.8'
    };
    try {
        const toolsPath = join(app.getAppPath(), 'tools-versions.json');
        bundledTools = JSON.parse(readFileSync(toolsPath, 'utf8'));
    } catch {
        // Fall back to default pinned versions
    }
    return {
        name: 'VidButler',
        version: app.getVersion(),
        developer: 'Michifumi',
        isPackaged: app.isPackaged,
        bundledTools,
        platform: process.platform
    };
});
ipcMain.handle('check-dependencies', async () => checkSystemDependencies());

// IPC handler for listing available subtitles
ipcMain.handle('list-subtitles', async (_event, url, browser, proxy) => listSubtitles(url, browser, proxy));

// IPC handler for downloading video with hardcoded subtitles
ipcMain.handle('download-with-hardsub', async (event, options) =>
    downloadWithHardsub(options, progressReporter(event))
);

ipcMain.handle('delete-temporary-files', async (_event, paths) => deleteTemporaryFiles(paths));

// ---------------------------------------------------------------------------
// AI mode (prompt-driven assistant). The service is created lazily because
// safeStorage and userData paths are only reliable once the app is ready.
// API keys never leave the main process: the renderer can set/remove them and
// learn whether one exists, but cannot read them back.
// ---------------------------------------------------------------------------
let chatService = null;

function getChatService() {
    if (!chatService) {
        const keyStore = new KeyStore({
            filePath: join(app.getPath('userData'), 'ai-keys.json'),
            crypto: {
                // On Linux without a keyring Electron falls back to a hard-coded password ("basic_text"),
                // which is not real protection, so treat that as unavailable.
                isAvailable: () => {
                    if (asyncEncryptionAvailable !== null) {
                        if (!asyncEncryptionAvailable) return false;
                    } else if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
                        // Modern Electron supports async encryption; avoid calling deprecated sync method
                        return true;
                    } else if (typeof safeStorage.isEncryptionAvailable === 'function') {
                        if (!safeStorage.isEncryptionAvailable()) return false;
                    }
                    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
                        return safeStorage.getSelectedStorageBackend() !== 'basic_text';
                    }
                    return true;
                },
                encrypt: async (plain) => {
                    if (typeof safeStorage.encryptStringAsync === 'function') {
                        return safeStorage.encryptStringAsync(plain);
                    }
                    return safeStorage.encryptString(plain);
                },
                decrypt: async (encrypted) => {
                    if (typeof safeStorage.decryptStringAsync === 'function') {
                        const res = await safeStorage.decryptStringAsync(encrypted);
                        return typeof res === 'object' && res !== null ? res.result : res;
                    }
                    return safeStorage.decryptString(encrypted);
                }
            }
        });

        chatService = new ChatService({
            settings: { read: readSettings, merge: mergeSettings },
            keyStore,
            log: (message) => console.log(`[ai] ${message}`),
            // Events are delivered per request to the window that sent it (see 'ai-send').
            emit: () => { }
        });
    }
    return chatService;
}

// Wrap a handler so expected validation errors come back as { ok: false, error } instead of
// an opaque "Error invoking remote method" rejection. `ok` is set last so a handler's own
// result can never override it.
function aiHandler(fn) {
    return async (event, ...args) => {
        try {
            return { ...(await fn(event, ...args)), ok: true };
        } catch (err) {
            if (err instanceof AiSettingsError) return { ok: false, error: err.message };
            console.error('AI handler error:', err.message);
            return { ok: false, error: 'Unexpected error.' };
        }
    };
}

ipcMain.handle('ai-get-settings', aiHandler(async () => ({ settings: await getChatService().getSettings() })));

ipcMain.handle('ai-set-settings', aiHandler(async (_event, update) => ({
    settings: await getChatService().setSettings(update)
})));

ipcMain.handle('ai-set-api-key', aiHandler(async (_event, type, apiKey) => getChatService().setApiKey(type, apiKey)));

ipcMain.handle('ai-remove-api-key', aiHandler(async (_event, type) => ({
    settings: await getChatService().removeApiKey(type)
})));

ipcMain.handle('ai-test-connection', async (_event, overrides) => getChatService().testConnection(overrides || {}));

// Returns { ok: true, text, stoppedBecause, steps } or { ok: false, error: { kind, message } }.
// Live events (assistant text, tool start/result, progress, confirmation requests) arrive on 'ai-event'.
ipcMain.handle('ai-send', async (event, message, context) => {
    const sender = event.sender;
    const service = getChatService();
    const emit = (payload) => {
        if (!sender.isDestroyed()) sender.send('ai-event', payload);
    };

    // If the window goes away or reloads, nobody can answer a confirmation or read the events, so
    // stop the request instead of leaving it waiting (and a download running) in the background.
    const abort = () => service.cancel();
    const onNavigate = (details) => {
        if (details.isMainFrame && !details.isSameDocument) abort();
    };
    sender.once('destroyed', abort);
    sender.once('render-process-gone', abort);
    sender.on('did-start-navigation', onNavigate);
    try {
        return await service.send(message, context || {}, { emit });
    } finally {
        if (!sender.isDestroyed()) {
            sender.removeListener('destroyed', abort);
            sender.removeListener('render-process-gone', abort);
            sender.removeListener('did-start-navigation', onNavigate);
        }
    }
});

ipcMain.handle('ai-cancel', async () => getChatService().cancel());

ipcMain.handle('ai-reset', async () => getChatService().reset());

ipcMain.handle('ai-confirm-response', async (_event, requestId, approved) =>
    getChatService().resolveConfirmation(requestId, approved === true)
);

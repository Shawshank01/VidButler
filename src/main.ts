import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } from 'electron';
import type {
    Event, IpcMainInvokeEvent, MessageBoxOptions, OpenDialogOptions, WebContents, WebContentsDidStartNavigationEventParams
} from 'electron';
import updaterPackage from 'electron-updater';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { mkdir, stat } from 'fs/promises';

import { AppUpdateService, MAC_UPDATE_COMMAND } from './update.js';
import { checkSystemDependencies } from './dependencies.js';
import { isAllowedExternalUrl } from './external-url.js';
import {
    cancelCurrentTask,
    runYtDlp,
    getFormatInfo,
    listSubtitles,
    reEncodeToMp4,
    downloadWithHardsub,
    deleteTemporaryFiles
} from './core/tools.ts';
import { ChatService, AiSettingsError } from './llm/chat-service.js';
import { MESSAGES } from './llm/messages.js';
import { sanitizeClassicSettings } from './settings-schema.js';
import { SettingsStore } from './settings-store.js';
import { KeyStore } from './llm/key-store.js';
import { taskManager } from './core/task-manager.ts';
import {
    SETTINGS_FILE, AI_KEYS_FILE, prepareToolData, lockToolData, unlockToolData,
    isManagedDownloadFolder, deleteLocalDataFiles
} from './core/local-data.js';

import type { IpcEvents, InvokeArgs, InvokeChannel, InvokeResult } from './types/ipc.ts';

function handle<C extends InvokeChannel>(channel: C, listener: (
    event: IpcMainInvokeEvent, ...args: InvokeArgs<NoInfer<C>>
) => InvokeResult<NoInfer<C>> | Promise<InvokeResult<NoInfer<C>>>) {
    ipcMain.handle(channel, listener);
}

function sendEvent<C extends keyof IpcEvents>(sender: WebContents, channel: C, payload: IpcEvents[NoInfer<C>]) {
    if (!sender.isDestroyed()) sender.send(channel, payload);
}

const { autoUpdater } = updaterPackage;

// ESM-compatible dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent user settings. New installations start in AI mode; existing ones keep what they saved.
const FIRST_RUN_SETTINGS = { aiMode: 'ai' };

let settingsStore: SettingsStore | null = null;
let deletingLocalData = false;
let activeProfileOperations = 0;
const CLEANUP_BUSY = 'Wait for the current activity to finish and try again.';

// Created lazily because app.getPath('userData') is only reliable once Electron is set up.
function getSettingsStore() {
    if (!settingsStore) {
        settingsStore = new SettingsStore({
            filePath: join(app.getPath('userData'), SETTINGS_FILE),
            firstRunDefaults: FIRST_RUN_SETTINGS,
            log: (message) => console.error(`[settings] ${message}`)
        });
    }
    return settingsStore;
}

const readSettings = () => getSettingsStore().read();
const mergeSettings = (updates: object) => {
    if (deletingLocalData) throw new Error(CLEANUP_BUSY);
    return getSettingsStore().merge(updates);
};

let appUpdateService: AppUpdateService | null = null;

function getAppUpdateService() {
    if (!appUpdateService) {
        appUpdateService = new AppUpdateService({
            app,
            updater: autoUpdater,
            log: console
        });
        appUpdateService.onProgress((progress: IpcEvents['app-update-progress']) => {
            for (const win of BrowserWindow.getAllWindows()) {
                if (win.isDestroyed()) continue;
                win.setProgressBar(progress.percent / 100);
                sendEvent(win.webContents, 'app-update-progress', progress);
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

handle('get-settings', async () => readSettings());

handle('set-settings', async (_event, updates) => {
    // Only the classic UI's own preferences are accepted here (allow-list). AI settings may only
    // change through the validated ai-* handlers below.
    return mergeSettings(sanitizeClassicSettings(updates));
});

// PATH is configured when dependencies.js is first imported, so yt-dlp and ffmpeg are found across all
// environments (MacPorts, Homebrew, system) and bundled tools take precedence.

// Helper: forward progress text from core operations to the renderer that requested them.
// The window may be closed while a task is still running; sending to it would then throw.
function progressReporter(event: IpcMainInvokeEvent) {
    return (text: string) => sendEvent(event.sender, 'download-progress', text);
}

// Unified IPC handler for cancelling the current action
handle('cancel-command', async () => {
    return cancelCurrentTask();
});

async function promptInitialDownloadFolder(win: BrowserWindow) {
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
            if (await isManagedDownloadFolder(app.getPath('userData'), defaultFolder)) {
                throw new Error('The default download location overlaps VidButler\'s managed data.');
            }
            await mkdir(defaultFolder, { recursive: true });
            await mergeSettings({ downloadFolder: defaultFolder, firstRunFolderPrompted: true });
            if (!win.isDestroyed()) {
                sendEvent(win.webContents, 'download-folder-updated', defaultFolder);
            }
        } catch (err) {
            console.error('[main] Failed to access or create Downloads folder:', err);
            if (!win.isDestroyed()) {
                await dialog.showMessageBox(win, {
                    type: 'error',
                    title: 'Folder Access Failed',
                    message: 'Could not access or create the Downloads folder.',
                    detail: `${err instanceof Error ? err.message : String(err)}\n\nPlease select an existing folder instead.`
                });
                const chosen = await chooseDownloadFolder(win, 'Select Download Folder');
                if (!win.isDestroyed()) {
                    if (chosen) {
                        await mergeSettings({ downloadFolder: chosen, firstRunFolderPrompted: true });
                        if (!win.isDestroyed()) sendEvent(win.webContents, 'download-folder-updated', chosen);
                    } else {
                        await mergeSettings({ firstRunFolderPrompted: true });
                    }
                }
            }
        }
    } else if (response === 1) {
        const chosen = await chooseDownloadFolder(win, 'Select Download Folder');
        if (!win.isDestroyed()) {
            if (chosen) {
                await mergeSettings({ downloadFolder: chosen, firstRunFolderPrompted: true });
                if (!win.isDestroyed()) {
                    sendEvent(win.webContents, 'download-folder-updated', chosen);
                }
            } else {
                await mergeSettings({ firstRunFolderPrompted: true });
            }
        }
    } else {
        await mergeSettings({ firstRunFolderPrompted: true });
    }
}

function plainReleaseNotes(notes: unknown) {
    return String(notes || '')
        .replace(/<[^>]*>/g, '')
        .trim()
        .slice(0, 2000);
}

async function checkForUpdatesOnLaunch(win: BrowserWindow) {
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
                `You are using version ${update.currentVersion}. You can update through Homebrew.\n\n` +
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
    const indexPath = join(__dirname, 'index.html');
    const allowedAppUrl = pathToFileURL(indexPath).href;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, navigationUrl) => {
        if (navigationUrl !== allowedAppUrl && !navigationUrl.startsWith(`${allowedAppUrl}#`)) {
            event.preventDefault();
        }
    });
    win.loadFile(indexPath);

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

let asyncEncryptionAvailable: boolean | null = null;

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

async function startApp() {
    await prepareToolData(app.getPath('userData'));
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
}

if (app.requestSingleInstanceLock()) {
    app.on('second-instance', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });
    app.whenReady().then(startApp).catch((error) => {
        console.error('[main] Startup failed:', error);
        dialog.showErrorBox('VidButler Could Not Start', error.message);
        app.quit();
    });
} else {
    app.quit();
}

async function chooseDownloadFolder(win: BrowserWindow | null, title?: string) {
    const options: OpenDialogOptions = { properties: ['openDirectory'], ...(title ? { title } : {}) };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = result.canceled ? '' : (result.filePaths[0] || '');
    if (folder && await isManagedDownloadFolder(app.getPath('userData'), folder)) {
        const message: MessageBoxOptions = {
            type: 'warning',
            message: 'Choose another download folder',
            detail: 'This folder is used for VidButler data that can be removed during cleanup.'
        };
        if (win && !win.isDestroyed()) await dialog.showMessageBox(win, message);
        else await dialog.showMessageBox(message);
        return '';
    }
    return folder;
}

// IPC handler for folder picker
handle('choose-folder', async (event) => chooseDownloadFolder(BrowserWindow.fromWebContents(event.sender)));

// IPC handler to fetch format metadata for a specific format code
handle('get-format-info', async (_event, args) => getFormatInfo(args));

// IPC handler for running yt-dlp commands
handle('run-command', async (event, args) => runYtDlp(args, progressReporter(event)));

// IPC handler for re-encoding videos to MP4 with H.264 and AAC
handle('re-encode-to-mp4', async (event, downloadFolder, videoId) =>
    reEncodeToMp4(downloadFolder, videoId, progressReporter(event))
);

// IPC handler for opening external links (http(s) and the macOS privacy settings pane only)
handle('open-external', async (_event, url) => {
    if (!isAllowedExternalUrl(url)) {
        return false;
    }

    try {
        await shell.openExternal(url.trim());
        return true;
    } catch (error) {
        console.error('Failed to open external URL:', error);
        return false;
    }
});

// App update-related IPC handlers. Checking never downloads; the renderer asks for explicit
// consent before calling download-app-update, and installation is allowed only after that download.
handle('check-app-update', async () => getAppUpdateService().checkForUpdates());
handle('download-app-update', async () => {
    if (deletingLocalData) return { success: false, error: CLEANUP_BUSY };
    const result = await getAppUpdateService().downloadUpdate();
    clearUpdateProgress();
    return result;
});
handle('install-app-update', async () => !deletingLocalData && getAppUpdateService().installUpdate());
handle('copy-mac-update-command', async () => {
    clipboard.writeText(MAC_UPDATE_COMMAND);
    return true;
});
handle('get-current-version', async () => app.getVersion());

handle('get-app-info', async () => {
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
handle('check-dependencies', async () => {
    if (deletingLocalData) return { success: false, message: CLEANUP_BUSY };
    activeProfileOperations += 1;
    try {
        return await checkSystemDependencies();
    } finally {
        activeProfileOperations -= 1;
    }
});

handle('delete-local-data', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, cancelled: true };

    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Delete Local Data',
        message: 'Delete VidButler\'s local data and quit?',
        detail: 'This clears the settings, saved API keys, and caches shared by development and release. Your downloaded files are kept.',
        buttons: ['Cancel', 'Delete and Quit'],
        cancelId: 0,
        defaultId: 0
    });
    if (response !== 1 || win.isDestroyed()) return { ok: false, cancelled: true };
    if (deletingLocalData || activeProfileOperations || taskManager.hasActiveTask() || chatService?.isBusy()
        || appUpdateService?.downloadPromise || !lockToolData()) {
        return { ok: false, error: CLEANUP_BUSY };
    }

    deletingLocalData = true;
    const userData = app.getPath('userData');
    let deleted = false;
    let deletingFiles = false;
    try {
        await getSettingsStore().queue;
        const { downloadFolder } = await readSettings();
        if (await isManagedDownloadFolder(userData, downloadFolder)) {
            return { ok: false, error: 'Move your downloads out of the managed data folder before deleting local data.' };
        }
        const session = event.sender.session;
        await session.clearData();
        await session.clearCodeCaches({});
        deletingFiles = true;
        await deleteLocalDataFiles(userData);
        deleted = true;
        setImmediate(() => app.quit());
        return { ok: true };
    } catch (error) {
        console.error('[main] Local data cleanup failed:', error);
        if (deletingFiles) await prepareToolData(userData).catch((err) => console.error('[main] Could not reopen tool data:', err));
        return { ok: false, error: 'Could not finish deleting local data.' };
    } finally {
        // The profile remains locked on success until the scheduled quit.
        if (!deleted) {
            deletingLocalData = false;
            unlockToolData();
        }
    }
});

// IPC handler for listing available subtitles
handle('list-subtitles', async (_event, url, browser, proxy) => listSubtitles(url, browser, proxy));

// IPC handler for downloading video with hardcoded subtitles
handle('download-with-hardsub', async (event, options) =>
    downloadWithHardsub(options, progressReporter(event))
);

handle('delete-temporary-files', async (_event, paths) => deleteTemporaryFiles(paths));

// ---------------------------------------------------------------------------
// AI mode (prompt-driven assistant). The service is created lazily because
// safeStorage and userData paths are only reliable once the app is ready.
// API keys never leave the main process: the renderer can set/remove them and
// learn whether one exists, but cannot read them back.
// ---------------------------------------------------------------------------
let chatService: ChatService | null = null;
let activeAiSender: WebContents | null = null;

function getChatService() {
    if (!chatService) {
        const keyStore = new KeyStore({
            filePath: join(app.getPath('userData'), AI_KEYS_FILE),
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
function aiHandler<Args extends unknown[], Result extends object>(
    fn: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result>
) {
    return async (event: IpcMainInvokeEvent, ...args: Args): Promise<
        ({ ok: true } & Result) | { ok: false; error: string }
    > => {
        if (deletingLocalData) return { ok: false, error: CLEANUP_BUSY };
        activeProfileOperations += 1;
        try {
            return { ...(await fn(event, ...args)), ok: true };
        } catch (err) {
            if (err instanceof AiSettingsError) return { ok: false, error: err.message };
            console.error('AI handler error:', err instanceof Error ? err.message : 'Unknown error.');
            return { ok: false, error: 'Unexpected error.' };
        } finally {
            activeProfileOperations -= 1;
        }
    };
}

handle('ai-get-settings', aiHandler(async () => ({ settings: await getChatService().getSettings() })));

handle('ai-set-settings', aiHandler(async (_event, update) => ({
    settings: await getChatService().setSettings(update)
})));

handle('ai-set-api-key', aiHandler(async (_event, type, apiKey) => getChatService().setApiKey(type, apiKey)));

handle('ai-remove-api-key', aiHandler(async (_event, type) => ({
    settings: await getChatService().removeApiKey(type)
})));

handle('ai-test-connection', async (_event, overrides) => getChatService().testConnection(overrides || {}));

// Returns { ok: true, text, stoppedBecause, steps } or { ok: false, error: { kind, message } }.
// Live events (assistant text, tool start/result, progress, confirmation requests) arrive on 'ai-event'.
handle('ai-send', async (event, message, context) => {
    if (deletingLocalData) return { ok: false, error: { kind: 'busy', message: CLEANUP_BUSY } };
    if (activeAiSender) return { ok: false, error: { kind: 'busy', message: MESSAGES.assistantBusy } };
    const sender = event.sender;
    const service = getChatService();
    activeAiSender = sender;
    let canDeliver = true;
    const emit = (payload: IpcEvents['ai-event']) => {
        if (canDeliver) sendEvent(sender, 'ai-event', payload);
    };

    // If the window goes away or reloads, nobody can answer a confirmation or read the events, so
    // stop the request instead of leaving it waiting (and a download running) in the background.
    const abort = () => {
        canDeliver = false;
        service.cancel();
    };
    const onNavigate = (details: Event<WebContentsDidStartNavigationEventParams>) => {
        if (details.isMainFrame && !details.isSameDocument) abort();
    };
    sender.once('destroyed', abort);
    sender.once('render-process-gone', abort);
    sender.on('did-start-navigation', onNavigate);
    try {
        return await service.send(message, context || {}, { emit });
    } finally {
        activeAiSender = null;
        if (!sender.isDestroyed()) {
            sender.removeListener('destroyed', abort);
            sender.removeListener('render-process-gone', abort);
            sender.removeListener('did-start-navigation', onNavigate);
        }
    }
});

handle('ai-cancel', async (event) => event.sender === activeAiSender && getChatService().cancel());

handle('ai-reset', async () => getChatService().reset());

handle('ai-confirm-response', async (event, requestId, approved) =>
    event.sender === activeAiSender && getChatService().resolveConfirmation(requestId, approved === true)
);

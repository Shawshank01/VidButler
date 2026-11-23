// @ts-check
const { contextBridge, ipcRenderer } = require('electron');

// Electron's IPC methods are untyped at the transport boundary.
/** @type {import('./types/ipc.ts').Invoke} */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/** @type {import('./types/ipc.ts').Subscribe} */
const subscribe = (channel, callback) => {
    /** @type {(event: import('electron').IpcRendererEvent, payload: Parameters<typeof callback>[0]) => void} */
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
};

/** @type {import('./types/electron.js').ElectronAPI} */
const electronAPI = {
    platform: process.platform,
    chooseFolder: () => invoke('choose-folder'),
    runCommand: (cmd) => invoke('run-command', cmd),
    onProgress: (callback) => subscribe('download-progress', callback),
    onDownloadFolderUpdated: (callback) => subscribe('download-folder-updated', callback),
    checkAppUpdate: () => invoke('check-app-update'),
    downloadAppUpdate: () => invoke('download-app-update'),
    installAppUpdate: () => invoke('install-app-update'),
    copyMacUpdateCommand: () => invoke('copy-mac-update-command'),
    onUpdateAvailable: (callback) => subscribe('app-update-available', callback),
    onUpdateProgress: (callback) => subscribe('app-update-progress', callback),
    getCurrentVersion: () => invoke('get-current-version'),
    getAppInfo: () => invoke('get-app-info'),
    deleteLocalData: () => invoke('delete-local-data'),
    checkDependencies: () => invoke('check-dependencies'),

    reEncodeToMp4: (downloadFolder, videoId) =>
        invoke('re-encode-to-mp4', downloadFolder, videoId),
    openExternal: (url) => invoke('open-external', url),
    openFilesAndFoldersSettings: () =>
        invoke(
            'open-external',
            'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders'
        ),
    // Hardsub feature APIs
    listSubtitles: (url, browser, proxy) => invoke('list-subtitles', url, browser, proxy),
    downloadWithHardsub: (options) => invoke('download-with-hardsub', options),
    // Generic command API
    cancelCommand: () => invoke('cancel-command'),
    deleteTemporaryFiles: (paths) => invoke('delete-temporary-files', paths),
    getFormatInfo: (args) => invoke('get-format-info', args),
    // Persistent user settings
    getSettings: () => invoke('get-settings'),
    setSettings: (updates) => invoke('set-settings', updates),
    // AI mode. API keys can be set or removed but are never readable from the renderer.
    ai: {
        getSettings: () => invoke('ai-get-settings'),
        setSettings: (update) => invoke('ai-set-settings', update),
        setApiKey: (type, apiKey) => invoke('ai-set-api-key', type, apiKey),
        removeApiKey: (type) => invoke('ai-remove-api-key', type),
        testConnection: (overrides) => invoke('ai-test-connection', overrides),
        send: (message, context) => invoke('ai-send', message, context),
        cancel: () => invoke('ai-cancel'),
        reset: () => invoke('ai-reset'),
        confirm: (requestId, approved) => invoke('ai-confirm-response', requestId, approved),
        onEvent: (callback) => subscribe('ai-event', callback)
    }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

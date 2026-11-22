import type { AiSettingsSnapshot } from '../llm/types.js';
import type { EventMethod, InvokeMethod, InvokeResult } from './ipc.ts';

interface AiApi {
    getSettings: InvokeMethod<'ai-get-settings'>;
    setSettings: InvokeMethod<'ai-set-settings'>;
    setApiKey: InvokeMethod<'ai-set-api-key'>;
    removeApiKey: InvokeMethod<'ai-remove-api-key'>;
    testConnection: InvokeMethod<'ai-test-connection'>;
    send: InvokeMethod<'ai-send'>;
    cancel: InvokeMethod<'ai-cancel'>;
    reset: InvokeMethod<'ai-reset'>;
    confirm: InvokeMethod<'ai-confirm-response'>;
    onEvent: EventMethod<'ai-event'>;
}

export interface ElectronAPI {
    ai: AiApi;
    chooseFolder: InvokeMethod<'choose-folder'>;
    runCommand: InvokeMethod<'run-command'>;
    onProgress: EventMethod<'download-progress'>;
    onDownloadFolderUpdated: EventMethod<'download-folder-updated'>;
    checkAppUpdate: InvokeMethod<'check-app-update'>;
    downloadAppUpdate: InvokeMethod<'download-app-update'>;
    installAppUpdate: InvokeMethod<'install-app-update'>;
    copyMacUpdateCommand: InvokeMethod<'copy-mac-update-command'>;
    onUpdateProgress: EventMethod<'app-update-progress'>;
    getCurrentVersion: InvokeMethod<'get-current-version'>;
    getAppInfo: InvokeMethod<'get-app-info'>;
    deleteLocalData: InvokeMethod<'delete-local-data'>;
    checkDependencies: InvokeMethod<'check-dependencies'>;
    reEncodeToMp4: InvokeMethod<'re-encode-to-mp4'>;
    openExternal: InvokeMethod<'open-external'>;
    openFilesAndFoldersSettings: () => Promise<InvokeResult<'open-external'>>;
    platform: NodeJS.Platform;
    listSubtitles: InvokeMethod<'list-subtitles'>;
    downloadWithHardsub: InvokeMethod<'download-with-hardsub'>;
    /** Resolves to true if a task was running and has been cancelled. */
    cancelCommand: InvokeMethod<'cancel-command'>;
    deleteTemporaryFiles: InvokeMethod<'delete-temporary-files'>;
    getFormatInfo: InvokeMethod<'get-format-info'>;
    getSettings: InvokeMethod<'get-settings'>;
    setSettings: InvokeMethod<'set-settings'>;
}

declare global {
    type AiSettings = AiSettingsSnapshot;

    interface Window {
        electronAPI: ElectronAPI;
        chooseFolder: () => Promise<void>;
        checkUpdate: () => Promise<void>;
        runCommand: () => Promise<void>;
    }
}

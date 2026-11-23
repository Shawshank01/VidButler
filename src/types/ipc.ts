import type {
    runYtDlp, reEncodeToMp4, listSubtitles, downloadWithHardsub, getFormatInfo
} from '../core/tools.ts';
import type { checkSystemDependencies } from '../dependencies.js';
import type { AiContext, AiEvent, AiSendResult, AiSettingsSnapshot, AiSettingsUpdate, AiTestConnectionOptions } from '../llm/types.js';
import type { AppUpdateService } from '../update.js';

type UserSettings = Record<string, unknown>;
type DeleteLocalDataResult = { ok: true } | { ok: false; cancelled?: boolean; error?: string };
type AiSettingsResponse = { ok: true; settings: AiSettingsSnapshot } | { ok: false; error: string };
type AiKeyResponse = { ok: true; settings: AiSettingsSnapshot; persisted: boolean } | { ok: false; error: string };

interface AppInfo {
    name: string;
    version: string;
    developer: string;
    isPackaged: boolean;
    bundledTools: Record<string, string>;
    platform: NodeJS.Platform;
}

interface Invocations {
    'choose-folder': [[], string];
    'run-command': [[args: string[]], Awaited<ReturnType<typeof runYtDlp>>];
    'check-app-update': [[], Awaited<ReturnType<AppUpdateService['checkForUpdates']>>];
    'download-app-update': [[], Awaited<ReturnType<AppUpdateService['downloadUpdate']>>];
    'install-app-update': [[], boolean];
    'copy-mac-update-command': [[], boolean];
    'get-current-version': [[], string];
    'get-app-info': [[], AppInfo];
    'delete-local-data': [[], DeleteLocalDataResult];
    'check-dependencies': [[], Awaited<ReturnType<typeof checkSystemDependencies>>];
    're-encode-to-mp4': [[downloadFolder: string, videoId: string], Awaited<ReturnType<typeof reEncodeToMp4>>];
    'open-external': [[url: string], boolean];
    'list-subtitles': [[url: string, browser: string, proxy: string], Awaited<ReturnType<typeof listSubtitles>>];
    'download-with-hardsub': [[options: Parameters<typeof downloadWithHardsub>[0]], Awaited<ReturnType<typeof downloadWithHardsub>>];
    'cancel-command': [[], boolean];
    'delete-temporary-files': [[paths: string[]], void];
    'get-format-info': [Parameters<typeof getFormatInfo>, Awaited<ReturnType<typeof getFormatInfo>>];
    'get-settings': [[], UserSettings];
    'set-settings': [[updates: UserSettings], UserSettings];
    'ai-get-settings': [[], AiSettingsResponse];
    'ai-set-settings': [[update: AiSettingsUpdate], AiSettingsResponse];
    'ai-set-api-key': [[type: string, apiKey: string], AiKeyResponse];
    'ai-remove-api-key': [[type: string], AiSettingsResponse];
    'ai-test-connection': [[overrides?: AiTestConnectionOptions], { ok: boolean; message: string }];
    'ai-send': [[message: string, context: AiContext], AiSendResult];
    'ai-cancel': [[], boolean];
    'ai-reset': [[], boolean];
    'ai-confirm-response': [[requestId: string, approved: boolean], boolean];
}

export interface IpcEvents {
    'download-progress': string;
    'download-folder-updated': string;
    'app-update-available': InvokeResult<'check-app-update'>;
    'app-update-progress': {
        percent: number;
        bytesPerSecond: number;
        transferred: number;
        total: number;
    };
    'ai-event': AiEvent;
}

export type InvokeChannel = keyof Invocations;
export type InvokeArgs<C extends InvokeChannel> = Invocations[C][0];
export type InvokeResult<C extends InvokeChannel> = Invocations[C][1];
export type InvokeMethod<C extends InvokeChannel> = (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>;
export type EventMethod<C extends keyof IpcEvents> = (callback: (payload: IpcEvents[C]) => void) => () => void;
export type Invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>) => Promise<InvokeResult<C>>;
export type Subscribe = <C extends keyof IpcEvents>(channel: C, callback: (payload: IpcEvents[C]) => void) => () => void;

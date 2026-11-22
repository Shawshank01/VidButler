// Helpers shared by the tool definitions.
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { runYtDlp, listSubtitles } from '../../core/tools.ts';
import { ValidationError } from '../validate.ts';
import { requireFolder } from '../context.js';
import { getScratchDirectory } from '../../core/local-data.js';

import uiCatalog from '../../i18n/catalog.cjs';
import type { UiTranslator } from '../../types/ui-language.d.ts';
import type { ConversionResult, MediaOperationResult, SubtitleTrack } from '../../core/tools.ts';
import type { ToolDeclaration } from '../types.js';
import type { TranscriptPart } from '../transcript-summary.ts';
import type { ToolName } from './names.ts';

const noop = () => { };

export type ToolArguments = Record<string, unknown>;
export type ToolRisk = 'low' | 'high';
export type ToolFailure = { ok: false; error: string; cancelled?: boolean } & Record<string, unknown>;
export type ToolResult = ({ ok: true; cancelled?: false } & Record<string, unknown>) | ToolFailure;

export type TranscriptPage = TranscriptPart['section'];
export type TranscriptContent = { transcript: string } | { summary_notes: string };
export interface TranscriptCache {
    url: string;
    lang?: string;
    track: SubtitleTrack;
    pages: TranscriptPage[];
    summary?: { page: number; content: TranscriptContent };
}

/** Per-run context supplied by the app. */
export interface ToolContext {
    downloadFolder: string;
    browser?: string;
    proxy?: string;
    onProgress?: (text: string) => void;
    signal?: AbortSignal;
    transcript?: TranscriptCache;
    transcriptInputChars?: number;
    transcriptPagesRead?: number;
    summarizeTranscriptPart?: (part: TranscriptPart) => Promise<string>;
}

interface ToolSpec {
    name: ToolName;
    description: string;
    risk?: ToolRisk | ((args: ToolArguments) => ToolRisk);
    properties?: Record<string, unknown>;
    required?: string[];
    describe(args: ToolArguments, t: UiTranslator): string;
    run(args: ToolArguments, ctx: ToolContext): Promise<ToolResult>;
}

export interface Tool extends Omit<ToolSpec, 'properties' | 'required' | 'risk' | 'describe'> {
    describe(args: ToolArguments, t?: UiTranslator): string;
    risk: NonNullable<ToolSpec['risk']>;
    parameters: ToolDeclaration['parameters'] & { properties: Record<string, unknown> };
}

const english: UiTranslator = (key, values) => uiCatalog.translate('en', key, values);

/** Declare a validated media tool with its model-facing JSON schema. */
export function defineTool({ name, description, risk = 'low', properties = {}, required = [], describe, run }: ToolSpec): Tool {
    return {
        name,
        description,
        risk,
        parameters: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
        describe: (args, t = english) => describe(args, t),
        run
    };
}

export const urlProperty = {
    type: 'string',
    description: 'The http(s) URL of the video or page, exactly as given by the user.'
};

export const playlistProperty = {
    type: 'boolean',
    description: 'Set true ONLY if the user explicitly asked to download a whole playlist.'
};

export const AUDIO_FORMATS = ['best', 'm4a', 'mp3', 'opus', 'flac', 'wav'] as const;

/** Whole-playlist operations are high risk; everything else is low. */
export const playlistRisk = (args: ToolArguments): ToolRisk => (args.playlist === true ? 'high' : 'low');

/** Proxy, cookie, and remote components arguments, in the same form the classic UI uses. */
export function commonArgs(ctx: ToolContext) {
    const args = ['--remote-components', 'ejs:github'];
    if (ctx.proxy) args.push('--proxy', ctx.proxy);
    if (ctx.browser) args.push('--cookies-from-browser', ctx.browser);
    return args;
}

export function lastLines(text: string | undefined, count = 30) {
    return String(text || '').split('\n').slice(-count).join('\n').trim();
}

/** Run yt-dlp, reporting progress to the user. */
export function runYtDlpIn(ctx: ToolContext, args: string[]) {
    return runYtDlp(args, ctx.onProgress || noop);
}

/** Progress callback of a context (a no-op if there is none). */
export function progressOf(ctx: ToolContext) {
    return ctx.onProgress || noop;
}

/** Translate a media operation result into the agent's result format. */
export function outcome<Extra extends Record<string, unknown>>(res: MediaOperationResult, extra: Extra): ToolResult & Extra {
    return res.success
        ? { ok: true, cancelled: false, ...extra }
        : { ok: false, cancelled: res.cancelled, error: res.error, ...extra };
}

/** Run a yt-dlp download and capture the final file paths via a temporary manifest file. */
export async function runDownload(specificArgs: string[], url: string, ctx: ToolContext, { playlist = false, sidecarOnly = false } = {}) {
    const folder = requireFolder(ctx);
    const manifestFile = join(
        getScratchDirectory(),
        `ytdl-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`
    );

    const res = await runYtDlpIn(ctx, [
        ...commonArgs(ctx),
        ...(playlist ? [] : ['--no-playlist']),
        ...specificArgs,
        '--print-to-file',
        // With --skip-download, yt-dlp moves the sidecars without running the after_move stage.
        sidecarOnly ? 'after_video:%(requested_downloads.:.__files_to_move)j' : 'after_move:filepath',
        manifestFile,
        '-P', folder,
        url
    ]);

    let files: string[] = [];
    try {
        const content = await fs.readFile(manifestFile, 'utf8');
        const lines = content.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
        if (sidecarOnly) {
            const paths: Record<string, string>[] = lines.filter((line) => line !== 'NA').flatMap((line) => JSON.parse(line));
            files = [...new Set(paths.flatMap((moves) => Object.values(moves)))];
        } else {
            files = lines;
        }
    } catch { /* yt-dlp may exit without writing a report */ }
    try { await fs.unlink(manifestFile); } catch { /* ignore */ }

    if (!sidecarOnly && files.length === 0 && res.output) {
        const alreadyMatch = res.output.match(/\[download\]\s+["']?(.+?)["']?\s+has already been downloaded/i);
        if (alreadyMatch) {
            files = [alreadyMatch[1].trim()];
        }
    }

    return outcome(res, {
        saved_to_folder: folder,
        files: files.map((p) => basename(p)),
        output: lastLines(res.output)
    });
}

/** Result of an ffmpeg-based operation (hardsub, re-encode). */
export function mediaOutcome(res: ConversionResult) {
    return outcome(res, {
        message: res.message,
        // The classic UI asks the user before deleting these; the agent must do the same
        // (via the confirmed delete_files tool) instead of deleting automatically.
        temporary_files: (res.tmpFiles || []).map((p) => basename(p))
    });
}

/** Resolve the subtitle track type for `lang`, since the model should not have to guess it. */
export async function resolveSubtitle(url: string, lang: string, ctx: ToolContext) {
    const listing = await listSubtitles(url, ctx.browser, ctx.proxy);
    if (listing.error) {
        throw new ValidationError(`Could not list subtitles: ${listing.message}`);
    }
    const match = findSubtitleTrack(listing.subtitles, lang);
    if (!match) {
        const available = listing.subtitles.map((s) => `${s.code} (${s.type})`).join(', ') || 'none';
        throw new ValidationError(
            `Subtitle language "${lang}" is not available for this video. Available: ${available}.`
        );
    }
    return match;
}

export function findSubtitleTrack(subtitles: SubtitleTrack[], lang: string) {
    let match = subtitles.find((s) => s.code === lang);
    if (!match) {
        match = subtitles.find((s) => s.code.toLowerCase() === lang.toLowerCase());
    }
    if (!match) {
        match = subtitles.find((s) => s.name && s.name.toLowerCase() === lang.toLowerCase());
    }
    if (!match) {
        const prefixMatches = subtitles.filter((s) => s.code.toLowerCase().startsWith(`${lang.toLowerCase()}-`));
        if (prefixMatches.length === 1) {
            match = prefixMatches[0];
        }
    }
    return match;
}

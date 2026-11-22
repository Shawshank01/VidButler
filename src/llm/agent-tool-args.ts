import { promises as fs } from 'fs';
import { MAX_DELETE_FILES } from './limits.js';
import { isForeignUrl, extractUrls } from './provenance.js';
import { TOOL_NAMES } from './tools/names.ts';
import type { SubtitleTrack } from '../core/tools.ts';
import type { ChatMessage, ToolCall } from './types.js';
import type { Tool, ToolArguments, ToolContext } from './tools/common.ts';

function asArguments(value: unknown): ToolArguments | undefined {
    return value && typeof value === 'object' ? value as ToolArguments : undefined;
}

function lastToolArgument(message: Extract<ChatMessage, { role: 'assistant' }>, name: string) {
    if (!Array.isArray(message.toolCalls)) return undefined;
    for (const call of message.toolCalls) {
        const value = asArguments(call.args)?.[name];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
}

function subtitlesFromResult(message: ChatMessage): SubtitleTrack[] | undefined {
    if (message.role !== 'tool' || message.name !== TOOL_NAMES.listSubtitles || typeof message.result === 'string') return undefined;
    const { ok, subtitles } = message.result;
    return ok && Array.isArray(subtitles) ? subtitles : undefined;
}

/**
 * Recover a local file name from recent conversation turns (e.g. list_downloads,
 * download results, previous tool calls, or user mentions) when the model omitted it.
 */
function recoverFileFromHistory(history: ChatMessage[]): string | undefined {
    if (!Array.isArray(history) || history.length === 0) return undefined;

    const lastUser = history.findLast((m) => m.role === 'user');
    const userText = lastUser?.text || '';

    // 1. Look backwards for recent tool results or tool calls
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role === 'tool' && msg.result && typeof msg.result !== 'string') {
            // list_downloads tool returns { ok: true, files: [{ name, is_video, ... }] }
            if (Array.isArray(msg.result.files) && msg.result.files.length > 0) {
                const files: unknown[] = msg.result.files;
                const first = files[0];
                const firstName = asArguments(first)?.name;
                if (typeof firstName === 'string' && firstName) {
                    // Prefer a file name the user mentioned, then the first video file.
                    const details = files.map(asArguments);
                    const matched = details.find(
                        (file) => typeof file?.name === 'string' && userText.toLowerCase().includes(file.name.toLowerCase())
                    );
                    if (typeof matched?.name === 'string') return matched.name;
                    const videoName = details.find((file) => file?.is_video)?.name;
                    return typeof videoName === 'string' ? videoName : firstName;
                }
                // download_video, download_audio, etc. return { ok: true, files: ['name.mp4'] }
                if (typeof first === 'string' && first.trim()) {
                    return first.trim();
                }
            }
            if (typeof msg.result.file === 'string' && msg.result.file.trim()) {
                return msg.result.file.trim();
            }
        } else if (msg.role === 'assistant') {
            const file = lastToolArgument(msg, 'file');
            if (file) return file.trim();
        }
    }

    // 2. Check user messages for an explicit media file name (e.g. "my_video.mp4")
    if (userText) {
        const fileMatch = userText.match(
            /\b([^\s"'<>]+\.(?:mp4|mkv|webm|m4a|mp3|opus|flac|wav|mov|avi))\b/i
        );
        if (fileMatch) {
            return fileMatch[1];
        }
    }

    return undefined;
}

/**
 * Extract a candidate language string from possible model aliases.
 */
function extractRawLang(args: ToolArguments) {
    const raw =
        args.lang ??
        args.language ??
        args.subtitle ??
        args.subtitles ??
        args.subtitle_lang ??
        args.sub_lang ??
        args.subtitleLang ??
        args.subLanguage ??
        args.lang_code ??
        args.language_code ??
        args.code;

    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        return trimmed || undefined;
    }
    const value = Array.isArray(raw) && raw.length > 0 ? raw[0] : raw;
    if (typeof value === 'string') return value.trim() || undefined;
    const fields = asArguments(value);
    const name = fields?.code || fields?.lang || fields?.name;
    return typeof name === 'string' ? name.trim() || undefined : undefined;
}

/**
 * Recover a subtitle language code from recent conversation turns (e.g. list_subtitles result,
 * previous tool calls, or user mentions) when the model omitted it.
 */
function recoverLangFromHistory(history: ChatMessage[]): string | undefined {
    if (!Array.isArray(history) || history.length === 0) return undefined;

    const lastUser = history.findLast((m) => m.role === 'user');
    const userText = lastUser?.text || '';

    // 1. Look backwards for recent list_subtitles tool result or earlier tool calls with lang
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const subs = subtitlesFromResult(msg);
        if (subs) {
            if (subs.length > 0) {
                // If user explicitly mentioned a subtitle code (e.g. "en", "ja", "de-DE", "es-419")
                if (userText) {
                    for (const s of subs) {
                        if (s.code && new RegExp(`\\b${s.code.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(userText)) {
                            return s.code;
                        }
                    }
                    // Match language name (e.g. "English", "Japanese", "German")
                    for (const s of subs) {
                        if (s.name) {
                            const baseName = s.name.split('(')[0].trim();
                            if (baseName && new RegExp(`\\b${baseName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(userText)) {
                                return s.code;
                            }
                        }
                    }
                }
                // If there is only one available subtitle track, select it
                if (subs.length === 1 && subs[0].code) {
                    return subs[0].code;
                }
            }
            break;
        }
        if (msg.role === 'assistant') {
            const lang = lastToolArgument(msg, 'lang');
            if (lang) return lang.trim();
        }
    }

    // 2. Fall back to user text pattern (e.g. "add en hardsub", "burn ja subtitles", "with de-DE subs")
    if (userText) {
        const subMatch =
            userText.match(/\b(?:add|burn|hardsub|with|in|download)\s+([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)?)(?:\s+(?:hardsub|subtitles?|subs?|captions?))?\b/i) ||
            userText.match(/\b([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)?)\s+(?:hardsub|subtitles?|subs?|captions?)\b/i);
        if (subMatch) {
            return subMatch[1];
        }
    }

    return undefined;
}

/**
 * Resolve aliases and fill omitted arguments from the conversation and tool context.
 * Every tool still validates the resulting arguments before building a media command.
 */
export async function normalizeToolArgs(call: ToolCall, tool: Tool, history: ChatMessage[], ctx: ToolContext): Promise<ToolArguments> {
    const supplied = asArguments(call.args);
    const args: ToolArguments = { ...supplied };

    // Normalize common model parameter hallucinations if the tool expects a 'url'
    if (tool.parameters?.properties?.url) {
        if (!args.url || typeof args.url !== 'string' || !args.url.trim()) {
            const alias = args.link || args.video_url || args.video || args.uri || args.target_url || args.webpage_url;
            if (typeof alias === 'string' && alias.trim()) {
                args.url = alias.trim();
            } else {
                // Find the most recently referenced user-typed URL in history (across turns or earlier tool calls)
                for (let i = history.length - 1; i >= 0; i--) {
                    const msg = history[i];
                    if (msg.role === 'user') {
                        const urls = [...extractUrls(msg.text)];
                        if (urls.length === 1) {
                            args.url = urls[0];
                            break;
                        }
                    } else if (msg.role === 'assistant') {
                        const previousUrl = lastToolArgument(msg, 'url');
                        if (previousUrl && !isForeignUrl(history, previousUrl)) {
                            args.url = previousUrl.trim();
                            break;
                        }
                    }
                }
            }
            if (supplied && args.url) {
                supplied.url = args.url;
            }
        }
    }

    // Normalise common model parameter hallucinations if the tool expects a 'file'
    if (tool.parameters?.properties?.file) {
        if (!args.file || typeof args.file !== 'string' || !args.file.trim()) {
            const alias =
                args.filename ||
                args.file_name ||
                args.filePath ||
                args.filepath ||
                args.file_path ||
                args.name ||
                args.video ||
                args.video_file ||
                args.media ||
                args.path ||
                args.target;
            if (typeof alias === 'string' && alias.trim()) {
                args.file = alias.trim();
            } else {
                args.file = recoverFileFromHistory(history);
            }
            if (supplied && args.file) {
                supplied.file = args.file;
            }
        }
    }

    // Normalise common model parameter hallucinations if the tool expects 'files' (e.g. delete_files)
    if (tool.parameters?.properties?.files) {
        if (!Array.isArray(args.files)) {
            const single =
                (typeof args.files === 'string' && args.files.trim()) ||
                (typeof args.file === 'string' && args.file.trim()) ||
                (typeof args.filename === 'string' && args.filename.trim()) ||
                (typeof args.name === 'string' && args.name.trim());
            if (single && single.toLowerCase() !== 'all' && single !== '*') {
                args.files = [single];
            }
        } else if (
            args.files.length === 1 &&
            typeof args.files[0] === 'string' &&
            (args.files[0].toLowerCase() === 'all' || args.files[0] === '*')
        ) {
            delete args.files;
        }

        // If files are missing, empty, or requested "all", attempt to recover the files to delete
        if (!Array.isArray(args.files) || args.files.length === 0) {
            const lastUser = history.findLast((m) => m.role === 'user');
            const userText = lastUser?.text || '';
            const isAll = /\b(all|everything|all files|clean up)\b/i.test(userText) || args.all === true;

            // 1. Check recent list_downloads result in history
            let filesFromHistory: string[] = [];
            for (let i = history.length - 1; i >= 0; i--) {
                const msg = history[i];
                if (msg.role === 'tool' && msg.name === TOOL_NAMES.listDownloads && typeof msg.result !== 'string' && msg.result?.ok && Array.isArray(msg.result.files)) {
                    const files: unknown[] = msg.result.files;
                    filesFromHistory = files.map((file) => typeof file === 'string' ? file : asArguments(file)?.name)
                        .filter((name): name is string => typeof name === 'string' && Boolean(name));
                    break;
                }
            }

            // Check if there are temporary files reported by a recent hardsub / re-encode in history
            let tempFilesFromHistory: unknown[] = [];
            for (let i = history.length - 1; i >= 0; i--) {
                const msg = history[i];
                if (msg.role === 'tool' && typeof msg.result !== 'string' && Array.isArray(msg.result?.temporary_files) && msg.result.temporary_files.length > 0) {
                    tempFilesFromHistory = msg.result.temporary_files;
                    break;
                }
            }
            const isTemp =
                /\b(?:temp|temporary|intermediate)\b/i.test(userText) ||
                (/^(?:yes|yep|sure|ok|proceed|go ahead|please|delete them)\b/i.test(userText) && tempFilesFromHistory.length > 0);

            if (isTemp && tempFilesFromHistory.length > 0) {
                args.files = tempFilesFromHistory;
            } else if (isAll) {
                if (filesFromHistory.length > 0) {
                    args.files = filesFromHistory.slice(0, MAX_DELETE_FILES);
                } else if (ctx?.downloadFolder) {
                    try {
                        const entries = await fs.readdir(ctx.downloadFolder, { withFileTypes: true });
                        const diskFiles = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
                        args.files = diskFiles.slice(0, MAX_DELETE_FILES);
                    } catch { /* ignore read error */ }
                }
            } else {
                // Not asking for all: see if user referred to a specific file or if history has a single file
                const recovered = recoverFileFromHistory(history);
                if (recovered) {
                    args.files = [recovered];
                } else if (filesFromHistory.length === 1) {
                    args.files = [filesFromHistory[0]];
                } else if (ctx?.downloadFolder) {
                    try {
                        const entries = await fs.readdir(ctx.downloadFolder, { withFileTypes: true });
                        const diskFiles = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
                        if (diskFiles.length === 1) {
                            args.files = [diskFiles[0]];
                        }
                    } catch { /* ignore read error */ }
                }
            }

            if (supplied && Array.isArray(args.files)) {
                supplied.files = args.files;
            }
        }
    }

    // Normalise common model parameter hallucinations if the tool expects a 'lang'
    if (tool.parameters?.properties?.lang) {
        let lang = extractRawLang(args);
        if (lang) {
            const wanted = lang.toLowerCase();
            // Check if lang is a language name (e.g. "English") matching any known subtitle track in history
            for (let i = history.length - 1; i >= 0; i--) {
                const msg = history[i];
                const subtitles = subtitlesFromResult(msg);
                if (subtitles) {
                    const matched = subtitles.find(
                        (s) =>
                            s.code?.toLowerCase() === wanted ||
                            s.name?.toLowerCase() === wanted ||
                            s.name?.split('(')[0].trim().toLowerCase() === wanted
                    );
                    if (matched) {
                        lang = matched.code;
                    }
                    break;
                }
            }
        } else {
            lang = recoverLangFromHistory(history);
        }
        if (lang) {
            args.lang = lang;
            if (supplied) {
                supplied.lang = lang;
            }
        }
    }

    // Reconcile container and format_code for download_video
    if (call.name === TOOL_NAMES.downloadVideo) {
        if (!args.container) {
            const lastUser = history.findLast((m) => m.role === 'user');
            const userText = lastUser?.text || '';
            if (/\bmkv\b/i.test(userText)) {
                args.container = 'mkv';
            } else if (/\bwebm\b/i.test(userText)) {
                args.container = 'webm';
            } else {
                args.container = 'mp4';
            }
            if (supplied && args.container) {
                supplied.container = args.container;
            }
        }

        if (!args.format_code) {
            const lastUser = history.findLast((m) => m.role === 'user');
            const userText = lastUser?.text || '';
            const userFormatMatch = userText.match(/\b(?:format\s+)?([0-9]{2,4}\+[0-9]{2,4})\b/i);
            if (userFormatMatch) {
                args.format_code = userFormatMatch[1];
            } else if (/^(?:yes|yep|sure|ok|proceed|go ahead|do it|please do|yeah)\b/i.test(userText)) {
                // Check if the previous assistant turn (before the user confirmation) suggested a specific format code
                let lastAssistantText = '';
                for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].role === 'user') {
                        for (let j = i - 1; j >= 0; j--) {
                            const previous = history[j];
                            if (previous.role === 'assistant' && previous.text) {
                                lastAssistantText = previous.text;
                                break;
                            }
                        }
                        break;
                    }
                }
                // A format ID always contains a digit; without that check "the format is ..." would yield "is".
                const assistFormatMatch = lastAssistantText.match(
                    /\bformats?\s+(?:codes?\s+)?((?=[0-9a-zA-Z_-]*\d)[0-9a-zA-Z_-]+(?:\+(?=[0-9a-zA-Z_-]*\d)[0-9a-zA-Z_-]+)?)/i
                );
                if (assistFormatMatch) {
                    args.format_code = assistFormatMatch[1];
                }
            }
            if (supplied && args.format_code) {
                supplied.format_code = args.format_code;
            }
        }

        if (!args.max_height) {
            const rawHeight = args.height ?? args.resolution ?? args.res ?? args.quality ?? args.maxHeight;
            if (rawHeight !== undefined && rawHeight !== null) {
                const parsed = parseInt(String(rawHeight).replace(/[^0-9]/g, ''), 10);
                if (Number.isInteger(parsed) && parsed >= 144 && parsed <= 4320) {
                    args.max_height = parsed;
                }
            }
        }

        if (!args.max_height) {
            const lastUser = history.findLast((m) => m.role === 'user');
            const userText = lastUser?.text || '';
            const heightMatch = userText.match(/\b(2160|1440|1080|720|480|360|240|144)p?\b/i);
            if (heightMatch) {
                args.max_height = parseInt(heightMatch[1], 10);
            } else if (/\b4k\b/i.test(userText)) {
                args.max_height = 2160;
            } else if (/\b2k\b/i.test(userText)) {
                args.max_height = 1440;
            }
        }
        if (supplied && args.max_height) {
            supplied.max_height = args.max_height;
        }
    }

    // Reconcile format for download_audio and extract_audio_from_file
    if (call.name === TOOL_NAMES.downloadAudio || call.name === TOOL_NAMES.extractAudioFromFile) {
        if (!args.format) {
            const lastUser = history.findLast((m) => m.role === 'user');
            const userText = lastUser?.text || '';
            if (
                /\bmp3\b/i.test(userText) ||
                /\b(compatib|can['’]?t play|won['’]?t play|doesn['’]?t play|not playing|device|car stereo|legacy|player)\b/i.test(userText)
            ) {
                args.format = 'mp3';
            } else if (/\bm4a\b/i.test(userText)) {
                args.format = 'm4a';
            } else if (/\bopus\b/i.test(userText)) {
                args.format = 'opus';
            } else if (/\bflac\b/i.test(userText)) {
                args.format = 'flac';
            } else if (/\bwav\b/i.test(userText)) {
                args.format = 'wav';
            } else {
                args.format = 'best';
            }
            if (supplied && args.format) {
                supplied.format = args.format;
            }
        }
    }

    // Reconcile position and codec for download_with_hardsub
    if (call.name === TOOL_NAMES.downloadWithHardsub) {
        if (!args.position) {
            const rawPos = args.subtitle_position || args.subtitlePosition || args.placement || args.align || args.alignment;
            if (typeof rawPos === 'string' && /^(?:bottom|top)$/i.test(rawPos.trim())) {
                args.position = rawPos.trim().toLowerCase();
            } else {
                const lastUser = history.findLast((m) => m.role === 'user');
                const userText = lastUser?.text || '';
                if (/\b(?:at the |on the )?top\b/i.test(userText)) {
                    args.position = 'top';
                } else {
                    args.position = 'bottom';
                }
            }
            if (supplied && args.position) {
                supplied.position = args.position;
            }
        }
        if (!args.codec) {
            const rawCodec = args.video_codec || args.videoCodec || args.vcodec;
            if (typeof rawCodec === 'string') {
                const trimmed = rawCodec.trim().toLowerCase();
                if (trimmed === 'hevc' || trimmed === 'h265' || trimmed === 'x265') {
                    args.codec = 'hevc';
                } else if (trimmed === 'h264' || trimmed === 'avc' || trimmed === 'x264') {
                    args.codec = 'h264';
                }
            } else {
                const lastUser = history.findLast((m) => m.role === 'user');
                const userText = lastUser?.text || '';
                if (/\b(?:hevc|h\.?265|x265)\b/i.test(userText)) {
                    args.codec = 'hevc';
                } else {
                    args.codec = 'h264';
                }
            }
            if (supplied && args.codec) {
                supplied.codec = args.codec;
            }
        }
    }

    return args;
}

// Tools that download media or sidecar files into the user's download folder.
import {
    validateUrl,
    validateLang,
    validateFormatCode,
    validateEnum,
    validateIntRange,
    validateBool,
    ValidationError
} from '../validate.ts';
import { TOOL_NAMES } from './names.ts';
import { MESSAGES } from '../messages.js';
import { AUDIO_FORMATS, defineTool, playlistProperty, playlistRisk, resolveSubtitle, runDownload, urlProperty } from './common.ts';

/**
 * If formatCode is a combination like "137+140", YouTube multi-language / DRC tracks often
 * have suffixed IDs like "140-0" or "140-2" instead of bare "140". Provide fallback selectors
 * using yt-dlp's "/" operator so yt-dlp doesn't fail with "Requested format is not available".
 */
export function resolveFormatCode(formatCode: string): string;
export function resolveFormatCode(formatCode?: string): string | undefined;
export function resolveFormatCode(formatCode?: string) {
    if (!formatCode || formatCode.includes('/')) return formatCode;
    const pairMatch = formatCode.match(/^([a-zA-Z0-9_.-]+)\+([a-zA-Z0-9_.-]+)$/);
    if (pairMatch) {
        const [, video, audio] = pairMatch;
        if (audio === '140') {
            return `${formatCode}/${video}+ba[acodec^=mp4a]/${video}+ba`;
        }
        if (audio === '251' || audio === '250' || audio === '249') {
            return `${formatCode}/${video}+ba[acodec^=opus]/${video}+ba`;
        }
        return `${formatCode}/${video}+ba`;
    }
    if (formatCode === '140') {
        return '140/ba[acodec^=mp4a]/ba';
    }
    if (formatCode === '251' || formatCode === '250' || formatCode === '249') {
        return `${formatCode}/ba[acodec^=opus]/ba`;
    }
    return formatCode;
}

export const MERGE_FORMATS = ['mp4', 'mkv', 'webm'] as const;

export function videoFormatArgs({ maxHeight, formatCode, container, compatible, recode = false }: {
    maxHeight?: number;
    formatCode?: string;
    container: typeof MERGE_FORMATS[number];
    compatible?: boolean;
    recode?: boolean;
}) {
    const specific = [];
    if (compatible) {
        const height = maxHeight ? `[height<=${maxHeight}]` : '';
        specific.push('-f', `bv*[vcodec^=avc]${height}+ba[acodec^=mp4a]/b[vcodec^=avc][acodec^=mp4a]${height}`);
    } else if (formatCode) {
        specific.push('-f', resolveFormatCode(formatCode));
    } else if (maxHeight) {
        specific.push('-f', `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]`);
    } else if (container === 'mp4') {
        specific.push('-f', 'bv*[vcodec^=avc]+ba[acodec^=mp4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b');
    }

    if (container === 'mp4' && maxHeight && !formatCode && !compatible) {
        // Pick the highest resolution first; prefer MP4-compatible codecs only as a tie-breaker.
        // Let yt-dlp use MKV when the chosen streams cannot be merged into MP4.
        specific.push('--merge-output-format', 'mp4/mkv', '--format-sort', 'res,vcodec:h264,ext:mp4:m4a');
    } else {
        specific.push('--merge-output-format', container, recode ? '--recode-video' : '--remux-video', container);
        if (container === 'mp4') specific.push('--format-sort', 'res,vcodec:h264,ext:mp4:m4a');
    }
    return specific;
}

const langProperty = { type: 'string', description: 'Subtitle language code from list_subtitles, e.g. "en".' };

export const downloadTools = [
    defineTool({
        name: TOOL_NAMES.downloadVideo,
        description:
            'Download a video to the user\'s download folder with thumbnail embedded. Supports a maximum resolution, exact format codes, or a compatible H.264/AAC download. Only downloads a single video unless playlist is true.',
        risk: playlistRisk,
        properties: {
            url: urlProperty,
            max_height: {
                type: 'integer',
                description: 'Optional maximum video height in pixels, e.g. 1080, 720 or 480. Omit for best quality.'
            },
            format_code: {
                type: 'string',
                description: 'Optional exact yt-dlp format code from list_formats (e.g. exact IDs like "137+140-0"). Prefer max_height instead of format_code for standard resolution requests (1080p, 720p, etc.).'
            },
            container: {
                type: 'string',
                enum: MERGE_FORMATS,
                description: 'Optional output container. Default: "mp4". With max_height, resolution takes priority over codecs and MP4 may fall back to MKV if needed.'
            },
            compatible: {
                type: 'boolean',
                description: 'Set true when the user chooses a broadly compatible H.264/AAC MP4 download, potentially at a lower resolution. Fails if compatible streams are unavailable; does not re-encode.'
            },
            playlist: playlistProperty
        },
        required: ['url'],
        describe: (a) =>
            `Download ${a.playlist ? 'playlist' : 'video'} ${a.url}` +
            (a.max_height ? ` (max ${a.max_height}p)` : '') +
            (a.format_code ? ` (format ${a.format_code})` : '') +
            (a.compatible ? ' (H.264/AAC compatible)' : '') +
            (a.container ? ` [${a.container}]` : ''),
        async run(args, ctx) {
            const url = validateUrl(args.url);
            const maxHeight = validateIntRange(args.max_height, 144, 4320, 'max_height');
            const formatCode = args.format_code ? validateFormatCode(args.format_code) : undefined;
            const container = args.container
                ? validateEnum(args.container, MERGE_FORMATS, 'container')
                : 'mp4';
            const playlist = validateBool(args.playlist, 'playlist');
            const compatible = validateBool(args.compatible, 'compatible');
            if (compatible && (container !== 'mp4' || formatCode)) {
                throw new ValidationError('compatible requires MP4 and cannot be combined with format_code');
            }

            const specific = videoFormatArgs({ maxHeight, formatCode, container, compatible });

            if (container !== 'webm') {
                specific.push('--convert-thumbnails', 'jpg', '--embed-thumbnail');
            }

            return runDownload(specific, url, ctx, { playlist });
        }
    }),
    defineTool({
        name: TOOL_NAMES.downloadAudio,
        description:
            'Download only the audio of a video (default "best" keeps the original audio codec without re-encoding). Use "mp3" when compatibility with legacy devices or players is requested.',
        risk: playlistRisk,
        properties: {
            url: urlProperty,
            format: {
                type: 'string',
                enum: AUDIO_FORMATS,
                description: 'Audio format. "best" preserves original audio quality without re-encoding. Default: best. Use "mp3" for legacy device compatibility.'
            },
            playlist: playlistProperty
        },
        required: ['url'],
        describe: (a) => `Download audio (${a.format || 'best'}) from ${a.url || 'video'}`,
        async run(args, ctx) {
            const url = validateUrl(args.url);
            const format = validateEnum(args.format, AUDIO_FORMATS, 'format', 'best');
            const playlist = validateBool(args.playlist, 'playlist');

            const specific = ['-f', 'bestaudio/best', '-x', '--audio-format', format];
            if (format === 'mp3' || format === 'm4a') {
                specific.push('--convert-thumbnails', 'jpg', '--embed-thumbnail');
            }

            return runDownload(specific, url, ctx, { playlist });
        }
    }),
    defineTool({
        name: TOOL_NAMES.downloadThumbnail,
        description: 'Download only the thumbnail image of a video.',
        properties: { url: urlProperty },
        required: ['url'],
        describe: (a) => `Download thumbnail of ${a.url || 'video'}`,
        async run(args, ctx) {
            const url = validateUrl(args.url);
            const result = await runDownload(['--write-thumbnail', '--skip-download'], url, ctx, { sidecarOnly: true });
            if (result.ok && result.files.length === 0) {
                return { ...result, ok: false, error: MESSAGES.noThumbnailSaved };
            }
            return result;
        }
    }),
    defineTool({
        name: TOOL_NAMES.downloadSubtitles,
        description:
            'Download a subtitle file (converted to .vtt) for a video without downloading the video. Call list_subtitles first to see which language codes exist.',
        properties: { url: urlProperty, lang: langProperty },
        required: ['url', 'lang'],
        describe: (a) => `Download "${a.lang || 'selected'}" subtitles for ${a.url || 'video'}`,
        async run(args, ctx) {
            const url = validateUrl(args.url);
            const lang = validateLang(args.lang);
            const sub = await resolveSubtitle(url, lang, ctx);
            const subsFlag = sub.type === 'manual' ? '--write-subs' : '--write-auto-subs';
            return runDownload(
                [subsFlag, '--sub-langs', sub.code, '--skip-download', '--convert-subs', 'vtt'],
                url,
                ctx
            );
        }
    })
];

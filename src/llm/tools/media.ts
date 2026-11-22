// Tools built on ffmpeg and ffprobe.
import { reEncodeToMp4, downloadWithHardsub, getLocalMediaInfo, extractAudioFromFile } from '../../core/tools.ts';
import { findMediaFile } from '../../core/media-files.ts';
import { requireFolder } from '../context.js';
import { MESSAGES } from '../messages.js';
import { validateUrl, validateLang, validateFileHint, validateEnum } from '../validate.ts';
import { TOOL_NAMES } from './names.ts';
import { AUDIO_FORMATS, defineTool, mediaOutcome, outcome, progressOf, resolveSubtitle, urlProperty } from './common.ts';

const CODECS = ['h264', 'hevc'];
const POSITIONS = ['bottom', 'top'];

export const mediaTools = [
    defineTool({
        name: TOOL_NAMES.getLocalMediaInfo,
        description:
            'Inspect the media metadata (duration, resolution, video/audio codecs, bitrates, audio tracks, and embedded subtitles) of an existing audio or video file in the download folder using ffprobe.',
        risk: 'low',
        properties: {
            file: {
                type: 'string',
                description: 'File name (or unique part of it) of an existing video or audio file in the download folder from list_downloads.'
            }
        },
        required: ['file'],
        describe: (a, t) => t('toolLocalInfo', { file: a.file || t('toolMediaLabel') }),
        async run(args, ctx) {
            const folder = requireFolder(ctx);
            let fileHint = typeof args.file === 'string' ? args.file.trim() : '';
            if (!fileHint) {
                // If file is omitted, fall back to the most recently modified media file in the download folder
                try {
                    const candidate = await findMediaFile(folder, '');
                    if (candidate) {
                        fileHint = candidate.file;
                    }
                } catch { /* ignore read errors */ }
            }
            if (!fileHint) {
                return {
                    ok: false,
                    error: 'Please specify which file in the download folder you want to inspect (e.g. from list_downloads).'
                };
            }
            const file = validateFileHint(fileHint);
            return getLocalMediaInfo(folder, file);
        }
    }),
    defineTool({
        name: TOOL_NAMES.downloadWithHardsub,
        description: MESSAGES.downloadWithHardsubDescription,
        risk: 'high',
        properties: {
            url: urlProperty,
            lang: { type: 'string', description: 'Subtitle language code from list_subtitles, e.g. "en".' },
            codec: { type: 'string', enum: CODECS, description: 'Output video codec. Default: h264.' },
            position: {
                type: 'string',
                enum: POSITIONS,
                description: 'Where to place the subtitles. Default: bottom.'
            }
        },
        required: ['url', 'lang'],
        describe: (a, t) =>
            t('toolHardsub', {
                url: a.url || t('toolVideoLabel'), lang: a.lang || t('toolSelected'), codec: a.codec || 'h264',
                position: a.position === 'top' ? t('toolPositionTop') : !a.position || a.position === 'bottom'
                    ? t('toolPositionBottom') : a.position
            }),
        async run(args, ctx) {
            const url = validateUrl(args.url);
            const lang = validateLang(args.lang);
            const codec = validateEnum(args.codec, CODECS, 'codec', 'h264');
            const position = validateEnum(args.position, POSITIONS, 'position', 'bottom');
            const folder = requireFolder(ctx);

            const sub = await resolveSubtitle(url, lang, ctx);
            const res = await downloadWithHardsub(
                {
                    url,
                    browser: ctx.browser,
                    proxy: ctx.proxy,
                    downloadFolder: folder,
                    subtitleLang: sub.code,
                    subtitleType: sub.type,
                    codec,
                    subtitlePosition: position
                },
                progressOf(ctx)
            );
            return mediaOutcome(res);
        }
    }),
    defineTool({
        name: TOOL_NAMES.reencodeMp4,
        description:
            'Re-encode an existing video file in the download folder to MP4 (H.264/AAC) with ffmpeg. Slow and CPU-intensive, and may reduce quality. Use when the user requests or agrees to conversion.',
        risk: 'high',
        properties: {
            file: {
                type: 'string',
                description: 'File name (or unique part of it, e.g. the video ID) of an existing video in the download folder from list_downloads.'
            }
        },
        required: ['file'],
        describe: (a, t) => t('toolReencode', { file: a.file || t('toolVideoLabel') }),
        async run(args, ctx) {
            const folder = requireFolder(ctx);
            const fileHint = typeof args.file === 'string' ? args.file.trim() : '';
            if (!fileHint) {
                return {
                    ok: false,
                    error: 'Please specify which video file in the download folder you want to re-encode (e.g. from list_downloads).'
                };
            }
            const file = validateFileHint(fileHint);
            return mediaOutcome(await reEncodeToMp4(folder, file, progressOf(ctx)));
        }
    }),
    defineTool({
        name: TOOL_NAMES.extractAudioFromFile,
        description:
            'Extract the audio track from an existing video file in the download folder using ffmpeg. Fast, local, and works offline without downloading. Default format: "best" (preserves original audio codec without re-encoding). Use "mp3" for legacy player compatibility.',
        risk: 'low',
        properties: {
            file: {
                type: 'string',
                description: 'File name (or unique part of it) of an existing video in the download folder from list_downloads.'
            },
            format: {
                type: 'string',
                enum: AUDIO_FORMATS,
                description:
                    'Output audio format. "best" preserves original audio quality without re-encoding. Default: best. Use "mp3" for legacy device compatibility.'
            }
        },
        required: ['file'],
        describe: (a, t) => t('toolExtractAudio', {
                format: !a.format || a.format === 'best' ? t('toolBest') : a.format, file: a.file || t('toolVideoLabel')
            }),
        async run(args, ctx) {
            const folder = requireFolder(ctx);
            let fileHint = typeof args.file === 'string' ? args.file.trim() : '';
            if (!fileHint) {
                try {
                    const candidate = await findMediaFile(folder, '');
                    if (candidate) {
                        fileHint = candidate.file;
                    }
                } catch { /* ignore read errors */ }
            }
            if (!fileHint) {
                return {
                    ok: false,
                    error: 'Please specify which video file in the download folder you want to extract audio from (e.g. from list_downloads).'
                };
            }
            const file = validateFileHint(fileHint);
            const format = validateEnum(args.format, AUDIO_FORMATS, 'format', 'best');
            const res = await extractAudioFromFile(folder, file, { format }, progressOf(ctx));
            const extractedFile = res.success ? res.file : undefined;
            return outcome(res, {
                file: extractedFile,
                files: extractedFile ? [extractedFile] : [],
                message: res.message
            });
        }
    })
];

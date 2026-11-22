import { MESSAGES } from '../messages.js';
import { aacEncoderArgs, videoBitrate } from '../../core/encoding.ts';
import { validateEnum, validateIntRange, validateTimestamp, validateUrl, ValidationError } from '../validate.ts';
import { AUDIO_FORMATS, defineTool, runDownload, urlProperty } from './common.ts';
import type { ToolContext } from './common.ts';
import { explainResolutionFailure, MERGE_FORMATS, videoFormatArgs } from './download.ts';
import { TOOL_NAMES } from './names.ts';

const CLIP_OUTPUT_ARGS = ['-abort_on', 'empty_output'];
const VIDEO_TOOLBOX_ERRORS = [
    /\bUnknown encoder ['"]?h264_videotoolbox\b/i,
    /\[h264_videotoolbox @ [^\]\n]+\] (?:Cannot|Could not|Error|Failed)\b/i,
    /\[vost#[^\]\n]+\/h264_videotoolbox @ [^\]\n]+\] (?:Error while opening|Could not open) encoder/i
];
const AUDIO_TOOLBOX_ERRORS = [
    /\bUnknown encoder ['"]?aac_at\b|\bUnrecognized option ['"]?aac_at_mode\b/i,
    /\[aac_at @ [^\]\n]+\] .*\berror\b/i,
    /\[aost#[^\]\n]+\/aac_at @ [^\]\n]+\].*(?:Error while opening|Could not open) encoder/i
];

function downloadWithOutputArgs(specific: string[], url: string, ctx: ToolContext, outputArgs: string[]) {
    return runDownload([...specific, '--downloader-args', `ffmpeg_o:${outputArgs.join(' ')}`], url, ctx);
}

async function downloadMacAacClip(specific: string[], url: string, ctx: ToolContext, { mediaType, maxHeight }: {
    mediaType: 'video' | 'audio';
    maxHeight?: number;
}): ReturnType<typeof runDownload> {
    const video = mediaType === 'video';
    const videoArgs = video ? ['-b:v', videoBitrate('h264', maxHeight)] : ['-vn'];
    // AAC uses an MP4 intermediate even for sources such as WebM. yt-dlp remuxes
    // it to the requested extension when the source-based extension differs.
    const remux = video && !specific.includes('--remux-video') ? ['--remux-video', 'mp4'] : [];
    let videoToolbox = video;
    let audioEncoder = 'aac_at';

    while (true) {
        const hardwareArgs = videoToolbox ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '1'] : [];
        const result = await downloadWithOutputArgs([...specific, ...remux], url, ctx, [
            ...CLIP_OUTPUT_ARGS, ...hardwareArgs, ...videoArgs, ...aacEncoderArgs(audioEncoder), '-f', 'mp4'
        ]);
        if (result.ok || result.cancelled) return result;

        let retryMessage;
        if (videoToolbox && VIDEO_TOOLBOX_ERRORS.some((error) => error.test(result.output))) {
            videoToolbox = false;
            retryMessage = MESSAGES.clipVideoToolboxFallback;
        } else if (audioEncoder === 'aac_at' && AUDIO_TOOLBOX_ERRORS.some((error) => error.test(result.output))) {
            audioEncoder = 'aac';
            retryMessage = MESSAGES.clipAudioToolboxFallback;
        } else {
            return result;
        }
        if (!ctx.signal?.aborted) ctx.onProgress?.(retryMessage);
        if (ctx.signal?.aborted) return { ...result, cancelled: true, error: MESSAGES.cancelledByUser };
    }
}

export const downloadSectionTool = defineTool({
    name: TOOL_NAMES.downloadSection,
    description: MESSAGES.downloadSectionDescription,
    properties: {
        url: urlProperty,
        media_type: { type: 'string', enum: ['video', 'audio'], description: MESSAGES.clipMediaTypeDescription },
        start_time: { type: 'string', description: MESSAGES.clipTimeDescription('Start', '0:45') },
        end_time: { type: 'string', description: MESSAGES.clipTimeDescription('End', '2:10.500') },
        height: { type: 'integer', description: MESSAGES.exactVideoHeightDescription },
        max_height: { type: 'integer', description: MESSAGES.maxVideoHeightDescription },
        container: { type: 'string', enum: MERGE_FORMATS, description: MESSAGES.clipVideoContainerDescription },
        format: { type: 'string', enum: AUDIO_FORMATS, description: MESSAGES.clipAudioFormatDescription }
    },
    required: ['url', 'media_type', 'start_time', 'end_time'],
    describe: (a, t) => t('toolClip', {
        media: a.media_type === 'audio' ? t('toolAudioLabel') : a.media_type === 'video' ? t('toolVideoLabel') : a.media_type,
        start: a.start_time, end: a.end_time, url: a.url
    }),
    async run(args, ctx) {
        const url = validateUrl(args.url);
        const mediaType = validateEnum(args.media_type, ['video', 'audio'], 'media_type');
        const start = validateTimestamp(args.start_time, 'start_time');
        const end = validateTimestamp(args.end_time, 'end_time');
        if (end <= start) throw new ValidationError(MESSAGES.invalidClipOrder);
        if (ctx.proxy?.startsWith('socks')) throw new ValidationError(MESSAGES.clipWithSocksProxy);

        const specific = [
            '--ignore-config', '--no-overwrites', '--playlist-items', '1',
            // The seconds suffix makes yt-dlp parse fractional thresholds as durations.
            '--match-filters', `duration>=?${end}s`,
            '--download-sections', `*${start}-${end}`, '--force-keyframes-at-cuts'
        ];
        let variant;
        let container: typeof MERGE_FORMATS[number] | undefined;
        let height;
        let maxHeight;
        let format;
        if (mediaType === 'audio') {
            format = validateEnum(args.format, AUDIO_FORMATS, 'format', 'best');
            variant = `audio ${format}`;
            specific.push('-f', 'bestaudio/best', '-x', '--audio-format', format);
        } else {
            container = validateEnum(args.container, MERGE_FORMATS, 'container', 'mp4');
            height = validateIntRange(args.height, 144, 4320, 'height');
            maxHeight = validateIntRange(args.max_height, 144, 4320, 'max_height');
            variant = `video ${container}${height ? ` ${height}p` : maxHeight ? ` ${maxHeight}p-max` : ''}`;
            specific.push(...videoFormatArgs({ container, height, maxHeight, recode: container === 'webm' }));
        }
        specific.push('-o', `%(title).140B [%(id).40B] [clip ${start}-${end} ${variant}].%(ext)s`);

        const outputArgs = [...CLIP_OUTPUT_ARGS];
        if (mediaType === 'audio') outputArgs.push('-vn');
        if (container === 'mp4') outputArgs.push('-b:v', videoBitrate('h264', height ?? maxHeight));
        const result = process.platform === 'darwin' && (container === 'mp4' || format === 'm4a')
            ? await downloadMacAacClip(specific, url, ctx, { mediaType, maxHeight: height ?? maxHeight })
            : await downloadWithOutputArgs(specific, url, ctx, outputArgs);
        if (result.ok && result.files.length === 0) {
            return { ...result, ok: false, error: MESSAGES.noClipSaved };
        }
        return explainResolutionFailure(result, height);
    }
});

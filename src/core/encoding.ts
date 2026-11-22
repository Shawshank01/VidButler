const H264_BITRATE_BY_HEIGHT = [
    [480, 2500], [720, 5000], [1080, 8000], [1440, 16000], [2160, 24000], [4320, 40000]
];
const UNCAPPED_H264_BITRATE = 12000;

export function videoBitrate(codec: string, height?: number) {
    const tier = height !== undefined && Number.isFinite(height) && height > 0
        ? Math.min(height, H264_BITRATE_BY_HEIGHT.at(-1)![0])
        : undefined;
    const h264Kbps = H264_BITRATE_BY_HEIGHT.find(([ceiling]) => tier !== undefined && tier <= ceiling)?.[1] ?? UNCAPPED_H264_BITRATE;
    // Use the same 5:3 ratio as the original hardsub targets.
    return `${codec === 'hevc' ? h264Kbps * 3 / 5 : h264Kbps}k`;
}

export function aacEncoderArgs(encoder: string, stream = '') {
    const args = [`-c:a${stream}`, encoder];
    if (encoder === 'aac_at') args.push('-aac_at_mode', 'cvbr');
    args.push(`-b:a${stream}`, '128k');
    return args;
}

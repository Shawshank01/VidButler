// Shared by Node and the classic renderer scripts.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LogClassification = factory();
})(globalThis, function () {
    // Rule list for log noise reduction
    const CLASSIC_NOISE_PATTERNS = [
        /^\s*Duration:\s*[\d:.]+/i,
        /^Extract(?:ing|ed)\s+(?:\d+\s+)?cookies from/i,
        /\[jsc:[^\]]+\]\s+Solving JS challenges/i,
        /^\[SubtitlesConvertor\]/i
    ];
    const LOG_NOISE_PATTERNS = [
        ...CLASSIC_NOISE_PATTERNS,
        /Opening 'https?:\/\//i,                                // HLS segment download spam
        /Changing ID3 metadata in HLS audio/i,                  // Twitter/X non-fatal metadata warning
        /mime type is not rfc8216 compliant/i,                  // HLS header compliance warning
        /^\s*(Input|Output) #\d+/i,                             // FFmpeg stream probe input/output header
        /^\s*Program \d+/i,                                     // FFmpeg program header
        /^\s*Stream mapping:/i,                                 // FFmpeg stream mapping header
        /^\s*Stream #\d+:\d+/i,                                 // FFmpeg stream descriptor
        /^\s*(Metadata:|variant_bitrate|encoder\s*:)/i,         // FFmpeg metadata tags
        /^\s*(TIT3|id3v2_priv|JSONMetadata|Hydra)/i,            // Twitter HLS ID3 metadata dumps
        /Press \[[q?]\] to stop/i,                              // FFmpeg interactive prompt
        /muxing overhead: unknown/i,                            // FFmpeg muxing summary header
    ];

    function shouldSuppressLogLine(line) {
        return LOG_NOISE_PATTERNS.some((pattern) => pattern.test(line));
    }

    function isProgressLine(line) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[download]')) {
            if (trimmed.includes('%') || trimmed.includes('ETA')) {
                return true;
            }
            if (/\s+[\d.]+\s*[kKmMgGtT]?i?B\s+at\s+/i.test(trimmed) || /\bat\s+\S*B\/s/i.test(trimmed)) {
                return true;
            }
            return false;
        }
        if ((/^(?:frame|size)=\s*\S+/i.test(trimmed) && trimmed.includes('time=')) ||
            (/^time=\S+/i.test(trimmed) && trimmed.includes('bitrate='))) {
            return true;
        }
        return false;
    }

    function isExtractorOrNoiseLine(line) {
        const trimmed = line.trim();
        return CLASSIC_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
            /^\[[^\]]+\]\s+Extracting URL:/i.test(trimmed) ||
            /^\[(?!download\])[^\]]+\]\s+(?:.*:\s+)?Downloading\s+/i.test(trimmed);
    }

    return { isProgressLine, isExtractorOrNoiseLine, shouldSuppressLogLine };
});

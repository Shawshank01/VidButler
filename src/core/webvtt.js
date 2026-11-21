const TIMING = /^((?:\d{2,9}:)?[0-5]\d:[0-5]\d\.\d{3})[ \t]+-->[ \t]+((?:\d{2,9}:)?[0-5]\d:[0-5]\d\.\d{3})(?:[ \t]|$)/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '\u200e', rlm: '\u200f' };

function seconds(timestamp) {
    return timestamp.split(':').reduce((time, unit) => time * 60 + Number(unit), 0);
}

function cleanCaption(line) {
    return line.replace(/<[^<>\n]*>/g, '')
        .replace(/&(amp|lt|gt|quot|apos|nbsp|lrm|rlm);/g, (_entity, name) => ENTITIES[name])
        .replace(/\s+/gu, ' ').replace(/\p{Cc}/gu, '').trim();
}

/** Read timed text and skip WebVTT metadata blocks. Rolling captions often repeat the immediately previous line. */
export function* parseWebVtt(contents, { rolling = false } = {}) {
    const normalized = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!/^WEBVTT(?:[ \t]|\n|$)/.test(normalized)) return;
    const blocks = normalized.split(/\n[ \t]*\n(?:[ \t]*\n)*/);
    let previousLines = [];
    let previousEnd = -Infinity;
    for (const block of blocks.slice(1)) {
        if (/^(?:NOTE|STYLE|REGION)(?:[ \t]|\n|$)/.test(block)) continue;
        const lines = block.split('\n');
        const timingLine = lines[0].includes('-->') ? 0 : 1;
        const timing = TIMING.exec(lines[timingLine] || '');
        if (!timing) continue;
        const [, start, end] = timing;
        const startSeconds = seconds(start);
        const endSeconds = seconds(end);
        if (endSeconds <= startSeconds) continue;
        const caption = lines.slice(timingLine + 1).map(cleanCaption).filter(Boolean);
        if (!caption.length) continue;

        let text = caption.join(' ');
        if (rolling && startSeconds <= previousEnd + 1) {
            if (text === previousLines.join(' ')) text = '';
            else if (caption[0] === previousLines.at(-1)) text = caption.slice(1).join(' ');
        }
        previousLines = caption;
        previousEnd = endSeconds;
        if (text) yield { start, end, endSeconds, text };
    }
}

import { promises as fs } from 'fs';
import { join } from 'path';
import { listSubtitles } from '../../core/tools.js';
import { getScratchDirectory } from '../../core/local-data.js';
import { parseWebVtt } from '../../core/webvtt.js';
import { MAX_TRANSCRIPT_FILE_BYTES, MAX_TRANSCRIPT_PAGE_CHARS, MAX_TRANSCRIPT_PAGES_PER_SUMMARY } from '../limits.js';
import { MESSAGES } from '../messages.js';
import { validateIntRange, validateLang, validateUrl } from '../validate.js';
import { commonArgs, defineTool, findSubtitleTrack, lastLines, outcome, runYtDlpIn, urlProperty } from './common.js';
import { TOOL_NAMES } from './names.js';

function transcriptPages(cues) {
    const pages = [];
    let lines = [];
    let length = 0;
    let from;
    let through;
    let endSeconds;
    const flush = () => {
        pages.push({ from, through, transcript: lines.join('\n') });
        lines = [];
        length = 0;
    };
    for (const cue of cues) {
        const prefix = `[${cue.start}–${cue.end}] `;
        let offset = 0;
        while (offset < cue.text.length) {
            let end = Math.min(offset + MAX_TRANSCRIPT_PAGE_CHARS - prefix.length, cue.text.length);
            // Keep a Unicode surrogate pair together when a single cue spans two pages.
            if (/[\uDC00-\uDFFF]/u.test(cue.text.charAt(end))) end -= 1;
            const line = prefix + cue.text.slice(offset, end);
            if (lines.length && length + 1 + line.length > MAX_TRANSCRIPT_PAGE_CHARS) flush();
            if (!lines.length) {
                from = cue.start;
                endSeconds = -Infinity;
            }
            if (cue.endSeconds > endSeconds) {
                through = cue.end;
                endSeconds = cue.endSeconds;
            }
            length += line.length + (lines.length ? 1 : 0);
            lines.push(line);
            offset = end;
        }
    }
    if (lines.length) flush();
    return pages;
}

function cancelled() {
    return { ok: false, cancelled: true, error: MESSAGES.cancelledByUser };
}

async function fetchTranscript(url, lang, ctx) {
    const listing = await listSubtitles(url, ctx.browser, ctx.proxy, { forTranscript: true, signal: ctx.signal });
    if (ctx.signal?.aborted) return cancelled();
    if (listing.error) {
        return { ok: false, error: MESSAGES.transcriptListingFailed, output: lastLines(listing.message) };
    }
    if (!listing.subtitles.length) return { ok: false, error: MESSAGES.noTranscriptCaptions };

    const manual = listing.subtitles.filter((track) => track.type === 'manual');
    const automatic = listing.subtitles.filter((track) => track.type === 'auto-original');
    const track = lang
        ? findSubtitleTrack(manual, lang) || findSubtitleTrack(automatic, lang)
        : (listing.originalLanguage && findSubtitleTrack(manual, listing.originalLanguage)) || manual[0] || automatic[0];
    if (!track) {
        return { ok: false, error: MESSAGES.noTranscriptLanguage(lang, listing.subtitles.map(({ code }) => code).join(', ')) };
    }
    const code = validateLang(track.code);
    const auto = track.type === 'auto-original';
    const folder = await fs.mkdtemp(join(getScratchDirectory(), 'vidbutler-transcript-'));
    try {
        if (ctx.signal?.aborted) return cancelled();
        const res = await runYtDlpIn(ctx, [
            ...commonArgs(ctx), '--ignore-config', '--no-playlist', '--playlist-items', '1',
            '--skip-download', auto ? '--write-auto-subs' : '--write-subs',
            '--sub-langs', `^${code}$`, '--sub-format', 'vtt/best', '--convert-subs', 'vtt',
            '-P', folder, '-o', 'caption.%(ext)s', url
        ]);
        if (!res.success) return outcome(res, { output: lastLines(res.output) });
        if (ctx.signal?.aborted) return cancelled();

        const file = join(folder, `caption.${code}.vtt`);
        const stat = await fs.lstat(file);
        if (!stat.isFile()) return { ok: false, error: MESSAGES.transcriptMissing };
        if (stat.size > MAX_TRANSCRIPT_FILE_BYTES) return { ok: false, error: MESSAGES.transcriptTooLarge };
        const contents = await fs.readFile(file, { encoding: 'utf8', signal: ctx.signal });
        const pages = transcriptPages(parseWebVtt(contents, { rolling: auto }));
        if (!pages.length) return { ok: false, error: MESSAGES.transcriptEmpty };
        return { ok: true, url, lang, track, pages };
    } catch (error) {
        if (ctx.signal?.aborted) return cancelled();
        if (error.code === 'ENOENT') return { ok: false, error: MESSAGES.transcriptMissing };
        throw error;
    } finally {
        await fs.rm(folder, { recursive: true, force: true, maxRetries: 2 });
    }
}

export const videoTranscriptTool = defineTool({
    name: TOOL_NAMES.getVideoTranscript,
    description: MESSAGES.transcriptDescription,
    properties: {
        url: urlProperty,
        lang: { type: 'string', description: MESSAGES.transcriptLanguageDescription },
        page: { type: 'integer', description: MESSAGES.transcriptPageDescription }
    },
    required: ['url'],
    describe: MESSAGES.describeTranscript,
    async run(args, ctx) {
        const url = validateUrl(args.url);
        const lang = args.lang == null ? undefined : validateLang(args.lang);
        const page = validateIntRange(args.page, 1, Number.MAX_SAFE_INTEGER, 'page') ?? 1;
        if (ctx.signal?.aborted) return cancelled();
        const pagesRead = ctx.transcriptPagesRead ?? 0;
        if (pagesRead >= MAX_TRANSCRIPT_PAGES_PER_SUMMARY) return { ok: false, error: MESSAGES.transcriptPageLimit };

        if (ctx.transcript?.url !== url || (ctx.transcript.lang !== lang && ctx.transcript.track.code !== lang)) {
            const result = await fetchTranscript(url, lang, ctx);
            if (!result.ok) return result;
            ctx.transcript = result;
        }
        const { track, pages } = ctx.transcript;
        if (page > pages.length) return { ok: false, error: MESSAGES.transcriptPageUnavailable(pages.length) };
        ctx.transcriptPagesRead = pagesRead + 1;
        return {
            ok: true,
            language: track.code,
            is_auto_generated: track.type === 'auto-original',
            page,
            total_pages: pages.length,
            next_page: page < pages.length ? page + 1 : null,
            ...pages[page - 1]
        };
    }
});

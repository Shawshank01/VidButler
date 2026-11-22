import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parseWebVtt } from '../src/core/webvtt.ts';
import { listSubtitles } from '../src/core/tools.ts';
import { runAgent } from '../src/llm/agent.ts';
import { ProviderError } from '../src/llm/errors.js';
import {
    MAX_SMALL_TRANSCRIPT_INPUT_CHARS, MAX_TRANSCRIPT_FILE_BYTES, MAX_TRANSCRIPT_INPUT_CHARS,
    MAX_TRANSCRIPT_PAGE_CHARS, MAX_TRANSCRIPT_PAGE_READS
} from '../src/llm/limits.js';
import { MESSAGES } from '../src/llm/messages.js';
import { buildSystemPrompt } from '../src/llm/prompt.js';
import { getTool, TOOL_NAMES } from '../src/llm/tool-registry.ts';

const url = 'https://example.test/watch?v=captioned&list=playlist';
const transcript = getTool(TOOL_NAMES.getVideoTranscript);
const posixStub = { skip: process.platform === 'win32' ? 'uses a POSIX executable stub' : false };

async function stubYtDlp(t, info, contents) {
    const bin = await fs.mkdtemp(join(tmpdir(), 'vidbutler-transcript-test-'));
    const log = join(bin, 'arguments.jsonl');
    const oldPath = process.env.PATH;
    t.after(async () => {
        process.env.PATH = oldPath;
        await fs.rm(bin, { recursive: true, force: true });
    });
    await fs.writeFile(join(bin, 'yt-dlp'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.includes('-j')) {
    console.log(${JSON.stringify(JSON.stringify(info))});
} else if (args.includes('--print')) {
    console.log('Captioned video\\tExample uploader\\t30:33\\tFalse');
} else {
    const contents = ${JSON.stringify(contents ?? null)};
    const lang = args[args.indexOf('--sub-langs') + 1].slice(1, -1);
    const file = path.join(args[args.indexOf('-P') + 1], 'caption.' + lang + '.vtt');
    if (typeof contents === 'string') fs.writeFileSync(file, contents);
    if (typeof contents === 'number') {
        fs.writeFileSync(file, '');
        fs.truncateSync(file, contents);
    }
}
`, { mode: 0o755 });
    process.env.PATH = `${bin}${delimiter}${oldPath}`;
    return async () => (await fs.readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

function caption(text) {
    return `WEBVTT\n\n00:00.000 --> 00:04.000\n${text}\n`;
}

test('WebVTT captions preserve cue times and readable text, including in rolling tracks', () => {
    const vtt = `\uFEFFWEBVTT - Test\r\n\r\nNOTE This is a comment\r\n00:00.000 --> 00:00.200\r\nIgnore this block\r\n\r\nSTYLE\r\n::cue {color: white}\r\n\r\n1\r\n00:00.100 --> 00:01.000 align:start\r\n<v Host>Hello &amp; <00:00.400><c>goodbye</c>\r\n\r\n00:01.000 --> 00:02.000\r\nHello &amp; goodbye\r\nNext &lt;topic&gt;\r\n\r\n00:02.000 --> 00:03.000\r\nNext &lt;topic&gt;\r\n\r\n00:09.000 --> 00:10.000\r\nNext &lt;topic&gt;\r\n`;
    const manual = [...parseWebVtt(vtt)];
    assert.equal(manual.length, 4);
    assert.equal(manual[1].text, 'Hello & goodbye Next <topic>');
    const rolling = [...parseWebVtt(vtt, { rolling: true })];
    assert.deepEqual(rolling.map(({ start, end, text }) => [start, end, text]), [
        ['00:00.100', '00:01.000', 'Hello & goodbye'],
        ['00:01.000', '00:02.000', 'Next <topic>'],
        ['00:09.000', '00:10.000', 'Next <topic>']
    ]);
    assert.deepEqual([...parseWebVtt('an error page')], []);
});

test('the agent can fetch individual timestamped pages without downloading captions again', posixStub, async (t) => {
    const contents = caption(`${'A'.repeat(MAX_TRANSCRIPT_PAGE_CHARS + 500)} Final setup instruction.`);
    const calls = await stubYtDlp(t, {
        language: 'en', subtitles: { es: [{ name: 'Spanish' }], en: [{ name: 'English' }] },
        automatic_captions: { 'en-orig': [{ name: 'English (Original)' }] }
    }, contents);
    const history = [];
    const system = buildSystemPrompt();
    assert.match(system, /summarize an online video.*use get_video_transcript/);
    const provider = {
        async chat({ messages, tools }) {
            assert.ok(tools.some(({ name }) => name === transcript.name));
            const results = messages.filter((message) => message.role === 'tool').map(({ result }) => result);
            if (results.length === 2) {
                assert.match(results[1].transcript, /Final setup instruction\./);
                return { toolCalls: [], text: 'The setup is described at 00:00.' };
            }
            const previous = results[0];
            const args = { url, mode: 'page', lang: previous?.language, page: previous?.next_page };
            return { toolCalls: [{ id: `caption-${results.length}`, name: transcript.name, args }] };
        }
    };
    const res = await runAgent({
        provider, system, history, userText: `What is the final setup instruction in ${url}?`,
        ctx: { browser: 'firefox', proxy: 'socks5://127.0.0.1:1080' }
    });
    assert.equal(res.text, 'The setup is described at 00:00.');
    const pages = history.filter((message) => message.role === 'tool').map(({ result }) => result);
    assert.equal(pages[0].language, 'en');
    assert.equal(pages[0].is_auto_generated, false);
    assert.equal(pages[0].total_pages, 2);
    assert.equal(pages[0].next_page, 2);
    assert.equal(pages[1].next_page, null);
    assert.equal(pages[0].from, '00:00.000');
    assert.equal(pages[1].through, '00:04.000');
    assert.ok(pages.every(({ transcript }) => transcript.length <= MAX_TRANSCRIPT_PAGE_CHARS));
    const [lookup, fetch] = await calls();
    assert.equal((await calls()).length, 2);
    assert.ok(lookup.includes('-j'));
    for (const args of [lookup, fetch]) {
        assert.ok(args.includes('--skip-download'));
        assert.ok(args.includes('--no-playlist'));
        assert.equal(args[args.indexOf('--playlist-items') + 1], '1');
        assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'firefox');
        assert.equal(args[args.indexOf('--proxy') + 1], 'socks5://127.0.0.1:1080');
        assert.equal(args.at(-1), url);
    }
    assert.ok(fetch.includes('--write-subs'));
    assert.equal(fetch[fetch.indexOf('--sub-langs') + 1], '^en$');
    await assert.rejects(fs.stat(fetch[fetch.indexOf('-P') + 1]), { code: 'ENOENT' });
});

test('a video summary receives all six caption pages intact before the model answers', posixStub, async (t) => {
    const cues = Array.from({ length: MAX_TRANSCRIPT_INPUT_CHARS / MAX_TRANSCRIPT_PAGE_CHARS }, (_, index) => {
        const timestamp = `0${index}:00.000 --> 0${index}:04.000`;
        return `${timestamp}\n${'"'.repeat(MAX_TRANSCRIPT_PAGE_CHARS - 100)} Caption page ${index + 1}.`;
    });
    const calls = await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, `WEBVTT\n\n${cues.join('\n\n')}`);
    const history = [];
    const provider = {
        async chat({ messages }) {
            const results = messages.filter(({ role }) => role === 'tool');
            if (!results.length) {
                return { toolCalls: [{ id: 'captions', name: transcript.name, args: { url, page: 1 } }] };
            }

            const captions = results[0].result;
            assert.equal(captions.total_pages, cues.length);
            assert.equal(captions.last_page, captions.total_pages);
            assert.equal(captions.next_page, null);
            assert.equal(captions.from, '00:00.000');
            assert.equal(captions.through, '05:04.000');
            for (const cue of cues) assert.ok(captions.transcript.includes(cue.split('\n')[1]));

            if (results.length === 1) {
                return { toolCalls: [{ id: 'metadata', name: TOOL_NAMES.getOnlineVideoInfo, args: { url } }] };
            }
            assert.equal(results[1].result.title, 'Captioned video');
            return { toolCalls: [], text: 'The conclusion appears at 05:00.' };
        }
    };
    const res = await runAgent({ provider, system: buildSystemPrompt(), history, userText: `Summarize ${url}`, ctx: {} });
    assert.equal(res.text, 'The conclusion appears at 05:00.');
    assert.equal(res.steps, 3);
    assert.equal((await calls()).length, 3);
});

test('long summaries read every chunk and consolidate notes within the provider budget', posixStub, async (t) => {
    const chunkCount = 24;
    const cues = Array.from({ length: chunkCount }, (_, index) => {
        const minute = String(index).padStart(2, '0');
        return `${minute}:00.000 --> ${minute}:04.000\nSection ${index + 1}. ${'A'.repeat(MAX_SMALL_TRANSCRIPT_INPUT_CHARS - 125)}`;
    });
    const calls = await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, `WEBVTT\n\n${cues.join('\n\n')}`);
    const history = [];
    const progress = [];
    const chunksRead = [];
    let mergeCalls = 0;
    const userText = `Summarize ${url}, focusing on the examples.`;
    const provider = {
        id: 'ollama',
        async chat({ messages, tools, onTextDelta }) {
            if (!tools.length) {
                assert.equal(onTextDelta, undefined);
                assert.equal(messages.length, 1);
                const source = JSON.parse(messages[0].text);
                assert.equal(source.request, userText);
                assert.ok(source.text.length <= MAX_SMALL_TRANSCRIPT_INPUT_CHARS);
                const sections = source.text.match(/Section \d+\./g);
                if (source.sourceType === 'captions') {
                    assert.deepEqual(sections, [`Section ${chunksRead.length + 1}.`]);
                    chunksRead.push(source.from);
                    return { text: sections[0] + ' ' + 'N'.repeat(620), toolCalls: [] };
                }
                assert.equal(source.sourceType, 'notes');
                mergeCalls += 1;
                return { text: sections.join(' '), toolCalls: [] };
            }
            const result = messages.find(({ role }) => role === 'tool')?.result;
            if (!result) {
                return { toolCalls: [{ id: 'captions', name: transcript.name, args: { url } }] };
            }
            assert.equal(result.next_page, null);
            assert.equal(result.from, '00:00.000');
            assert.equal(result.through, '23:04.000');
            assert.equal(result.transcript, undefined);
            assert.deepEqual(
                result.summary_notes.match(/Section \d+\./g),
                cues.map((_, index) => `Section ${index + 1}.`)
            );
            return { text: 'All sections summarized.', toolCalls: [] };
        }
    };
    const res = await runAgent({
        provider, system: buildSystemPrompt(), history, userText,
        ctx: { onProgress: (message) => progress.push(message) }
    });
    assert.equal(res.text, 'All sections summarized.');
    assert.equal(res.steps, 2);
    assert.equal(chunksRead.length, chunkCount);
    assert.ok(mergeCalls > 0);
    assert.ok(progress.includes(MESSAGES.transcriptChunkProgress(chunkCount, chunkCount)));
    assert.equal((await calls()).length, 2);
});

test('stopping a long summary cancels intermediate caption processing', posixStub, async (t) => {
    const contents = caption('A'.repeat(MAX_SMALL_TRANSCRIPT_INPUT_CHARS * 2));
    await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, contents);
    const controller = new AbortController();
    const events = [];
    let summaryCalls = 0;
    const provider = {
        id: 'ollama',
        async chat({ tools, signal }) {
            if (!tools.length) {
                assert.equal(signal, controller.signal);
                summaryCalls += 1;
                controller.abort();
                return { text: 'Unfinished notes.', toolCalls: [] };
            }
            return { toolCalls: [{ id: 'captions', name: transcript.name, args: { url } }] };
        }
    };
    const res = await runAgent({
        provider, system: buildSystemPrompt(), history: [], userText: `Summarize ${url}`,
        ctx: {}, signal: controller.signal, onEvent: (event) => events.push(event)
    });
    assert.equal(res.stoppedBecause, 'aborted');
    assert.equal(summaryCalls, 1);
    assert.equal(events.find(({ type }) => type === 'tool_result').cancelled, true);
});

test('a provider failure during caption processing never reports complete coverage', posixStub, async (t) => {
    await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, caption('A'.repeat(MAX_SMALL_TRANSCRIPT_INPUT_CHARS * 2)));
    const failure = new ProviderError('Quota reached.', { kind: 'rate_limit' });
    const events = [];
    const history = [];
    let summaryCalls = 0;
    const provider = {
        id: 'ollama',
        async chat({ tools }) {
            if (!tools.length) {
                summaryCalls += 1;
                if (summaryCalls === 2) throw failure;
                return { text: 'First chunk only.', toolCalls: [] };
            }
            return { toolCalls: [{ id: 'captions', name: transcript.name, args: { url } }] };
        }
    };
    await assert.rejects(runAgent({
        provider, system: buildSystemPrompt(), history, userText: `Summarize ${url}`,
        ctx: {}, onEvent: (event) => events.push(event)
    }), (error) => error === failure);
    assert.equal(summaryCalls, 2);
    assert.equal(events.find(({ type }) => type === 'tool_result').ok, false);
    assert.ok(history.every(({ role }) => role !== 'tool'));
});

test('transcript can select original-language automatic captions alongside other manual tracks', posixStub, async (t) => {
    const calls = await stubYtDlp(t, {
        subtitles: { es: [{ name: 'Spanish' }] },
        automatic_captions: { fr: [{ name: 'French' }], 'en-orig': [{ name: 'English (Original)' }] }
    }, caption('Automatically generated.'));
    const result = await transcript.run({ url, lang: 'en' }, {});
    assert.equal(result.ok, true);
    assert.equal(result.language, 'en-orig');
    assert.equal(result.is_auto_generated, true);
    const [, fetch] = await calls();
    assert.ok(fetch.includes('--write-auto-subs'));
    assert.equal(fetch[fetch.indexOf('--sub-langs') + 1], '^en-orig$');
});

test('Classic and AI recognize an original caption when YouTube uses a different language tag', posixStub, async (t) => {
    const english = { code: 'en-orig', name: 'English', type: 'auto-original' };
    for (const [name, info] of [
        ['regional audio language with multiple original tracks', {
            language: 'en-US', automatic_captions: {
                'fr-orig': [{ name: 'French (Original)' }],
                'en-orig': [{ name: 'English (Original)' }],
                en: [{ name: 'English' }], ja: [{ name: 'Japanese' }]
            }
        }],
        ['missing audio language with one original track', {
            automatic_captions: { 'en-orig': [{ name: 'English (Original)' }], es: [{ name: 'Spanish' }] }
        }],
        ['empty exact match with a usable base-language track', {
            language: 'en-US', automatic_captions: { 'en-US-orig': [], 'en-orig': [{ name: 'English (Original)' }] }
        }]
    ]) {
        await t.test(name, async (subtest) => {
            await stubYtDlp(subtest, info, caption('Original English captions.'));
            const classic = await listSubtitles(url);
            assert.equal(classic.error, false);
            assert.deepEqual(classic.subtitles, [english]);
            assert.equal(classic.isAutoGenerated, true);
            const ai = await getTool(TOOL_NAMES.listSubtitles).run({ url }, {});
            assert.deepEqual(ai, { ok: true, is_auto_generated: true, subtitles: [english] });
            const result = await transcript.run({ url }, {});
            assert.equal(result.language, english.code);
            assert.equal(result.is_auto_generated, true);
        });
    }
});

test('missing captions are reported without fetching media', posixStub, async (t) => {
    const calls = await stubYtDlp(t, {}, null);
    assert.deepEqual(await transcript.run({ url }, {}), { ok: false, error: MESSAGES.noTranscriptCaptions });
    assert.equal((await calls()).length, 1);
});

test('caption files are bounded and the temp directory is removed on failure', posixStub, async (t) => {
    const calls = await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, MAX_TRANSCRIPT_FILE_BYTES + 1);
    assert.deepEqual(await transcript.run({ url }, {}), { ok: false, error: MESSAGES.transcriptTooLarge });
    const [, fetch] = await calls();
    await assert.rejects(fs.stat(fetch[fetch.indexOf('-P') + 1]), { code: 'ENOENT' });
});

test('individual page lookups can continue in the next turn after using the page budget', posixStub, async (t) => {
    const text = 'A'.repeat(MAX_TRANSCRIPT_PAGE_CHARS * MAX_TRANSCRIPT_PAGE_READS);
    const calls = await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, caption(text));
    const ctx = {};
    let nextPage = 1;
    for (let index = 0; index < MAX_TRANSCRIPT_PAGE_READS; index += 1) {
        const result = await transcript.run({ url, mode: 'page', page: nextPage }, ctx);
        assert.equal(result.ok, true);
        nextPage = result.next_page;
    }
    assert.equal(nextPage, MAX_TRANSCRIPT_PAGE_READS + 1);
    assert.deepEqual(await transcript.run({ url, mode: 'page', page: nextPage }, ctx), {
        ok: false, error: MESSAGES.transcriptPageLimit
    });
    assert.equal((await calls()).length, 2);
    const continuation = await transcript.run({ url, page: nextPage, mode: 'page' }, {});
    assert.equal(continuation.page, nextPage);
    assert.equal(continuation.next_page, null);
    assert.equal((await calls()).length, 4);
});

test('transcript rejects invalid arguments and applies existing URL confirmation rules', async () => {
    await assert.rejects(transcript.run({ url: 'file:///tmp/video' }, {}), /http/);
    await assert.rejects(transcript.run({ url, lang: '../../captions' }, {}), /language code/);
    await assert.rejects(transcript.run({ url, mode: 'unknown' }, {}), /mode/);
    await assert.rejects(transcript.run({ url, page: 0 }, {}), /page/);
    const history = [];
    const confirmations = [];
    const provider = {
        async chat({ messages }) {
            if (messages.some((message) => message.role === 'tool')) return { toolCalls: [], text: 'The transcript was declined.' };
            return { toolCalls: [{ id: 'caption', name: transcript.name, args: { url } }] };
        }
    };
    await runAgent({
        provider, system: 's', history, userText: 'Summarize https://example.test/other', ctx: {},
        confirm: (request) => { confirmations.push(request); return false; }
    });
    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0].reason, MESSAGES.urlNotFromUser);
    assert.equal(history.find((message) => message.role === 'tool').result.error, MESSAGES.declinedByUser);
});

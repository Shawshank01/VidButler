import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parseWebVtt } from '../src/core/webvtt.js';
import { listSubtitles } from '../src/core/tools.js';
import { runAgent } from '../src/llm/agent.js';
import { MAX_TRANSCRIPT_FILE_BYTES, MAX_TRANSCRIPT_PAGE_CHARS, MAX_TRANSCRIPT_PAGES_PER_SUMMARY } from '../src/llm/limits.js';
import { MESSAGES } from '../src/llm/messages.js';
import { buildSystemPrompt } from '../src/llm/prompt.js';
import { getTool, TOOL_NAMES } from '../src/llm/tool-registry.js';

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

test('the agent fetches timestamped pages once per turn and summarizes without a download folder', posixStub, async (t) => {
    const contents = caption(`${'A'.repeat(MAX_TRANSCRIPT_PAGE_CHARS + 500)} Final setup instruction.`);
    const calls = await stubYtDlp(t, {
        language: 'en', subtitles: { es: [{ name: 'Spanish' }], en: [{ name: 'English' }] },
        automatic_captions: { 'en-orig': [{ name: 'English (Original)' }] }
    }, contents);
    const history = [];
    const system = buildSystemPrompt();
    assert.match(system, /summarize an online video.*use get_video_transcript/);
    assert.match(system, /Say which part you covered if more pages remain/);
    const provider = {
        async chat({ messages, tools }) {
            assert.ok(tools.some(({ name }) => name === transcript.name));
            const results = messages.filter((message) => message.role === 'tool').map(({ result }) => result);
            if (results.length === 2) {
                assert.match(results[1].transcript, /Final setup instruction\./);
                return { toolCalls: [], text: 'The setup is described at 00:00.' };
            }
            const previous = results[0];
            const args = previous ? { url, lang: previous.language, page: previous.next_page } : { url };
            return { toolCalls: [{ id: `caption-${results.length}`, name: transcript.name, args }] };
        }
    };
    const res = await runAgent({
        provider, system, history, userText: `Summarize ${url}`,
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

test('long transcripts can continue from the returned page in the next turn', posixStub, async (t) => {
    const text = 'A'.repeat(MAX_TRANSCRIPT_PAGE_CHARS * MAX_TRANSCRIPT_PAGES_PER_SUMMARY);
    const calls = await stubYtDlp(t, { subtitles: { en: [{ name: 'English' }] } }, caption(text));
    const ctx = {};
    let nextPage = 1;
    for (let index = 0; index < MAX_TRANSCRIPT_PAGES_PER_SUMMARY; index += 1) {
        const result = await transcript.run({ url, page: nextPage }, ctx);
        assert.equal(result.ok, true);
        nextPage = result.next_page;
    }
    assert.equal(nextPage, MAX_TRANSCRIPT_PAGES_PER_SUMMARY + 1);
    assert.deepEqual(await transcript.run({ url, page: nextPage }, ctx), { ok: false, error: MESSAGES.transcriptPageLimit });
    assert.equal((await calls()).length, 2);
    assert.equal((await transcript.run({ url, page: nextPage }, {})).next_page, null);
    assert.equal((await calls()).length, 4);
});

test('transcript rejects invalid arguments and applies existing URL confirmation rules', async () => {
    await assert.rejects(transcript.run({ url: 'file:///tmp/video' }, {}), /http/);
    await assert.rejects(transcript.run({ url, lang: '../../captions' }, {}), /language code/);
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

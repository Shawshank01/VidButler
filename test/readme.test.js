import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { test } from 'node:test';

const englishPath = new URL('../README.md', import.meta.url);
const docsPath = new URL('../docs/', import.meta.url);
const read = (path) => readFileSync(path, 'utf8');

function links(markdown) {
    return [...markdown.matchAll(/\]\(([^)]+)\)|<img\s+src="([^"]+)"/g)]
        .map(([, target, src]) => target ?? src);
}

test('the English README links every translation and the translated READMEs preserve shared resources', () => {
    const english = read(englishPath);
    const introduction = english.split('\n## ', 1)[0];
    assert.match(introduction, /^A cross-platform media assistant built with Electron/m);
    assert.match(introduction, /summari[sz]e videos.*captions/i);
    assert.match(introduction, /download clips from online sources by start and end time/i);
    const translations = readdirSync(docsPath).filter((name) => /^README\.[\w-]+\.md$/.test(name)).sort();
    const indexed = links(english).filter((link) => link.startsWith('docs/README.'))
        .map((link) => link.slice('docs/'.length)).sort();
    assert.ok(indexed.length > 0);
    assert.deepEqual(indexed, translations);

    const commands = (markdown) => markdown.match(/^ *`{3}bash\n[\s\S]*?^ *`{3}$/gm);
    const externalLinks = (markdown) => links(markdown).filter((link) => link.startsWith('https://')).sort();

    for (const name of translations) {
        const path = new URL(name, docsPath);
        const markdown = read(path);
        assert.match(markdown, /^# VidButler$/m, name);
        assert.ok(links(markdown).includes('../README.md'), name);
        assert.deepEqual(commands(markdown), commands(english), name);
        assert.deepEqual(externalLinks(markdown), externalLinks(english), name);
        for (const link of links(markdown).filter((target) => !target.startsWith('https://'))) {
            assert.ok(statSync(new URL(link, path)).isFile(), `${name}: ${link}`);
        }
    }
});

test('Cohere leads the provider table in every README', () => {
    const english = read(englishPath);
    const firstProvider = (markdown) => markdown.match(/^\| --- \| --- \| --- \|\n(\| .*)$/m)?.[1] ?? '';
    assert.match(firstProvider(english), /\| Most recommended\. The Free Tier is sufficient for daily use\. \|$/);

    const paths = [englishPath, ...links(english)
        .filter((link) => link.startsWith('docs/README.'))
        .map((link) => new URL(link, englishPath))];

    for (const path of paths) {
        assert.match(firstProvider(read(path)), /^\| \*\*Cohere\*\*.*`command-a-plus-05-2026`/, path.pathname);
    }
});

test('the English README uses the requested Rockets note for xAI Grok', () => {
    const row = read(englishPath).split('\n').find((line) => line.startsWith('| **xAI Grok**'));
    assert.equal(row?.split('|').at(-2)?.trim(), 'Use it to show your support for the Rockets.');
});

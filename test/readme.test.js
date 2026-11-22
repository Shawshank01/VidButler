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

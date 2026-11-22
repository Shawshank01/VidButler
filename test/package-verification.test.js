import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import asar from '@electron/asar';
import { verifyAppArchive } from '../scripts/verify-package.mjs';

test('the release smoke check rejects missing runtime files and packaged TypeScript', async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), 'vidbutler-asar-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const app = join(scratch, 'app');
    await mkdir(join(app, 'out', 'llm'), { recursive: true });
    const { main, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    await writeFile(join(app, 'package.json'), JSON.stringify({ main, version }));
    await writeFile(join(app, 'tools-versions.json'), await readFile(new URL('../tools-versions.json', import.meta.url)));
    for (const file of ['main.js', 'index.html', 'styles.css', 'preload.cjs', 'renderer.js', 'ai-ui.js', 'llm/agent.js']) {
        await writeFile(join(app, 'out', file), '');
    }

    const valid = join(scratch, 'valid.asar');
    await asar.createPackage(app, valid);
    verifyAppArchive(valid);

    const withSource = join(scratch, 'with-source.asar');
    await writeFile(join(app, 'out', 'llm', 'agent.ts'), '');
    await asar.createPackage(app, withSource);
    assert.throws(() => verifyAppArchive(withSource), /Unexpected source file.*agent\.ts/);

    const missingPreload = join(scratch, 'missing-preload.asar');
    await rm(join(app, 'out', 'preload.cjs'));
    await asar.createPackage(app, missingPreload);
    assert.throws(() => verifyAppArchive(missingPreload), /Missing out\/preload\.cjs/);
});

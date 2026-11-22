import { execFile } from 'node:child_process';
import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = new URL('../', import.meta.url);
const execFileAsync = promisify(execFile);
let compilation;

export async function compileApp(output = fileURLToPath(new URL('out/', root))) {
    await rm(output, { recursive: true, force: true });
    try {
        const tsc = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
        await execFileAsync(process.execPath, [tsc, '--project', 'tsconfig.build.json', '--outDir', output], { cwd: root });
    } catch (error) {
        if (error.stdout) console.error(error.stdout.trimEnd());
        throw error;
    }
    const staticFiles = [
        'index.html', 'styles.css', 'preload.cjs', 'log-classification.cjs',
        'shared-context.js', 'markdown.js'
    ];
    await Promise.all(staticFiles.map((file) => copyFile(
        new URL(`src/${file}`, root),
        join(output, file)
    )));
}

export default function beforePack() {
    compilation ??= compileApp();
    return compilation;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    await compileApp();
}

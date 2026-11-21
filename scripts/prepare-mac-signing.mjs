import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const bundledTools = ['yt-dlp', 'deno', 'ffmpeg', 'ffprobe'];

export default async function prepareMacSigning({ appOutDir, electronPlatformName, packager }) {
    if (electronPlatformName !== 'darwin') return;

    const toolsDir = join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'tools');
    const entries = await readdir(toolsDir).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    const toolNames = bundledTools.filter((name) => entries.includes(name));
    let signaturesChanged = false;

    // electron-builder skips these tools so valid upstream signatures and tool bytes are preserved.
    for (const name of toolNames) {
        const tool = join(toolsDir, name);
        const verifyArgs = ['--verify', '--strict', '--all-architectures', tool];
        try {
            await execFileAsync('codesign', verifyArgs);
        } catch (error) {
            if (typeof error.code !== 'number') throw error;
            await execFileAsync('codesign', ['--force', '--sign', '-', '--timestamp=none', tool]);
            await execFileAsync('codesign', verifyArgs);
            signaturesChanged = true;
        }
    }

    // CI ships a checksum manifest. Refresh it before electron-builder seals the app bundle.
    if (signaturesChanged && entries.includes('SHA256SUMS')) {
        const files = [...toolNames, ...entries.filter((name) => name === 'yt-dlp-manifest.json')];
        const { stdout } = await execFileAsync('shasum', ['-a', '256', ...files], { cwd: toolsDir });
        await writeFile(join(toolsDir, 'SHA256SUMS'), stdout);
    }
}

const releaseIndex = 'https://download.videolan.org/pub/videolan/dav1d/';

async function getReleaseText(path) {
    const url = new URL(path, releaseIndex);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Could not check dav1d releases: HTTP ${response.status} from ${url}`);
    return response.text();
}

export async function checkDav1dUpdate(current) {
    const listing = await getReleaseText('last/');
    const version = listing.match(/href="dav1d-(\d+\.\d+\.\d+)\.tar\.xz"/)?.[1];
    if (!version) throw new Error('The VideoLAN release index did not contain a stable dav1d archive.');
    if (version.localeCompare(current.version, 'en', { numeric: true }) <= 0) return current;

    const archive = `dav1d-${version}.tar.xz`;
    const checksum = await getReleaseText(`${version}/${archive}.sha256`);
    const [sha256, filename] = checksum.trim().split(/\s+/);
    if (!/^[0-9a-f]{64}$/i.test(sha256) || filename?.replace(/^\*/, '') !== archive) {
        throw new Error(`VideoLAN did not publish a valid SHA-256 checksum for ${archive}.`);
    }
    return { version, sha256: sha256.toLowerCase() };
}

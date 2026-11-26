import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDav1dUpdate } from '../scripts/dav1d-release.mjs';

const releaseIndex = 'https://download.videolan.org/pub/videolan/dav1d/';
const current = { version: '1.5.9', sha256: 'a'.repeat(64) };
const nextVersion = '1.5.10';
const nextArchive = `dav1d-${nextVersion}.tar.xz`;
const nextChecksum = 'b'.repeat(64);

test('dav1d updates the version and the checksum from the matching VideoLAN release', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
        if (url.href === releaseIndex + 'last/') {
            return new Response(`<a href="${nextArchive}">${nextArchive}</a>`);
        }
        assert.equal(url.href, releaseIndex + `${nextVersion}/${nextArchive}.sha256`);
        return new Response(`${nextChecksum} *${nextArchive}\n`);
    });

    assert.deepEqual(await checkDav1dUpdate(current), { version: nextVersion, sha256: nextChecksum });
    assert.equal(fetch.mock.callCount(), 2);
});

test('dav1d keeps the pinned checksum when VideoLAN has no newer release', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
        assert.equal(url.href, releaseIndex + 'last/');
        return new Response('<a href="dav1d-1.5.8.tar.xz">dav1d-1.5.8.tar.xz</a>');
    });

    assert.deepEqual(await checkDav1dUpdate(current), current);
    assert.equal(fetch.mock.callCount(), 1);
});

test('dav1d rejects a checksum published for a different archive', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url) => url.pathname.endsWith('/last/')
        ? new Response(`<a href="${nextArchive}">${nextArchive}</a>`)
        : new Response(`${nextChecksum} *dav1d-1.5.11.tar.xz\n`));

    await assert.rejects(checkDav1dUpdate(current), /did not publish a valid SHA-256 checksum/);
});

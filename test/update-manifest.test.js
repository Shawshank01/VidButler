import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeUpdateManifests } from "../scripts/merge-update-manifests.mjs";

const manifest = (arch, hash) => `version: 4.7.0
files:
  - url: VidButler-mac-${arch}-4.7.0.zip
    sha512: ${hash}
    size: 123
path: VidButler-mac-${arch}-4.7.0.zip
sha512: ${hash}
releaseDate: '2026-11-08T12:00:00.000Z'
`;

test("release manifest merge preserves each architecture file entry", () => {
  const merged = mergeUpdateManifests([
    manifest("arm64", "arm-hash"),
    manifest("x64", "intel-hash"),
  ]);

  assert.match(merged, /version: 4\.7\.0/);
  assert.match(merged, /VidButler-mac-arm64-4\.7\.0\.zip/);
  assert.match(merged, /VidButler-mac-x64-4\.7\.0\.zip/);
  assert.equal(
    (merged.match(/^- url:/gm) || []).length,
    0,
    "file entries remain indented",
  );
  assert.equal((merged.match(/^ {2}- url:/gm) || []).length, 2);
});

test("release manifest merge rejects mismatched versions", () => {
  assert.throws(
    () =>
      mergeUpdateManifests([
        manifest("arm64", "a"),
        manifest("x64", "b").replace("4.7.0", "4.8.0"),
      ]),
    /different versions/,
  );
});

test("release publishes the builder's x64 and ARM64 Linux manifests separately", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /- name: Preserve architecture-specific update manifest\n\s+if: runner\.os != 'Linux'/);
  assert.match(workflow, /^\s+cp dist\/\*\/latest-linux\.yml release_assets\/latest-linux\.yml$/m);
  assert.match(workflow, /^\s+cp dist\/\*\/latest-linux-arm64\.yml release_assets\/latest-linux-arm64\.yml$/m);
});

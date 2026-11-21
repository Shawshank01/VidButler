import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROFILE_DATA_ENTRIES } from "../src/core/local-data.js";

test("release workflow preserves the Homebrew cask settings", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const template = workflow.match(/cask "vidbutler" do[\s\S]*?\n {8}EOF/)?.[0];
  assert.ok(template, "Homebrew cask template is present");
  assert.match(template, /depends_on :macos/);
  assert.match(template, /~\/Library\/Application Support\/\[Vv\]id\[Bb\]utler/);
  assert.match(template, /zap trash: profile_entries\.map/);
  for (const entry of PROFILE_DATA_ENTRIES) assert.ok(template.includes(`"${entry}"`), `zap should cover ${entry}`);
  assert.doesNotMatch(template, /~\/Downloads|downloadFolder/);
  assert.match(template, /rmdir: profile_dir/);
  assert.match(template, /~\/Library\/Preferences\/com\.vidbutler\.app\.plist/);
  assert.match(template, /~\/Library\/Saved Application State\/com\.vidbutler\.app\.savedState/);
  for (const arch of ["arm64", "x64"]) {
    assert.ok(template.includes(`https://github.com/Shawshank01/VidButler/releases/download/v#{version}/VidButler-mac-${arch}-#{version}.dmg`));
  }
  assert.ok(template.includes('homepage "https://github.com/Shawshank01/VidButler"'));
});

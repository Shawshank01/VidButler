import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function manifestParts(text) {
  const normalized = String(text).replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.split("\n");
  const filesStart = lines.findIndex((line) => /^files:\s*$/.test(line));
  if (filesStart < 0) throw new Error("Update manifest has no files section");

  let filesEnd = filesStart + 1;
  while (
    filesEnd < lines.length &&
    (/^\s/.test(lines[filesEnd]) || lines[filesEnd] === "")
  ) {
    filesEnd += 1;
  }

  const version = normalized.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
  if (!version) throw new Error("Update manifest has no version");

  const fileLines = lines
    .slice(filesStart + 1, filesEnd)
    .filter((line) => line.trim() !== "");
  if (!fileLines.some((line) => /^\s+-\s+url:/.test(line))) {
    throw new Error("Update manifest files section is empty");
  }

  return {
    version,
    before: lines.slice(0, filesStart + 1),
    files: fileLines,
    after: lines.slice(filesEnd),
  };
}

/** Combine electron-builder manifests created on separate architecture runners. */
export function mergeUpdateManifests(manifests) {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new Error("At least one update manifest is required");
  }

  const parsed = manifests.map(manifestParts);
  const version = parsed[0].version;
  if (parsed.some((manifest) => manifest.version !== version)) {
    throw new Error("Cannot merge update manifests with different versions");
  }

  const seenUrls = new Set();
  const mergedFileLines = [];
  for (const manifest of parsed) {
    let includeEntry = true;
    for (const line of manifest.files) {
      const url = line.match(/^\s+-\s+url:\s*['"]?(.+?)['"]?\s*$/)?.[1];
      if (url) {
        includeEntry = !seenUrls.has(url);
        seenUrls.add(url);
      }
      if (includeEntry) mergedFileLines.push(line);
    }
  }

  return (
    [...parsed[0].before, ...mergedFileLines, ...parsed[0].after].join("\n") +
    "\n"
  );
}

async function main() {
  const [outputPath, ...inputPaths] = process.argv.slice(2);
  if (!outputPath || inputPaths.length === 0) {
    throw new Error(
      "Usage: node merge-update-manifests.mjs <output> <manifest...>",
    );
  }

  const manifests = await Promise.all(
    inputPaths.sort().map((path) => readFile(path, "utf8")),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, mergeUpdateManifests(manifests));
  console.log(`Merged ${inputPaths.length} manifests into ${outputPath}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  AppUpdateService,
  MAC_UPDATE_COMMAND,
  isNewerVersion,
} from "../src/update.js";

class FakeUpdater extends EventEmitter {
  constructor(updateInfo = { version: "2.0.0" }) {
    super();
    this.updateInfo = updateInfo;
    this.checkCount = 0;
    this.downloadCount = 0;
    this.installs = [];
  }

  async checkForUpdates() {
    this.checkCount += 1;
    return { updateInfo: this.updateInfo };
  }

  async downloadUpdate() {
    this.downloadCount += 1;
    this.emit("download-progress", {
      percent: 42.5,
      bytesPerSecond: 1000,
      transferred: 425,
      total: 1000,
    });
    return ["/tmp/update"];
  }

  quitAndInstall(...args) {
    this.installs.push(args);
  }
}

function createService({
  version = "1.0.0",
  platform = "win32",
  packaged = true,
  env = {},
  updater,
  fetchImpl,
} = {}) {
  return new AppUpdateService({
    app: { isPackaged: packaged, getVersion: () => version },
    updater: updater || new FakeUpdater(),
    platform,
    env,
    log: { error: () => {} },
    fetchImpl,
  });
}

test("version comparison handles upgrades, downgrades and prereleases", () => {
  assert.equal(isNewerVersion("1.2.3", "1.2.4"), true);
  assert.equal(isNewerVersion("v1.2.3", "1.2.3"), false);
  assert.equal(isNewerVersion("2.0.0", "1.9.9"), false);
  assert.equal(isNewerVersion("2.0.0-beta.1", "2.0.0"), true);
  assert.equal(isNewerVersion("2.0.0", "2.0.1-beta.1"), true);
});

test("update checks and in-app installation are limited by platform", () => {
  const unpackaged = createService({ packaged: false });
  assert.equal(unpackaged.canCheckForUpdates(), false);
  assert.equal(unpackaged.canInstallUpdate(), false);

  const mac = createService({ platform: "darwin" });
  assert.equal(mac.canCheckForUpdates(), true);
  assert.equal(mac.canInstallUpdate(), false);

  const windows = createService({ platform: "win32" });
  assert.equal(windows.canCheckForUpdates(), true);
  assert.equal(windows.canInstallUpdate(), true);

  const extractedLinux = createService({ platform: "linux" });
  assert.equal(extractedLinux.canCheckForUpdates(), false);
  assert.equal(extractedLinux.canInstallUpdate(), false);

  const appImage = createService({
    platform: "linux",
    env: { APPIMAGE: "/opt/VidButler.AppImage" },
  });
  assert.equal(appImage.canCheckForUpdates(), true);
  assert.equal(appImage.canInstallUpdate(), true);
});

test("macOS checks the release manifest and recommends the Homebrew tap", async () => {
  const updater = new FakeUpdater();
  let requestedUrl = "";
  const service = createService({
    platform: "darwin",
    updater,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => "version: 1.1.0\nfiles: []\n",
      };
    },
  });

  const result = await service.checkForUpdates();

  assert.match(requestedUrl, /latest\/download\/latest-mac\.yml$/);
  assert.equal(updater.checkCount, 0);
  assert.equal(result.hasUpdate, true);
  assert.equal(result.version, "1.1.0");
  assert.equal(result.installSupported, false);
  assert.equal(result.updateMethod, "homebrew");
  assert.equal(result.updateCommand, MAC_UPDATE_COMMAND);
  assert.deepEqual(await service.downloadUpdate(), {
    success: false,
    error: "Automatic updates are not supported in this build.",
  });
});

test("checking finds an update without downloading it", async () => {
  const updater = new FakeUpdater({
    version: "1.1.0",
    releaseNotes: [{ version: "1.1.0", note: "Safer updates" }],
  });
  const service = createService({ updater });

  const result = await service.checkForUpdates();

  assert.equal(result.hasUpdate, true);
  assert.equal(result.version, "1.1.0");
  assert.equal(result.releaseNotes, "Safer updates");
  assert.equal(result.installSupported, true);
  assert.equal(result.updateMethod, "automatic");
  assert.equal(updater.downloadCount, 0);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test("concurrent checks share one updater request", async () => {
  const updater = new FakeUpdater();
  let releaseCheck;
  updater.checkForUpdates = async () => {
    updater.checkCount += 1;
    await new Promise((resolve) => {
      releaseCheck = resolve;
    });
    return { updateInfo: updater.updateInfo };
  };
  const service = createService({ updater });

  const first = service.checkForUpdates();
  const second = service.checkForUpdates();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.checkCount, 1);
  releaseCheck();
  assert.deepEqual(await first, await second);
});

test("a consented update reports progress, downloads, and can restart into the new version", async () => {
  const updater = new FakeUpdater({ version: "1.5.0" });
  const service = createService({ updater });
  const progress = [];
  service.onProgress((event) => progress.push(event));

  assert.equal(
    service.installUpdate(),
    false,
    "nothing can install before a download",
  );
  await service.checkForUpdates();
  const result = await service.downloadUpdate();

  assert.deepEqual(result, { success: true, version: "1.5.0" });
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(progress[0].percent, 42.5);
  assert.equal(service.installUpdate(), true);
  assert.deepEqual(updater.installs, [[true, true]]);
});

test("failed checks and downloads return safe errors instead of throwing", async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => {
    throw new Error("offline");
  };
  const service = createService({ updater });
  const check = await service.checkForUpdates();
  assert.equal(check.error, true);
  assert.match(check.message, /offline/);

  updater.checkForUpdates = async () => ({ updateInfo: { version: "2.0.0" } });
  updater.downloadUpdate = async () => {
    throw new Error("disk full");
  };
  await service.checkForUpdates();
  const download = await service.downloadUpdate();
  assert.equal(download.success, false);
  assert.match(download.error, /disk full/);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

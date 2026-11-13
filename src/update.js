const RELEASES_PAGE_URL =
  "https://github.com/Shawshank01/Vidbutler/releases/latest";
const MAC_UPDATE_MANIFEST_URL = `${RELEASES_PAGE_URL}/download/latest-mac.yml`;

export const MAC_UPDATE_COMMAND =
  "brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler";

/**
 * Compare two SemVer-like version strings.
 * Returns true when `latest` is newer than `current`.
 */
export function isNewerVersion(current, latest) {
  if (!current || !latest) return false;

  const cleanCurrent = String(current).replace(/^v/, "").trim();
  const cleanLatest = String(latest).replace(/^v/, "").trim();
  if (cleanCurrent === cleanLatest) return false;

  const parse = (version) => {
    const [core, prerelease] = version.split("-");
    const parts = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { parts, prerelease };
  };

  const currentVersion = parse(cleanCurrent);
  const latestVersion = parse(cleanLatest);
  const length = Math.max(
    currentVersion.parts.length,
    latestVersion.parts.length,
  );

  for (let i = 0; i < length; i += 1) {
    const currentPart = currentVersion.parts[i] || 0;
    const latestPart = latestVersion.parts[i] || 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  if (currentVersion.prerelease && !latestVersion.prerelease) return true;
  if (!currentVersion.prerelease && latestVersion.prerelease) return false;
  return false;
}

function releaseNotesText(releaseNotes, version) {
  if (typeof releaseNotes === "string" && releaseNotes.trim()) {
    return releaseNotes.trim();
  }
  if (Array.isArray(releaseNotes)) {
    const text = releaseNotes
      .map((entry) => (typeof entry === "string" ? entry : entry?.note))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return version ? `Release v${version} is available.` : "";
}

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "Unknown update error");
}

/**
 * Main-process update coordinator. Electron and electron-updater are injected so this module stays
 * testable under plain Node. The updater never downloads until the user has explicitly agreed.
 */
export class AppUpdateService {
  constructor({
    app,
    updater,
    platform = process.platform,
    env = process.env,
    log = console,
    fetchImpl = globalThis.fetch,
  }) {
    this.app = app;
    this.updater = updater;
    this.platform = platform;
    this.env = env;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.availableUpdate = null;
    this.downloadedVersion = null;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.progressListeners = new Set();

    // Consent is required before downloading, and a declined update must not install on quit.
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;

    this.updater.on("download-progress", (progress) => {
      const payload = {
        percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
        bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
        transferred: Number(progress?.transferred) || 0,
        total: Number(progress?.total) || 0,
      };
      for (const listener of this.progressListeners) listener(payload);
    });

    // EventEmitter treats an unhandled `error` event as fatal. The public methods still catch
    // and return these failures to the caller, while this listener records diagnostic context.
    this.updater.on("error", (error) => {
      this.log.error?.(`[update] ${errorMessage(error)}`);
    });
  }

  getCurrentVersion() {
    try {
      return this.app.getVersion();
    } catch {
      return "Unknown";
    }
  }

  canCheckForUpdates() {
    if (!this.app?.isPackaged) return false;
    if (this.platform === "darwin" || this.platform === "win32") return true;
    // AppImageUpdater replaces the AppImage named by this environment variable. Extracted
    // Linux builds and source runs cannot update themselves safely.
    return this.platform === "linux" && Boolean(this.env.APPIMAGE);
  }

  canInstallUpdate() {
    if (!this.app?.isPackaged) return false;
    if (this.platform === "win32") return true;
    return this.platform === "linux" && Boolean(this.env.APPIMAGE);
  }


  onProgress(listener) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async checkForUpdates() {
    if (!this.canCheckForUpdates()) {
      return {
        supported: false,
        installSupported: false,
        hasUpdate: false,
        currentVersion: this.getCurrentVersion(),
        releaseUrl: RELEASES_PAGE_URL,
        message:
          "Automatic updates are only available in an installed release build.",
      };
    }

    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.#performCheck();
    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  async #performCheck() {
    const currentVersion = this.getCurrentVersion();
    try {
      const updateInfo =
        this.platform === "darwin"
          ? await this.#checkMacManifest()
          : (await this.updater.checkForUpdates())?.updateInfo || null;
      const version = updateInfo?.version || "";
      const hasUpdate = isNewerVersion(currentVersion, version);
      this.availableUpdate = hasUpdate ? updateInfo : null;

      return {
        supported: true,
        installSupported: this.canInstallUpdate(),
        hasUpdate,
        currentVersion,
        version: version || currentVersion,
        releaseNotes: releaseNotesText(updateInfo?.releaseNotes, version),
        releaseUrl: RELEASES_PAGE_URL,
        updateMethod: this.platform === "darwin" ? "homebrew" : "automatic",
        ...(this.platform === "darwin"
          ? { updateCommand: MAC_UPDATE_COMMAND }
          : {}),
        message: hasUpdate ? "Update available" : "App is up to date",
      };
    } catch (error) {
      return {
        supported: true,
        installSupported: this.canInstallUpdate(),
        hasUpdate: false,
        currentVersion,
        releaseUrl: RELEASES_PAGE_URL,
        message: `Error checking app update: ${errorMessage(error)}`,
        error: true,
      };
    }
  }

  async #checkMacManifest() {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Network requests are unavailable in this build.");
    }

    const abortSignal = globalThis.AbortSignal?.timeout?.(10_000);
    const response = await this.fetchImpl(MAC_UPDATE_MANIFEST_URL, {
      headers: {
        Accept: "text/yaml, text/plain",
        "User-Agent": `VidButler/${this.getCurrentVersion()}`,
      },
      cache: "no-store",
      ...(abortSignal ? { signal: abortSignal } : {}),
    });
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}.`);
    }

    const manifest = await response.text();
    const version = manifest.match(/^version:\s*["']?([^\s"'#]+)["']?/m)?.[1];
    if (!version) {
      throw new Error("The macOS release manifest has no version.");
    }
    return { version };
  }

  async downloadUpdate() {
    if (!this.canInstallUpdate()) {
      return {
        success: false,
        error: "Automatic updates are not supported in this build.",
      };
    }
    if (!this.availableUpdate) {
      return { success: false, error: "No update is ready to download." };
    }
    if (this.downloadPromise) return this.downloadPromise;

    // From this point onward the user has consented. If the immediate restart is interrupted,
    // electron-updater may safely apply the verified download on the next normal app quit.
    this.updater.autoInstallOnAppQuit = true;
    this.downloadPromise = this.#performDownload();
    try {
      return await this.downloadPromise;
    } finally {
      this.downloadPromise = null;
    }
  }

  async #performDownload() {
    try {
      await this.updater.downloadUpdate();
      this.downloadedVersion = this.availableUpdate.version;
      return { success: true, version: this.downloadedVersion };
    } catch (error) {
      this.updater.autoInstallOnAppQuit = false;
      return {
        success: false,
        error: `Update download failed: ${errorMessage(error)}`,
      };
    }
  }

  installUpdate() {
    if (!this.downloadedVersion) return false;
    // NSIS receives /S so the approved update installs without another wizard; AppImage ignores
    // the silent flag. Force-run launches the newly installed version.
    this.updater.quitAndInstall(true, true);
    return true;
  }
}

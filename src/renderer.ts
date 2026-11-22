const classicText = window.UiLanguage.text;

type RunCommandReply = import('./types/ipc.ts').InvokeResult<'run-command'>;
type ClassicSubtitle = import('./types/ipc.ts').InvokeResult<'list-subtitles'>['subtitles'][number];
type LegacyCommandReply = RunCommandReply | string | null | undefined;

interface ClassicRunFields {
    url: string;
    action: string;
    formatCode: string;
    browser: string;
    downloadFolder: string;
}

type ClassicRunInputs = { ok: true; values: ClassicRunFields } | { ok: false; error: string };

interface ConversionDisplay {
    success: boolean;
    cancelled?: boolean;
    message?: string;
    text?: string;
    tmpFiles?: string[];
    error?: string;
}

interface ConfirmModalOptions {
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string | null;
}

interface UpdateModalOptions extends ConfirmModalOptions {
    version?: string;
    sectionTitle?: string;
    status?: string;
    currentVersion?: string;
    latestVersion?: string;
    notes?: string;
    secondaryText?: string | null;
}

type UpdateModalResult = boolean | 'confirm' | 'secondary' | 'cancel';

function classicElement<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing Classic control: ${id}`);
    return element as T;
}

function classicErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
        return error.message;
    }
    return String(error);
}

console.log('renderer.js loaded! window.electronAPI:', window.electronAPI);

let progressHandler: (() => void) | null = null;

// Cache the format list output from "List Formats" to detect audio-only formats
let cachedFormatList = '';

// Fetch format metadata for a single format code using yt-dlp --print
// Falls back to the cached format list if available to avoid an extra network call
async function fetchFormatMeta(formatCode: string, browser: string, url: string) {
    // Try cache first
    if (cachedFormatList) {
        const lines = cachedFormatList.split(/[\r\n]+/);
        for (const line of lines) {
            const trimmed = line.trim();
            const m = trimmed.match(/^(\S+)\s+(\S+)\s+(.+)/);
            if (m && m[1] === formatCode) {
                // Parse from cached -F table: ext is column 2, rest is the line
                const ext = m[2];
                const audioMatch = trimmed.match(/\|\s*audio only\s+(\S+)/i);
                const acodec = audioMatch ? audioMatch[1] : 'none';
                const vcodec = trimmed.includes('audio only') ? 'none' : 'video';
                return { ext, acodec, vcodec };
            }
        }
    }

    // Cache miss — use yt-dlp --print for a fast single-format lookup
    const args = [...getProxyArgs(), '-f', formatCode, '--print', '%(ext)s\t%(acodec)s\t%(vcodec)s', '--no-download'];
    if (browser) args.push('--cookies-from-browser', browser);
    args.push(url);

    const result = await window.electronAPI.getFormatInfo(args);
    if (!result.ok || !result.output) return null;

    const [ext = '', acodec = '', vcodec = ''] = result.output.split('\t');
    return { ext, acodec: acodec || 'none', vcodec: vcodec || 'none' };
}

// Detect audio-only webm formats and return the correct extraction format
async function getAudioOnlyWebmFormat(formatCode: string, browser: string, url: string) {
    if (!formatCode || formatCode.includes('+')) return null;
    const meta = await fetchFormatMeta(formatCode, browser, url);
    if (!meta) return null;
    if (meta.ext !== 'webm') return null;
    if (meta.acodec.startsWith('opus')) return 'opus';
    if (meta.acodec.startsWith('vorbis')) return 'vorbis';
    return null;
}

// Detect image/storyboard formats (mhtml) that don't support thumbnail embedding
async function isImageFormat(formatCode: string, browser: string, url: string) {
    if (!formatCode || formatCode.includes('+')) return false;
    const meta = await fetchFormatMeta(formatCode, browser, url);
    return meta?.ext === 'mhtml';
}

const { isProgressLine, isExtractorOrNoiseLine } = window.LogClassification;

// Function to clean yt-dlp output by removing progress lines and intermediate noise,
// keeping only the final progress line when progress lines are present
function cleanYtDlpResult(result: string) {
    if (!result) return result;

    const lines = result.split(/[\r\n]+/);
    const filteredLines = [];
    let lastProgressLine = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (isExtractorOrNoiseLine(trimmed)) {
            continue;
        }

        if (isProgressLine(trimmed)) {
            lastProgressLine = trimmed;
            continue;
        }

        if (lastProgressLine) {
            filteredLines.push(lastProgressLine);
            lastProgressLine = null;
        }
        filteredLines.push(trimmed);
    }

    if (lastProgressLine) {
        filteredLines.push(lastProgressLine);
    }

    return filteredLines.length > 0 ? filteredLines.join('\n') : result.trim();
}

// Build proxy args for yt-dlp if proxy is enabled
function getProxyArgs() {
    const proxyUrl = window.SharedContext.getProxyUrl();
    return proxyUrl ? ['--proxy', proxyUrl] : [];
}

window.chooseFolder = async function () {
    console.log('chooseFolder called! electronAPI:', window.electronAPI);
    if (!window.electronAPI) {
        alert('electronAPI is not defined!');
        return;
    }
    const folder = await window.electronAPI.chooseFolder();
    console.log('User chose folder:', folder);
    if (folder) {
        classicElement<HTMLInputElement>('downloadFolder').value = folder;
        // Persist the chosen folder immediately
        window.electronAPI.setSettings({ downloadFolder: folder }).catch(console.error);
    }
};

window.checkUpdate = async function () {
    const updateBtn = (document.getElementById('checkUpdateBtn') as HTMLButtonElement | null)
        || document.querySelector<HTMLButtonElement>('.update-button');
    const output = document.getElementById('output');

    if (updateBtn) {
        updateBtn.disabled = true;
        window.UiLanguage.label(updateBtn, 'checking');
    }

    const log = (msg: string) => {
        if (output) output.textContent += msg;
    };

    if (output) output.textContent = classicText('checkingUpdates') + '\n';

    let currentVersion = '';
    try {
        currentVersion = await window.electronAPI.getCurrentVersion();
        log(classicText('installedVersion', { version: currentVersion }) + '\n');

        const openReleasePage = async (url?: string) => {
            const targetUrl = url || 'https://github.com/Shawshank01/Vidbutler/releases/latest';
            if (window.electronAPI?.openExternal) {
                try {
                    const opened = await window.electronAPI.openExternal(targetUrl);
                    if (opened) return;
                } catch {
                    // Fall through to the browser API.
                }
            }
            window.open(targetUrl, '_blank');
        };

        const appUpdate = await window.electronAPI.checkAppUpdate();

        if (appUpdate.supported === false) {
            log('\n' + classicText('manualUpdate') + '\n');
            const openReleases = await showUpdateModal({
                title: 'VidButler',
                currentVersion,
                sectionTitle: classicText('updateStatus'),
                status: classicText('manualUpdate'),
                message: classicText('manualUpdateDetail'),
                confirmText: classicText('openReleases'),
                cancelText: classicText('close')
            });
            if (openReleases) await openReleasePage(appUpdate.releaseUrl);
            return;
        }

        if (appUpdate.error) {
            log('\n' + classicText('updateCheckError', { detail: appUpdate.message }));
            await showUpdateModal({
                title: 'VidButler',
                currentVersion,
                sectionTitle: classicText('updateStatus'),
                status: classicText('updateCheckFailed'),
                message: classicText('updateCheckError', { detail: appUpdate.message }),
                confirmText: classicText('ok'),
                cancelText: null
            });
        } else if (
            appUpdate.hasUpdate &&
            appUpdate.version &&
            appUpdate.version !== currentVersion
        ) {
            const stripHtml = (v?: string) => (v || '').replace(/<[^>]*>/g, '').trim();
            const cleanedNotes = stripHtml(appUpdate.releaseNotes);

            log('\n✅ ' + classicText('updateAvailable') + '\n');
            log(classicText('newVersion', { version: appUpdate.version }) + '\n');
            if (cleanedNotes) {
                log(`${classicText('releaseNotes')}\n${cleanedNotes}\n`);
            }

            if (appUpdate.updateMethod === 'homebrew') {
                const command =
                    appUpdate.updateCommand ||
                    'brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler';
                const action = await showUpdateModal({
                    title: 'VidButler',
                    currentVersion,
                    latestVersion: appUpdate.version,
                    sectionTitle: classicText('updateAvailable'),
                    status: '🎉 ' + classicText('updateAvailable'),
                    notes: cleanedNotes,
                    message: classicText('homebrewUpdate', { command }),
                    confirmText: classicText('copyHomebrew'),
                    secondaryText: classicText('openGitHubRelease'),
                    cancelText: classicText('later')
                });

                if (action === 'confirm') {
                    await window.electronAPI.copyMacUpdateCommand();
                    log(classicText('commandCopied') + '\n');
                    await showUpdateModal({
                        title: 'VidButler',
                        currentVersion,
                        latestVersion: appUpdate.version,
                        sectionTitle: classicText('updateAvailable'),
                        status: classicText('commandCopied'),
                        message: classicText('pasteCommand'),
                        confirmText: classicText('ok'),
                        cancelText: null
                    });
                } else if (action === 'secondary') {
                    await openReleasePage(appUpdate.releaseUrl);
                }
                return;
            }

            const installNow = await showUpdateModal({
                title: 'VidButler',
                currentVersion,
                latestVersion: appUpdate.version,
                sectionTitle: classicText('updateAvailable'),
                status: '🎉 ' + classicText('updateAvailable'),
                notes: cleanedNotes,
                message:
                    classicText('installUpdate'),
                confirmText: classicText('downloadRestart'),
                cancelText: classicText('later')
            });

            if (installNow) {
                if (updateBtn) window.UiLanguage.label(updateBtn, 'downloading');
                let lastReportedPercent = -10;
                const removeProgressListener = window.electronAPI.onUpdateProgress((progress) => {
                    const percent = Math.floor(Number(progress?.percent) || 0);
                    if (percent >= lastReportedPercent + 10 || percent === 100) {
                        lastReportedPercent = percent;
                        log(classicText('updateProgress', { percent }) + '\n');
                    }
                });

                try {
                    const download = await window.electronAPI.downloadAppUpdate();
                    if (!download.success) {
                        log(`\n${classicText('updateDownloadFailed')}\n${download.error}\n`);
                        await showUpdateModal({
                            title: 'VidButler',
                            currentVersion,
                            latestVersion: appUpdate.version,
                            sectionTitle: classicText('updateStatus'),
                            status: classicText('updateFailed'),
                            message: download.error,
                            confirmText: classicText('ok'),
                            cancelText: null
                        });
                    } else {
                        log('\n' + classicText('updateRestarting') + '\n');
                        const installing = await window.electronAPI.installAppUpdate();
                        if (!installing) throw new Error(classicText('updateNotReady'));
                    }
                } finally {
                    removeProgressListener();
                }
            }
        } else {
            log('\n✅ ' + classicText('upToDate'));
            await showUpdateModal({
                title: 'VidButler',
                currentVersion,
                latestVersion: currentVersion,
                sectionTitle: classicText('updateStatus'),
                status: '✅ ' + classicText('upToDate'),
                confirmText: classicText('ok'),
                cancelText: null
            });
        }
    } catch (error) {
        log('\n' + classicText('errorDetail', { detail: classicErrorMessage(error) }));
        await showUpdateModal({
            title: 'VidButler',
            currentVersion: currentVersion || '',
            sectionTitle: classicText('updateStatus'),
            status: classicText('updateCheckFailed'),
            message: classicText('updateCheckError', { detail: classicErrorMessage(error) }),
            confirmText: classicText('ok'),
            cancelText: null
        });
    } finally {
        if (updateBtn) {
            updateBtn.disabled = false;
            window.UiLanguage.label(updateBtn, 'checkUpdates');
        }
    }
};

// Validate form inputs before running any action
function validateRunInputs(): ClassicRunInputs {
    const url = classicElement<HTMLInputElement>('url').value.trim();
    const action = classicElement<HTMLSelectElement>('action').value;
    const formatCode = classicElement<HTMLInputElement>('formatCode').value.trim();
    const browser = classicElement<HTMLSelectElement>('browser').value.trim();
    const downloadFolder = classicElement<HTMLInputElement>('downloadFolder').value.trim();

    if (!url) {
        return { ok: false, error: classicText('missingVideoUrl') };
    }
    if (!['', 'brave', 'chrome', 'firefox', 'safari'].includes(browser)) {
        return { ok: false, error: classicText('invalidBrowser') };
    }
    if (!downloadFolder && action !== 'List Formats' && action !== 'Download Subtitles') {
        return { ok: false, error: classicText('missingFolder') };
    }
    if (action === 'Download (Custom Format)' && !formatCode) {
        return {
            ok: false,
            error: classicText('missingFormat')
        };
    }

    return {
        ok: true,
        values: { url, action, formatCode, browser, downloadFolder }
    };
}

// Build yt-dlp CLI arguments for the chosen action
async function buildActionArgs(action: string, { url, browser, downloadFolder, formatCode }: Omit<ClassicRunFields, 'action'>) {
    const args = [...getProxyArgs(), '--remote-components', 'ejs:github'];
    if (browser) {
        args.push('--cookies-from-browser', browser);
    }

    switch (action) {
        case 'Download Video (Best Quality)':
            args.push('--embed-thumbnail', '-P', downloadFolder, url);
            break;
        case 'List Formats':
            args.push('-F', url);
            break;
        case 'Download (Custom Format)':
            args.push('-f', formatCode);
            if (!cachedFormatList) {
                classicElement('output').textContent =
                    classicText('detectingFormat');
            }
            if (!await isImageFormat(formatCode, browser, url)) {
                const audioFmt = await getAudioOnlyWebmFormat(formatCode, browser, url);
                if (audioFmt) {
                    args.push('-x', '--audio-format', audioFmt);
                }
                args.push('--embed-thumbnail');
            }
            args.push('-P', downloadFolder, url);
            break;
        case 'Download Thumbnail':
            args.push('--write-thumbnail', '--skip-download', '-P', downloadFolder, url);
            break;
        case 'Download & Re-encode as high quality MP4 (H.264/AAC)':
            args.push('--write-thumbnail', '--convert-thumbnails', 'jpg', '-P', downloadFolder, url);
            break;
        default:
            args.push('--embed-thumbnail', '-P', downloadFolder, url);
            break;
    }
    return args;
}

// Manage cancel button UI state without cloning DOM nodes
function showCancelButton(onCancel: (() => void | Promise<void>) | null = null) {
    const cancelActionControls = document.getElementById('cancelActionControls');
    const cancelActionBtn = document.getElementById('cancelActionBtn') as HTMLButtonElement | null;
    if (!cancelActionControls || !cancelActionBtn) return;

    cancelActionControls.style.display = 'block';
    cancelActionBtn.disabled = false;
    window.UiLanguage.label(cancelActionBtn, 'cancelAction');

    cancelActionBtn.onclick = async () => {
        cancelActionBtn.disabled = true;
        window.UiLanguage.label(cancelActionBtn, 'cancelling');
        if (onCancel) {
            await onCancel();
        } else {
            await window.electronAPI.cancelCommand();
        }
    };
}

function hideCancelButton() {
    const cancelActionControls = document.getElementById('cancelActionControls');
    const cancelActionBtn = document.getElementById('cancelActionBtn') as HTMLButtonElement | null;
    if (cancelActionControls) cancelActionControls.style.display = 'none';
    if (cancelActionBtn) {
        cancelActionBtn.onclick = null;
        cancelActionBtn.disabled = false;
        window.UiLanguage.label(cancelActionBtn, 'cancelAction');
    }
}

// Classic mode progress bar from yt-dlp or ffmpeg stdout/stderr lines
function updateDownloadProgress(text: string, encodingTitle = 'encodingProgress') {
    const container = document.getElementById('classicProgressBarContainer');
    if (!container || !text) return;

    // Matches both yt-dlp download progress format and ffmpeg progress format:
    // e.g.: [download]  45.2% of ~145.2MiB at 32.4MiB/s ETA 00:03
    // e.g.: [ffmpeg] 45.2% of ~03:45 (01:42) at 2.4x (26KiB) ETA 00:32
    const match = text.match(/\[(download|ffmpeg)\]\s+([\d.]+)%(?:\s+of\s+([^\s]+))?(?:\s+\(([^)]+)\))?(?:\s+at\s+([^\s]+))?(?:\s+\(([^)]+)\))?(?:\s+ETA\s+([^\s\r\n]+))?/i);
    if (match) {
        container.style.display = 'block';
        const type = (match[1] || 'download').toLowerCase();
        const pct = parseFloat(match[2]);
        const sizeOrDur = match[3] || '';
        const processedTime = match[4] || '';
        const speed = match[5] || '';
        const sizeFallback = match[6] || '';
        const eta = match[7] || '';

        const titleEl = document.getElementById('classicProgressTitle');
        const fill = document.getElementById('classicProgressBarFill');
        const percentEl = document.getElementById('classicProgressPercent');
        const statusEl = document.getElementById('classicProgressStatus');
        const etaEl = document.getElementById('classicProgressEta');

        if (titleEl) window.UiLanguage.label(titleEl, type === 'ffmpeg' ? encodingTitle : 'downloadProgress');

        if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
        if (percentEl) percentEl.textContent = pct.toFixed(1) + '%';
        if (statusEl) {
            let statusText = '';
            if (processedTime && sizeOrDur) {
                statusText = `${processedTime} / ${sizeOrDur.replace(/^~/, '')}`;
            } else if (sizeOrDur) {
                statusText = sizeOrDur;
            }
            if (sizeFallback && !statusText.includes(sizeFallback)) {
                statusText += (statusText ? ' • ' : '') + sizeFallback;
            }
            if (speed) {
                statusText += (statusText ? ' • ' : '') + speed;
            }
            statusEl.textContent = statusText;
        }
        if (etaEl) {
            etaEl.textContent = eta ? classicText('eta', { time: eta }) : '';
        }
    }
}

function resetDownloadProgress() {
    const container = document.getElementById('classicProgressBarContainer');
    if (container) {
        container.style.display = 'none';
        const fill = document.getElementById('classicProgressBarFill');
        if (fill) fill.style.width = '0%';
        const percentEl = document.getElementById('classicProgressPercent');
        if (percentEl) percentEl.textContent = '0%';
        const statusEl = document.getElementById('classicProgressStatus');
        if (statusEl) statusEl.textContent = '';
        const etaEl = document.getElementById('classicProgressEta');
        if (etaEl) etaEl.textContent = '';
        const titleEl = document.getElementById('classicProgressTitle');
        if (titleEl) window.UiLanguage.label(titleEl, 'downloadProgress');
    }
}

// Render status banner with CSS classes
function renderStatusBanner(status: 'success' | 'error' | 'cancelled', message: string) {
    const outputElement = document.getElementById('output');
    if (!outputElement) return;

    const banner = document.createElement('div');
    banner.className = `completion-hint ${status}`;
    banner.textContent = message;
    outputElement.appendChild(banner);
}

// Extract video ID from URL supporting YouTube, TikTok, Twitter/X, Instagram, Bilibili, Reddit, and generic platforms
function extractVideoId(url: string) {
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname.toLowerCase();
        const path = urlObj.pathname;

        // 1. YouTube
        if (host.includes('youtube.com') || host.includes('youtu.be')) {
            if (path.includes('/shorts/')) {
                const id = path.split('/shorts/')[1];
                return id ? id.split('/')[0].split('?')[0] : '';
            }
            if (path.includes('/embed/')) {
                const id = path.split('/embed/')[1];
                return id ? id.split('/')[0].split('?')[0] : '';
            }
            if (path.includes('/live/')) {
                const id = path.split('/live/')[1];
                return id ? id.split('/')[0].split('?')[0] : '';
            }
            if (path.includes('/watch')) {
                return urlObj.searchParams.get('v') || '';
            }
            if (host.includes('youtu.be')) {
                return path.substring(1).split('/')[0].split('?')[0];
            }
        }

        // 2. Twitter / X (e.g., https://x.com/user/status/1234567890)
        if (host.includes('twitter.com') || host.includes('x.com')) {
            const m = path.match(/status(?:es)?\/(\d+)/i);
            if (m) return m[1];
        }

        // 3. TikTok (e.g., https://www.tiktok.com/@user/video/1234567890)
        if (host.includes('tiktok.com')) {
            const m = path.match(/(?:video|v)\/(\d+)/i);
            if (m) return m[1];
        }

        // 4. Instagram (e.g., https://www.instagram.com/reel/C12345/)
        if (host.includes('instagram.com')) {
            const m = path.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
            if (m) return m[1];
        }

        // 5. Bilibili (e.g., https://www.bilibili.com/video/BV1xx411c7mD)
        if (host.includes('bilibili.com')) {
            const m = path.match(/(BV[a-zA-Z0-9]+|av\d+)/i);
            if (m) return m[1];
        }

        // 6. Reddit (e.g., https://www.reddit.com/r/videos/comments/abc123/title/)
        if (host.includes('reddit.com')) {
            const m = path.match(/\/comments\/([a-z0-9]+)/i);
            if (m) return m[1];
        }

        // 7. Vimeo (e.g., https://vimeo.com/123456789)
        if (host.includes('vimeo.com')) {
            const m = path.match(/\/(\d+)/);
            if (m) return m[1];
        }

        // 8. Facebook (e.g., https://www.facebook.com/watch/?v=123456)
        if (host.includes('facebook.com')) {
            if (urlObj.searchParams.has('v')) return urlObj.searchParams.get('v');
            const m = path.match(/(?:reel|videos)\/(\d+)/i);
            if (m) return m[1];
        }

        // 9. Generic query param search
        for (const param of ['v', 'id', 'video_id', 'item_id']) {
            const val = urlObj.searchParams.get(param);
            if (val) return val;
        }

        // 10. Generic last path segment fallback
        const segments = path.split('/').filter(Boolean);
        if (segments.length > 0) {
            return segments[segments.length - 1].split('.')[0];
        }

        return '';
    } catch {
        return '';
    }
}

// Extract downloaded video destination path from yt-dlp stdout lines
function extractDownloadedPath(text: string) {
    if (!text) return null;
    const lines = text.split(/[\r\n]+/);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        const mergeMatch = line.match(/^\[Merger\] Merging formats into ["']?(.+?)["']?$/i);
        if (mergeMatch) return mergeMatch[1].trim();

        const alreadyMatch = line.match(/^\[download\]\s+["']?(.+?)["']?\s+has already been downloaded/i);
        if (alreadyMatch) return alreadyMatch[1].trim();

        const destMatch = line.match(/^\[(?:download|ExtractAudio)\] Destination:\s+["']?(.+?)["']?$/i);
        if (destMatch) return destMatch[1].trim();
    }
    return null;
}

// Handle format list result and automatically transition UI
function handleFormatListSelection(result: string, isCancelled: boolean, isError: boolean) {
    cachedFormatList = result || '';
    if (!isCancelled && !isError) {
        const actionSelect = document.getElementById('action') as HTMLSelectElement | null;
        if (actionSelect) {
            actionSelect.value = 'Download (Custom Format)';
            updateFormatCodeVisibility();
            actionSelect.dispatchEvent(new Event('change'));
            const formatCodeInput = document.getElementById('formatCode') as HTMLInputElement | null;
            if (formatCodeInput) {
                formatCodeInput.focus();
            }
        }
    }
}

// URLs for macOS Files & Folders privacy settings pane
const MAC_PRIVACY_FILES_AND_FOLDERS_URL =
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders';
const MAC_PRIVACY_FILES_AND_FOLDERS_LEGACY_URL =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';

// Check if running on macOS
function isMacOS() {
    return (
        window.electronAPI?.platform === 'darwin' ||
        (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent))
    );
}

// Check if an error message/output represents a macOS cookie permission failure
function isCookiePermissionError(errorMessage?: unknown, outputText?: unknown) {
    const text = `${errorMessage || ''}\n${outputText || ''}`;
    return (
        /could not find [a-z0-9_-]+ cookies database/i.test(text) ||
        (/cookies/i.test(text) && (/operation not permitted/i.test(text) || /permission denied/i.test(text)))
    );
}

// Open macOS Files & Folders settings via shell.openExternal
async function openFilesAndFoldersSettings() {
    if (window.electronAPI?.openFilesAndFoldersSettings) {
        await window.electronAPI.openFilesAndFoldersSettings();
    } else if (window.electronAPI?.openExternal) {
        const opened = await window.electronAPI.openExternal(MAC_PRIVACY_FILES_AND_FOLDERS_URL);
        if (!opened) {
            await window.electronAPI.openExternal(MAC_PRIVACY_FILES_AND_FOLDERS_LEGACY_URL);
        }
    }
}

// Handle cookie permission error on macOS by displaying an in-app confirmation dialog
async function handleCookiePermissionError(browserName: string) {
    if (!isMacOS()) return false;

    const browserLabel = browserName
        ? browserName.charAt(0).toUpperCase() + browserName.slice(1)
        : 'browser';

    const confirmed = await showConfirmModal({
        title: classicText('cookiePermission'),
        message: classicText('cookiePermissionDetail', { browser: browserLabel }),
        confirmText: classicText('openSystemSettings'),
        cancelText: classicText('cancel')
    });

    if (confirmed) {
        await openFilesAndFoldersSettings();
    }
    return true;
}

// Handle optional re-encode workflow following download
async function handleReEncodePrompt({ url, downloadFolder, commandLine, cleanResult }: Pick<ClassicRunFields, 'url' | 'downloadFolder'> & { commandLine: string; cleanResult: string }) {
    const shouldReEncode = await showConfirmModal({
        title: classicText('reencodeTitle'),
        message: classicText('reencodeDetail'),
        confirmText: classicText('reencode'),
        cancelText: classicText('skip')
    });

    if (!shouldReEncode) {
        classicElement('output').textContent +=
            '\n\n' + classicText('reencodeSkipped');
        return;
    }

    classicElement('output').textContent +=
        '\n\n' + classicText('reencoding') + '\n';

    // Prefer exact downloaded file path from yt-dlp output, or fall back to extracted video ID
    const downloadedPath = extractDownloadedPath(cleanResult);
    const targetIdentifier = downloadedPath || extractVideoId(url);

    if (!targetIdentifier) {
        classicElement('output').textContent +=
            classicText('videoNotFound');
        return;
    }

    showCancelButton();
    resetDownloadProgress();
    const titleEl = document.getElementById('classicProgressTitle');
    if (titleEl) window.UiLanguage.label(titleEl, 'reencodingProgress');

    try {
        const reEncodeResult = await window.electronAPI.reEncodeToMp4(downloadFolder, targetIdentifier) as ConversionDisplay | string;
        const res: ConversionDisplay = typeof reEncodeResult === 'string'
            ? (() => { try { return JSON.parse(reEncodeResult); } catch { return { success: false, message: reEncodeResult, tmpFiles: [] }; } })()
            : reEncodeResult;

        const messageText = res.message || res.text || '';
        classicElement('output').textContent =
            commandLine + '\n' + cleanResult + '\n' + messageText;

        if (res.tmpFiles && res.tmpFiles.length > 0) {
            const shouldDelete = await showCleanupModal(
                classicText('cleanupEncode')
            );
            if (shouldDelete) {
                await window.electronAPI.deleteTemporaryFiles(res.tmpFiles);
                classicElement('output').textContent += '\n\n' + classicText('temporaryFilesDeleted');
            }
        }

        if (res.cancelled) {
            renderStatusBanner('cancelled', '❌ ' + classicText('encodeCancelled'));
            resetDownloadProgress();
        } else if (res.success) {
            renderStatusBanner('success', '✅ ' + classicText('encodeDone'));
            const fill = document.getElementById('classicProgressBarFill');
            if (fill) fill.style.width = '100%';
            const percentEl = document.getElementById('classicProgressPercent');
            if (percentEl) percentEl.textContent = '100%';
        } else {
            renderStatusBanner('error', '❌ ' + classicText('encodeFailed'));
            resetDownloadProgress();
        }
    } catch (reEncodeError) {
        classicElement('output').textContent +=
            '\n' + classicText('encodeError', { detail: classicErrorMessage(reEncodeError) });
        renderStatusBanner('error', '❌ ' + classicText('encodeFailed'));
        resetDownloadProgress();
    } finally {
        hideCancelButton();
    }
}

window.runCommand = async function () {
    const validation = validateRunInputs();
    if (!validation.ok) {
        classicElement('output').textContent = validation.error;
        return;
    }

    const { url, action, formatCode, browser, downloadFolder } = validation.values;

    if (action === 'Download Subtitles') {
        await handleSubtitleDownload(url, browser, downloadFolder);
        return;
    }
    if (action === 'Download & Add Hardsub') {
        await handleHardsubAction(url, browser, downloadFolder);
        return;
    }

    if (progressHandler) {
        progressHandler();
    }

    const args = await buildActionArgs(action, { url, browser, downloadFolder, formatCode });
    const commandLine = classicText('runningCommand') + ' yt-dlp ' + args.join(' ');
    const outputElement = classicElement('output');

    progressHandler = window.electronAPI.onProgress((progress) => {
        outputElement.textContent = commandLine + '\n' + progress;
        updateDownloadProgress(progress);
    });

    outputElement.textContent = commandLine + '\n';
    console.log('Running command:', args);

    resetDownloadProgress();
    showCancelButton();

    try {
        const rawResult = await window.electronAPI.runCommand(args) as LegacyCommandReply;
        const res = typeof rawResult === 'object' && rawResult !== null
            ? rawResult
            : {
                success: !(rawResult || '').includes('Process exited with code') &&
                    !(rawResult || '').includes('ERROR:') &&
                    !(rawResult || '').startsWith('Error:'),
                cancelled: (rawResult || '').includes('cancelled by user'),
                output: rawResult || '',
                error: (rawResult || '').includes('ERROR:') ? rawResult : ''
            };

        const resultOutput = res.output || '';
        const cleanResult = action === 'List Formats' ? resultOutput.trim() : cleanYtDlpResult(resultOutput);
        outputElement.textContent = commandLine + '\n' + cleanResult;

        const isCancelled = res.cancelled;
        const isError = !res.success && !isCancelled;

        if (action === 'List Formats') {
            handleFormatListSelection(resultOutput, isCancelled, isError);
        } else if (
            action === 'Download & Re-encode as high quality MP4 (H.264/AAC)' &&
            downloadFolder &&
            !isCancelled &&
            !isError
        ) {
            await handleReEncodePrompt({ url, downloadFolder, commandLine, cleanResult });
        }

        if (isError && isCookiePermissionError(res.error, res.output)) {
            renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
            await handleCookiePermissionError(browser);
        } else if (action !== 'List Formats') {
            if (isCancelled) {
                renderStatusBanner('cancelled', '❌ ' + classicText('downloadCancelled'));
                resetDownloadProgress();
            } else if (isError) {
                renderStatusBanner('error', '❌ ' + classicText('downloadFailed'));
                resetDownloadProgress();
            } else {
                renderStatusBanner('success', '✅ ' + classicText('downloadDone'));
                const fill = document.getElementById('classicProgressBarFill');
                if (fill && fill.style.width !== '0%') {
                    fill.style.width = '100%';
                    const percentEl = document.getElementById('classicProgressPercent');
                    if (percentEl) percentEl.textContent = '100%';
                }
            }
        }
    } catch (e) {
        outputElement.textContent += '\n' + classicText('errorDetail', { detail: classicErrorMessage(e) });
        resetDownloadProgress();
        if (isCookiePermissionError(classicErrorMessage(e), '')) {
            renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
            await handleCookiePermissionError(browser);
        } else if (action !== 'List Formats') {
            renderStatusBanner('error', '❌ ' + classicText('downloadFailed'));
        }
    } finally {
        hideCancelButton();
    }
};

// Show/hide Format Code field depending on action
function updateFormatCodeVisibility() {
    const action = classicElement<HTMLSelectElement>('action').value;
    const formatGroup = document.getElementById('formatCodeGroup');
    const codecGroup = document.getElementById('codecGroup');
    const subtitlePositionGroup = document.getElementById('subtitlePositionGroup');

    if (formatGroup) {
        formatGroup.style.display = action === 'Download (Custom Format)' ? '' : 'none';
    }
    const isHardsub = action === 'Download & Add Hardsub';
    if (codecGroup) {
        codecGroup.style.display = isHardsub ? '' : 'none';
    }
    if (subtitlePositionGroup) {
        subtitlePositionGroup.style.display = isHardsub ? '' : 'none';
    }
}

// Handle subtitle download workflow
async function handleSubtitleDownload(url: string, browser: string, downloadFolder: string) {
    const output = classicElement('output');

    if (!downloadFolder) {
        output.textContent = classicText('missingFolder');
        return;
    }

    output.textContent = classicText('fetchingSubtitles');

    try {
        const proxyUrl = window.SharedContext.getProxyUrl();
        const result = await window.electronAPI.listSubtitles(url, browser, proxyUrl);

        if (result.error) {
            output.textContent = classicText('listSubtitlesError', { detail: result.message });
            if (isCookiePermissionError(result.message)) {
                renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
                await handleCookiePermissionError(browser);
            }
            return;
        }

        if (!result.subtitles || result.subtitles.length === 0) {
            output.textContent = classicText('noSubtitles');
            return;
        }

        const selectedSubtitle = await showSubtitleModal(result.subtitles, result.isAutoGenerated);
        if (!selectedSubtitle) {
            output.textContent = classicText('subtitleDownloadCancelled');
            return;
        }

        output.textContent = classicText('downloadingSubtitle', { name: selectedSubtitle.name, code: selectedSubtitle.code });

        const args = [...getProxyArgs(), '--remote-components', 'ejs:github'];
        if (browser) {
            args.push('--cookies-from-browser', browser);
        }
        const subsFlag = selectedSubtitle.type === 'manual' ? '--write-subs' : '--write-auto-subs';
        args.push(
            subsFlag,
            '--sub-langs', selectedSubtitle.code,
            '--skip-download',
            '--convert-subs', 'vtt',
            '-P', downloadFolder,
            url
        );

        const commandLine = classicText('runningCommand') + ' yt-dlp ' + args.join(' ');
        output.textContent = commandLine + '\n';

        if (progressHandler) {
            progressHandler();
        }

        progressHandler = window.electronAPI.onProgress((progress) => {
            output.textContent = commandLine + '\n' + progress;
        });

        showCancelButton();

        try {
            const rawCmdResult = await window.electronAPI.runCommand(args) as LegacyCommandReply;
            const res: Pick<RunCommandReply, 'success' | 'cancelled' | 'output'> & { error?: string } = typeof rawCmdResult === 'object' && rawCmdResult !== null
                ? rawCmdResult
                : {
                    success: !(rawCmdResult || '').includes('Process exited with code') && !(rawCmdResult || '').includes('ERROR:'),
                    cancelled: (rawCmdResult || '').includes('cancelled by user'),
                    output: rawCmdResult || ''
                };

            const cleanResult = cleanYtDlpResult(res.output);

            if (res.cancelled) {
                output.textContent = classicText('subtitleDownloadCancelled');
                renderStatusBanner('cancelled', '❌ ' + classicText('downloadCancelled'));
            } else if (!res.success && (res.output || '').includes('There are no subtitles for the requested languages')) {
                output.textContent = classicText('noSubtitles');
                renderStatusBanner('error', '❌ ' + classicText('noSubtitles'));
            } else if (!res.success) {
                output.textContent = `${commandLine}\n${res.error || res.output || classicText('subtitleDownloadFailed')}`;
                if (isCookiePermissionError(res.error, res.output)) {
                    renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
                    await handleCookiePermissionError(browser);
                } else {
                    renderStatusBanner('error', '❌ ' + classicText('downloadFailed'));
                }
            } else {
                output.textContent = cleanResult
                    ? `${commandLine}\n${cleanResult}`
                    : `${commandLine}\nLanguage: ${selectedSubtitle.name} (${selectedSubtitle.code})\nFolder: ${downloadFolder}`;
                renderStatusBanner('success', '✅ ' + classicText('subtitleDownloaded', { name: selectedSubtitle.name, code: selectedSubtitle.code }));
            }
        } finally {
            hideCancelButton();
        }
    } catch (error) {
        output.textContent = classicText('errorDetail', { detail: classicErrorMessage(error) });
        if (isCookiePermissionError(classicErrorMessage(error))) {
            renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
            await handleCookiePermissionError(browser);
        } else {
            renderStatusBanner('error', '❌ ' + classicText('downloadFailed'));
        }
    }
}

// Handle hardsub action workflow
async function handleHardsubAction(url: string, browser: string, downloadFolder: string) {
    const output = classicElement('output');
    const codec = classicElement<HTMLSelectElement>('codec').value;
    const subtitlePosition = (document.getElementById('subtitlePosition') as HTMLSelectElement | null)?.value || 'bottom';

    if (!downloadFolder) {
        output.textContent = classicText('missingFolder');
        return;
    }

    if (progressHandler) {
        progressHandler();
    }

    progressHandler = window.electronAPI.onProgress((progress) => {
        output.textContent = progress;
        updateDownloadProgress(progress, 'hardsubProgress');
    });

    output.textContent = classicText('fetchingSubtitles');

    try {
        const proxyUrl = window.SharedContext.getProxyUrl();
        const result = await window.electronAPI.listSubtitles(url, browser, proxyUrl);

        if (result.error) {
            output.textContent = classicText('listSubtitlesError', { detail: result.message });
            if (isCookiePermissionError(result.message)) {
                renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
                await handleCookiePermissionError(browser);
            }
            return;
        }

        if (!result.subtitles || result.subtitles.length === 0) {
            output.textContent = classicText('noSubtitles');
            return;
        }

        const selectedSubtitle = await showSubtitleModal(result.subtitles, result.isAutoGenerated);
        if (!selectedSubtitle) {
            output.textContent = classicText('subtitleSelectionCancelled');
            return;
        }

        output.textContent = classicText('subtitleSelected', { name: selectedSubtitle.name, code: selectedSubtitle.code });
        showCancelButton();
        resetDownloadProgress();

        try {
            const rawHardsubResult = await window.electronAPI.downloadWithHardsub({
                url,
                browser,
                downloadFolder,
                subtitleLang: selectedSubtitle.code,
                subtitleType: selectedSubtitle.type,
                codec,
                subtitlePosition,
                proxy: proxyUrl
            }) as ConversionDisplay | string;

            const res: ConversionDisplay = typeof rawHardsubResult === 'object' && rawHardsubResult !== null
                ? rawHardsubResult
                : (() => {
                    try {
                        return JSON.parse(rawHardsubResult);
                    } catch {
                        return {
                            success: (rawHardsubResult || '').includes('completed') || (rawHardsubResult || '').includes('Saved as'),
                            cancelled: (rawHardsubResult || '').includes('cancelled by user'),
                            message: rawHardsubResult || '',
                            tmpFiles: []
                        };
                    }
                })();

            const messageText = res.message || res.text || '';
            output.textContent = messageText;

            if (res.tmpFiles && res.tmpFiles.length > 0) {
                const shouldDelete = await showCleanupModal(
                    classicText('cleanupHardsub')
                );
                if (shouldDelete) {
                    await window.electronAPI.deleteTemporaryFiles(res.tmpFiles);
                }
            }

            if (res.cancelled) {
                renderStatusBanner('cancelled', '❌ ' + classicText('hardsubCancelled'));
                resetDownloadProgress();
            } else if (res.success) {
                renderStatusBanner('success', '✅ ' + classicText('hardsubDone'));
                const fill = document.getElementById('classicProgressBarFill');
                if (fill) fill.style.width = '100%';
                const percentEl = document.getElementById('classicProgressPercent');
                if (percentEl) percentEl.textContent = '100%';
            } else {
                if (isCookiePermissionError(res.message, res.error)) {
                    renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
                    await handleCookiePermissionError(browser);
                } else {
                    renderStatusBanner('error', '❌ ' + classicText('hardsubFailed'));
                }
                resetDownloadProgress();
            }
        } finally {
            hideCancelButton();
        }
    } catch (error) {
        const message = classicErrorMessage(error);
        if ((error && typeof error === 'object' && 'cancelled' in error && error.cancelled) || message.includes('cancelled by user')) {
            output.textContent = classicText('actionCancelled');
            renderStatusBanner('cancelled', '❌ ' + classicText('hardsubCancelled'));
        } else {
            output.textContent = classicText('errorDetail', { detail: classicErrorMessage(error) });
            if (isCookiePermissionError(classicErrorMessage(error))) {
                renderStatusBanner('error', '❌ ' + classicText('cookiePermissionStatus'));
                await handleCookiePermissionError(browser);
            } else {
                renderStatusBanner('error', '❌ ' + classicText('hardsubFailed'));
            }
        }
        resetDownloadProgress();
    }
}

// Show subtitle selection modal and return selected subtitle
function showSubtitleModal(subtitles: ClassicSubtitle[], isAutoGenerated = false) {
    return new Promise<ClassicSubtitle | null>((resolve) => {
        const modal = classicElement('subtitleModal');
        const subtitleList = classicElement('subtitleList');
        const cancelBtn = classicElement('cancelSubtitleBtn');

        // Clear previous list
        subtitleList.replaceChildren();

        // Add warning banner if auto-translated
        if (isAutoGenerated) {
            const warning = document.createElement('div');
            warning.style.padding = '10px';
            warning.style.marginBottom = '10px';
            warning.style.backgroundColor = '#fff3cd';
            warning.style.border = '1px solid #ffc107';
            warning.style.borderRadius = '4px';
            warning.style.color = '#856404';
            const title = document.createElement('strong');
            title.textContent = classicText('autoSubtitles');
            warning.append('ℹ️ ', title, document.createElement('br'), classicText('autoSubtitlesDetail'));
            subtitleList.appendChild(warning);
        }

        // Populate subtitle list
        subtitles.forEach((sub) => {
            const item = document.createElement('div');
            item.className = 'subtitle-item';
            item.textContent = `${sub.name} (${sub.code})`;
            item.addEventListener('click', () => {
                modal.style.display = 'none';
                resolve(sub);
            });
            subtitleList.appendChild(item);
        });

        // Handle cancel
        const handleCancel = () => {
            modal.style.display = 'none';
            resolve(null);
        };

        cancelBtn.onclick = handleCancel;

        // Show modal
        modal.style.display = 'flex';
    });
}

// Initialise and bind change handler
document.addEventListener('DOMContentLoaded', async () => {
    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    if (chooseFolderBtn) chooseFolderBtn.addEventListener('click', () => window.chooseFolder());

    const runCommandBtn = document.getElementById('runCommandBtn');
    if (runCommandBtn) runCommandBtn.addEventListener('click', () => window.runCommand());

    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    if (checkUpdateBtn) checkUpdateBtn.addEventListener('click', () => window.checkUpdate());

    const actionSelect = document.getElementById('action') as HTMLSelectElement | null;
    if (actionSelect) {
        actionSelect.addEventListener('change', updateFormatCodeVisibility);
        updateFormatCodeVisibility();
    }

    const proxyToggle = document.getElementById('proxyEnabled') as HTMLInputElement | null;
    const proxyType = document.getElementById('proxyType') as HTMLSelectElement | null;
    const proxyInput = document.getElementById('proxyAddress') as HTMLTextAreaElement | null;

    // Restore persisted user settings
    let saved: Record<string, unknown> = {};
    if (window.electronAPI?.getSettings) {
        try {
            saved = await window.electronAPI.getSettings();

            // Browser for Cookies
            const browserEl = document.getElementById('browser') as HTMLSelectElement | null;
            if (browserEl && typeof saved.browser === 'string') {
                browserEl.value = saved.browser;
            }

            // Download folder
            const folderEl = document.getElementById('downloadFolder') as HTMLInputElement | null;
            if (folderEl && typeof saved.downloadFolder === 'string' && saved.downloadFolder) {
                folderEl.value = saved.downloadFolder;
            }

            if (proxyToggle && typeof saved.proxyEnabled === 'boolean') {
                proxyToggle.checked = saved.proxyEnabled;
            }
            if (proxyType) proxyType.value = saved.proxyType === 'http' ? 'http' : 'socks5';
            if (proxyInput && typeof saved.proxyAddress === 'string') {
                proxyInput.value = saved.proxyAddress.replace(/[\r\n]/g, '');
            }

            // Subtitle Position
            const subtitlePosSaved = document.getElementById('subtitlePosition') as HTMLSelectElement | null;
            if (subtitlePosSaved && typeof saved.subtitlePosition === 'string') {
                subtitlePosSaved.value = saved.subtitlePosition;
            }
        } catch (e) {
            console.warn('Could not load saved settings:', e);
        }
    }

    window.UiLanguage.restore(saved);

    // Update UI when download folder is set by the main process (e.g. first-run prompt)
    window.electronAPI?.onDownloadFolderUpdated?.((folder) => {
        const folderEl = document.getElementById('downloadFolder') as HTMLInputElement | null;
        if (folderEl && folder) {
            folderEl.value = folder;
        }
    });

    // Persist settings on change
    const browserEl = document.getElementById('browser') as HTMLSelectElement | null;
    if (browserEl) {
        browserEl.addEventListener('change', () => {
            window.electronAPI?.setSettings({ browser: browserEl.value }).catch(console.error);
        });
    }

    // Subtitle Position persistence
    const subtitlePosEl = document.getElementById('subtitlePosition') as HTMLSelectElement | null;
    if (subtitlePosEl) {
        subtitlePosEl.addEventListener('change', () => {
            window.electronAPI?.setSettings({ subtitlePosition: subtitlePosEl.value }).catch(console.error);
        });
    }

    if (proxyToggle && proxyType && proxyInput) {
        const updateProxyFields = () => {
            proxyType.disabled = !proxyToggle.checked;
            proxyInput.disabled = !proxyToggle.checked;
        };
        updateProxyFields();
        proxyToggle.addEventListener('change', () => {
            updateProxyFields();
            window.electronAPI?.setSettings({ proxyEnabled: proxyToggle.checked }).catch(console.error);
        });
        proxyType.addEventListener('change', () => {
            window.electronAPI?.setSettings({ proxyType: proxyType.value }).catch(console.error);
        });
        // Wrap the display without allowing line breaks in the endpoint itself.
        proxyInput.addEventListener('beforeinput', (event) => {
            if (event.inputType === 'insertLineBreak') event.preventDefault();
        });
        proxyInput.addEventListener('input', () => {
            if (proxyInput.value.includes('\n')) {
                proxyInput.value = proxyInput.value.replace(/\n/g, '');
            }
        });
        proxyInput.addEventListener('change', () => {
            window.electronAPI?.setSettings({ proxyAddress: proxyInput.value.trim() }).catch(console.error);
        });
    }

    // App Info / About modal setup
    const appInfoBtn = document.getElementById('appInfoBtn');
    const appInfoModal = document.getElementById('appInfoModal');
    const appInfoCloseBtn = document.getElementById('appInfoCloseBtn');
    const appInfoDoneBtn = document.getElementById('appInfoDoneBtn');
    const checkDependenciesBtn = document.getElementById('checkDependenciesBtn') as HTMLButtonElement | null;
    const deleteLocalDataBtn = document.getElementById('deleteLocalDataBtn') as HTMLButtonElement | null;
    const depCheckResult = document.getElementById('depCheckResult');
    const appInfoGithubLink = document.getElementById('appInfoGithubLink');

    if (appInfoGithubLink) {
        appInfoGithubLink.addEventListener('click', (e) => {
            e.preventDefault();
            const targetUrl = appInfoGithubLink.getAttribute('href') || 'https://github.com/Shawshank01/Vidbutler';
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(targetUrl);
            }
        });
    }

    deleteLocalDataBtn?.addEventListener('click', async () => {
        if (!depCheckResult) return;
        deleteLocalDataBtn.disabled = true;
        try {
            const result = await window.electronAPI.deleteLocalData();
            if (result.ok || result.cancelled) return;
            depCheckResult.textContent = result.error ?? '';
        } catch {
            depCheckResult.textContent = classicText('deleteLocalDataFailed');
        } finally {
            deleteLocalDataBtn.disabled = false;
        }
        depCheckResult.style.display = 'block';
    });

    async function loadAppInfo() {
        if (!window.electronAPI?.getAppInfo) return;
        try {
            const info = await window.electronAPI.getAppInfo();
            if (info) {
                const titleEl = document.getElementById('appInfoTitle');
                if (titleEl && info.name) titleEl.textContent = info.name;
                const versionBadge = document.getElementById('appInfoVersion');
                if (versionBadge && info.version) versionBadge.textContent = `v${info.version}`;
                const updateVerBadge = document.getElementById('updateModalVersion');
                if (updateVerBadge && info.version) updateVerBadge.textContent = `v${info.version}`;
                if (info.bundledTools) {
                    const ytEl = document.getElementById('toolVerYtdlp');
                    if (ytEl && info.bundledTools['yt-dlp']) ytEl.textContent = info.bundledTools['yt-dlp'];
                    const ffmpegEl = document.getElementById('toolVerFfmpeg');
                    if (ffmpegEl && info.bundledTools.ffmpeg) ffmpegEl.textContent = info.bundledTools.ffmpeg;
                    const denoEl = document.getElementById('toolVerDeno');
                    if (denoEl && info.bundledTools.deno) denoEl.textContent = info.bundledTools.deno;
                }
                // Only show "Check Dependencies" when NOT packaged (i.e. dev run / pn start)
                if (checkDependenciesBtn) {
                    checkDependenciesBtn.style.display = info.isPackaged ? 'none' : '';
                }
            }
        } catch (err) {
            console.error('Failed to load app info:', err);
        }
    }

    if (appInfoBtn && appInfoModal) {
        appInfoBtn.addEventListener('click', async () => {
            await loadAppInfo();
            appInfoModal.style.display = 'flex';
            appInfoCloseBtn?.focus();
        });

        const closeInfoModal = () => {
            appInfoModal.style.display = 'none';
            appInfoBtn.focus();
        };

        if (appInfoCloseBtn) appInfoCloseBtn.addEventListener('click', closeInfoModal);
        if (appInfoDoneBtn) appInfoDoneBtn.addEventListener('click', closeInfoModal);

        appInfoModal.addEventListener('click', (e) => {
            if (e.target === appInfoModal) closeInfoModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && appInfoModal.style.display === 'flex') {
                const updateModal = document.getElementById('updateModal');
                if (updateModal && updateModal.style.display === 'flex') return;
                closeInfoModal();
            }
        });
    }

    if (checkDependenciesBtn && depCheckResult) {
        checkDependenciesBtn.addEventListener('click', async () => {
            checkDependenciesBtn.disabled = true;
            window.UiLanguage.label(checkDependenciesBtn, 'checking');
            depCheckResult.style.display = 'block';
            depCheckResult.textContent = classicText('checkingDependencies');

            try {
                const res = await window.electronAPI.checkDependencies();
                if (!res || !res.success) {
                    depCheckResult.textContent = `❌ ${res?.message || classicText('dependencyCheckFailed')}`;
                } else {
                    const lines = [];
                    for (const dep of res.dependencies || []) {
                        if (dep.installed) {
                            lines.push(`✅ ${dep.name}: ${dep.version}`);
                            if (dep.name === 'ffmpeg' && dep.hasSubtitlesFilter === false) {
                                lines.push('   ⚠️ ' + classicText('missingLibass'));
                            }
                        } else {
                            lines.push('❌ ' + classicText('missingDependency', { name: dep.name }));
                        }
                    }
                    if (res.allInstalled) {
                        lines.push('\n🎉 ' + classicText('dependenciesOk'));
                    } else if (res.missing && res.missing.length > 0) {
                        lines.push('\n⚠️ ' + classicText('missingDependencies', { names: res.missing.join(', ') }));
                    }
                    depCheckResult.textContent = lines.join('\n');
                }
            } catch (err) {
                depCheckResult.textContent = '❌ ' + classicText('errorDetail', { detail: classicErrorMessage(err) });
            } finally {
                checkDependenciesBtn.disabled = false;
                window.UiLanguage.label(checkDependenciesBtn, 'checkDependencies');
            }
        });
    }
});

// Show asynchronous confirmation modal and return boolean without freezing UI thread
function showConfirmModal({ title = classicText('confirmAction'), message = '', confirmText = classicText('confirm'), cancelText = classicText('cancel') }: ConfirmModalOptions = {}) {
    return new Promise<boolean>((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        const acceptBtn = document.getElementById('confirmAcceptBtn');

        if (!modal || !cancelBtn || !acceptBtn) {
            resolve(false);
            return;
        }

        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        acceptBtn.textContent = confirmText;
        if (cancelText) {
            cancelBtn.textContent = cancelText;
            cancelBtn.style.display = '';
        } else {
            cancelBtn.style.display = 'none';
        }

        const cleanup = () => {
            modal.style.display = 'none';
            cancelBtn.style.display = '';
            acceptBtn.removeEventListener('click', handleAccept);
            cancelBtn.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleKeydown);
        };

        const handleAccept = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };

        acceptBtn.addEventListener('click', handleAccept);
        cancelBtn.addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleKeydown);

        modal.style.display = 'flex';
        acceptBtn.focus();
    });
}

// Show asynchronous update prompt modal and return boolean without freezing UI thread
function showUpdateModal({
    title = 'VidButler',
    version = '',
    sectionTitle = classicText('updateStatus'),
    status = '',
    currentVersion = '',
    latestVersion = '',
    notes = '',
    message = '',
    confirmText = classicText('ok'),
    cancelText = null,
    secondaryText = null
}: UpdateModalOptions = {}) {
    return new Promise<UpdateModalResult>((resolve) => {
        const modal = document.getElementById('updateModal');
        const titleEl = document.getElementById('updateModalTitle');
        const versionEl = document.getElementById('updateModalVersion');
        const closeBtn = document.getElementById('updateModalCloseBtn');
        const sectionTitleEl = document.getElementById('updateModalSectionTitle');
        const statusEl = document.getElementById('updateModalStatus');
        const currentRow = document.getElementById('updateModalCurrentRow');
        const currentVal = document.getElementById('updateModalCurrentVersion');
        const latestRow = document.getElementById('updateModalLatestRow');
        const latestVal = document.getElementById('updateModalLatestVersion');
        const notesSection = document.getElementById('updateModalNotesSection');
        const notesContent = document.getElementById('updateModalNotes');
        const messageEl = document.getElementById('updateModalMessage');
        const cancelBtn = document.getElementById('updateModalCancelBtn');
        const secondaryBtn = document.getElementById('updateModalSecondaryBtn');
        const actionBtn = document.getElementById('updateModalActionBtn');

        if (!modal || !actionBtn || !cancelBtn) {
            resolve(false);
            return;
        }

        if (titleEl) titleEl.textContent = title;
        const ver = (version || currentVersion || '').replace(/^v/, '');
        if (versionEl) {
            if (ver) {
                versionEl.textContent = `v${ver}`;
                versionEl.style.display = '';
            } else {
                versionEl.style.display = 'none';
            }
        }

        if (sectionTitleEl) sectionTitleEl.textContent = sectionTitle;
        if (statusEl) statusEl.textContent = status || '-';

        if (currentRow && currentVal) {
            if (currentVersion) {
                currentRow.style.display = 'flex';
                currentVal.textContent = currentVersion.replace(/^v/, '');
            } else {
                currentRow.style.display = 'none';
            }
        }

        if (latestRow && latestVal) {
            if (latestVersion) {
                latestRow.style.display = 'flex';
                latestVal.textContent = latestVersion.replace(/^v/, '');
            } else {
                latestRow.style.display = 'none';
            }
        }

        if (notesSection && notesContent) {
            if (notes && notes.trim()) {
                notesSection.style.display = 'block';
                notesContent.textContent = notes.trim();
            } else {
                notesSection.style.display = 'none';
                notesContent.textContent = '';
            }
        }

        if (messageEl) {
            if (message && message.trim()) {
                messageEl.style.display = 'block';
                messageEl.textContent = message.trim();
            } else {
                messageEl.style.display = 'none';
                messageEl.textContent = '';
            }
        }

        actionBtn.textContent = confirmText;
        if (cancelText) {
            cancelBtn.textContent = cancelText;
            cancelBtn.style.display = '';
        } else {
            cancelBtn.style.display = 'none';
        }
        if (secondaryText && secondaryBtn) {
            secondaryBtn.textContent = secondaryText;
            secondaryBtn.style.display = '';
        } else if (secondaryBtn) {
            secondaryBtn.style.display = 'none';
        }

        const hasSecondaryAction = Boolean(secondaryText && secondaryBtn);

        const cleanup = () => {
            modal.style.display = 'none';
            cancelBtn.style.display = '';
            if (secondaryBtn) secondaryBtn.style.display = 'none';
            actionBtn.removeEventListener('click', handleAction);
            if (cancelBtn) cancelBtn.removeEventListener('click', handleDismiss);
            if (secondaryBtn) secondaryBtn.removeEventListener('click', handleSecondary);
            if (closeBtn) closeBtn.removeEventListener('click', handleDismiss);
            modal.removeEventListener('click', handleBackdrop);
            document.removeEventListener('keydown', handleKeydown, true);
        };

        const handleAction = () => {
            cleanup();
            resolve(hasSecondaryAction ? 'confirm' : true);
        };

        const handleSecondary = () => {
            cleanup();
            resolve('secondary');
        };

        const handleDismiss = () => {
            cleanup();
            resolve(hasSecondaryAction ? 'cancel' : false);
        };

        const handleBackdrop = (e: MouseEvent) => {
            if (e.target === modal) {
                handleDismiss();
            }
        };

        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                handleDismiss();
            }
        };

        actionBtn.addEventListener('click', handleAction);
        if (cancelBtn) cancelBtn.addEventListener('click', handleDismiss);
        if (secondaryBtn) secondaryBtn.addEventListener('click', handleSecondary);
        if (closeBtn) closeBtn.addEventListener('click', handleDismiss);
        modal.addEventListener('click', handleBackdrop);
        document.addEventListener('keydown', handleKeydown, true);

        modal.style.display = 'flex';
        actionBtn.focus();
    });
}
window.showUpdateModal = showUpdateModal;

// Show cleanup modal and return boolean for delete files
function showCleanupModal(message: string) {
    return new Promise<boolean>((resolve) => {
        const modal = classicElement('cleanupModal');
        const messageEl = classicElement('cleanupMessage');
        const keepBtn = classicElement('keepFilesBtn');
        const deleteBtn = classicElement('deleteFilesBtn');

        if (message) {
            messageEl.textContent = message;
        }

        const handleKeep = () => {
            modal.style.display = 'none';
            cleanupListeners();
            resolve(false);
        };

        const handleDelete = () => {
            modal.style.display = 'none';
            cleanupListeners();
            resolve(true);
        };

        const cleanupListeners = () => {
            keepBtn.removeEventListener('click', handleKeep);
            deleteBtn.removeEventListener('click', handleDelete);
        };

        keepBtn.addEventListener('click', handleKeep);
        deleteBtn.addEventListener('click', handleDelete);

        modal.style.display = 'flex';
    });
}

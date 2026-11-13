// Which addresses the renderer may ask the operating system to open (the 'open-external' IPC channel).
// Anything else (file:, custom app protocols, javascript:, ...) could launch programs, so it is refused.

const ALLOWED_PROTOCOLS = new Set([
    'http:',
    'https:',
    // The macOS "Files & Folders" privacy pane, opened when reading browser cookies is blocked.
    'x-apple.systempreferences:'
]);

const MAX_URL_CHARS = 4096;

/** Whether `value` is an address the app is willing to hand to the operating system. */
export function isAllowedExternalUrl(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_URL_CHARS) return false;
    try {
        return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol);
    } catch {
        return false;
    }
}

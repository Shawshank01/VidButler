// Validation of LLM-supplied tool parameters.
//
// The model is never trusted. Every value that ends up in a yt-dlp / ffmpeg argument list or a
// file path is validated here first. Tools build their argument arrays from these validated
// values; the model never supplies raw command-line flags (see the guarded passthrough).

import { MAX_CLIP_TIMESTAMP_MS } from './limits.js';
import { MESSAGES } from './messages.js';

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

function hasControlChars(text: string) {
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
}

/** Accept only plain http(s) URLs. Anything else (file://, flags like --exec, etc.) is rejected. */
export function validateUrl(value: unknown, name = 'url') {
    if (typeof value !== 'string') {
        throw new ValidationError(`"${name}" must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 2048) {
        throw new ValidationError(`"${name}" must be between 1 and 2048 characters.`);
    }
    // Reject whitespace and control characters anywhere in the URL.
    if (/\s/.test(trimmed) || hasControlChars(trimmed)) {
        throw new ValidationError(`"${name}" must not contain whitespace or control characters.`);
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new ValidationError(`"${name}" is not a valid URL.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ValidationError(`"${name}" must start with http:// or https://.`);
    }
    return trimmed;
}

/** Subtitle language code as reported by yt-dlp, e.g. "en", "zh-Hans", "en-orig". */
export function validateLang(value: unknown, name = 'lang') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(value.trim())) {
        throw new ValidationError(`"${name}" must be a language code such as "en" or "zh-Hans".`);
    }
    return value.trim();
}

/** A yt-dlp format code such as "137+140", "bestaudio" or "18". Deliberately conservative. */
export function validateFormatCode(value: unknown, name = 'format_code') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9+_./-]{0,59}$/.test(value.trim())) {
        throw new ValidationError(
            `"${name}" must be a format code from list_formats, such as "137+140" or "bestaudio".`
        );
    }
    return value.trim();
}

/**
 * A file name (or fragment of one, such as a video ID) inside the download folder.
 * Path separators and traversal are rejected so the model cannot reach outside the folder.
 */
export function validateFileHint(value: unknown, name = 'file') {
    if (typeof value !== 'string') {
        throw new ValidationError(`"${name}" must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 255) {
        throw new ValidationError(`"${name}" must be between 1 and 255 characters.`);
    }
    if (/[/\\]/.test(trimmed) || trimmed.includes('..') || hasControlChars(trimmed)) {
        throw new ValidationError(`"${name}" must be a file name from list_downloads, not a path.`);
    }
    return trimmed;
}

/** Value must be one of `allowed`. Returns `fallback` when the value is undefined/null. */
export function validateEnum<const T>(value: unknown, allowed: readonly T[], name: string, fallback?: T): T {
    if (value === undefined || value === null || value === '') {
        if (fallback !== undefined) return fallback;
        throw new ValidationError(`"${name}" is required (one of: ${allowed.join(', ')}).`);
    }
    if (!allowed.includes(value as T)) {
        throw new ValidationError(`"${name}" must be one of: ${allowed.join(', ')}.`);
    }
    return value as T;
}

/** Integer within [min, max]. Returns undefined when the value is undefined/null. */
export function validateIntRange(value: unknown, min: number, max: number, name: string) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new ValidationError(`"${name}" must be an integer between ${min} and ${max}.`);
    }
    return value;
}

/** Parse a non-negative timestamp as seconds, with up to millisecond precision. */
export function validateTimestamp(value: unknown, name: string) {
    const match = typeof value === 'string' && /^(?:(?:(\d+):)?(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    if (match) {
        const [, hours, minutes, seconds, fraction = ''] = match;
        const totalMs = (Number(hours || 0) * 3600 + Number(minutes || 0) * 60 + Number(seconds)) * 1000
            + Number(fraction.padEnd(3, '0'));
        if (totalMs <= MAX_CLIP_TIMESTAMP_MS && (!minutes || Number(seconds) < 60) && (!hours || Number(minutes) < 60)) {
            return totalMs / 1000;
        }
    }
    throw new ValidationError(MESSAGES.invalidClipTimestamp(name));
}

/** Optional boolean. Returns `fallback` when the value is undefined/null. */
export function validateBool(value: unknown, name: string, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') {
        throw new ValidationError(`"${name}" must be true or false.`);
    }
    return value;
}

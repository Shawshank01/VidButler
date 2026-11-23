import { ProviderError } from '../errors.js';
import { GeminiProvider, DEFAULT_GEMINI_MODEL, THINKING_LEVELS, DEFAULT_THINKING_LEVEL } from './gemini.ts';
import { OllamaProvider, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_BASE_URL } from './ollama.ts';
import { OpenAICompatibleProvider, DEFAULT_OPENAI_BASE_URL } from './openai-compatible.ts';
import { XaiProvider, DEFAULT_XAI_BASE_URL, DEFAULT_XAI_MODEL, XAI_REASONING_EFFORTS } from './xai.ts';
import { CohereProvider, DEFAULT_COHERE_BASE_URL, DEFAULT_COHERE_MODEL } from './cohere.ts';
import { MESSAGES } from '../messages.js';
import { MAX_SMALL_TRANSCRIPT_INPUT_CHARS } from '../limits.js';
import type { Provider, ProviderOptions } from '../types.js';

interface ProviderCapabilities {
    label: string;
    defaultModel: string;
    defaultBaseUrl?: string;
    needsApiKey: boolean;
    editableBaseUrl: boolean;
    lockedBaseUrlError?: string;
    transcriptInputChars?: number;
    options: Record<string, { choices: string[]; default: string; label: string }>;
}

export const DEFAULT_PROVIDER_TYPE = 'cohere';

/**
 * Provider types the app knows about, with the defaults the settings UI should pre-fill.
 *
 * Capabilities are declared here so that settings code never has to special-case a provider:
 * - `needsApiKey`       the provider requires an API key.
 * - `editableBaseUrl`   the user may point the provider at another server. Providers that receive an
 *                       API key keep a fixed URL so the key cannot be redirected elsewhere.
 * - `lockedBaseUrlError` if set, attempts to change a fixed URL are rejected with this message
 *                       (otherwise they are silently ignored).
 * - `transcriptInputChars`  Smaller transcript budget for providers with unknown context limits.
 * - `options`           extra per-provider tuning settings, each `{ choices, default, label }`.
 *                       The option name is also the key passed to the provider's constructor.
 */
export const PROVIDER_TYPES: Record<string, ProviderCapabilities> = {
    gemini: {
        label: 'Google Gemini',
        defaultModel: DEFAULT_GEMINI_MODEL,
        needsApiKey: true,
        editableBaseUrl: false,
        options: {
            thinkingLevel: { choices: THINKING_LEVELS, default: DEFAULT_THINKING_LEVEL, label: 'Gemini thinking level' }
        }
    },
    xai: {
        label: 'xAI Grok',
        defaultModel: DEFAULT_XAI_MODEL,
        defaultBaseUrl: DEFAULT_XAI_BASE_URL,
        needsApiKey: true,
        editableBaseUrl: false,
        lockedBaseUrlError: 'The xAI server URL is fixed.',
        options: {
            reasoningEffort: { choices: XAI_REASONING_EFFORTS, default: 'none', label: 'xAI reasoning effort' }
        }
    },
    cohere: {
        label: 'Cohere',
        defaultModel: DEFAULT_COHERE_MODEL,
        defaultBaseUrl: DEFAULT_COHERE_BASE_URL,
        needsApiKey: true,
        editableBaseUrl: false,
        lockedBaseUrlError: MESSAGES.cohereFixedUrl,
        options: {}
    },
    ollama: {
        label: 'Ollama (local)',
        defaultModel: DEFAULT_OLLAMA_MODEL,
        defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL,
        needsApiKey: false,
        editableBaseUrl: true,
        transcriptInputChars: MAX_SMALL_TRANSCRIPT_INPUT_CHARS,
        options: {}
    },
    'openai-compatible': {
        label: 'OpenAI-compatible',
        defaultModel: '',
        defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
        needsApiKey: false,
        editableBaseUrl: true,
        transcriptInputChars: MAX_SMALL_TRANSCRIPT_INPUT_CHARS,
        options: {}
    }
};

/** Build a provider from saved settings. */
export function createProvider(config: ProviderOptions = {}, options: { fetchImpl?: typeof fetch } = {}): Provider {
    const type = config.type || DEFAULT_PROVIDER_TYPE;
    const common = { ...config, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) };

    switch (type) {
        case 'gemini':
            return new GeminiProvider(common);
        case 'xai':
            return new XaiProvider({
                ...common,
                model: common.model || DEFAULT_XAI_MODEL
            });
        case 'cohere':
            return new CohereProvider(common);
        case 'ollama':
            return new OllamaProvider(common);
        case 'openai-compatible':
            return new OpenAICompatibleProvider(common);
        default:
            throw new ProviderError(`Unknown AI provider "${type}".`, { kind: 'bad_request' });
    }
}

export { CohereProvider, GeminiProvider, OllamaProvider, OpenAICompatibleProvider, XaiProvider };

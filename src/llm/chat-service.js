// @ts-check
// Main-process orchestration for one AI conversation. Electron-free so it can be unit tested:
// everything it needs from the app (settings storage, key storage, event delivery) is injected.
//
// This class only coordinates a request. The pieces live in their own modules:
//   ai-settings.js    settings, API key slots and provider construction
//   conversation.ts   message history and its invariants
//   confirmations.js  prompts waiting for the user
//   agent.ts          the model/tool loop
import { runAgent } from './agent.ts';
import { createEventHandler } from './agent-events.ts';
import { AiSettings } from './ai-settings.js';
import { ConfirmationBroker } from './confirmations.js';
import { Conversation, trimHistory } from './conversation.ts';
import { AiContextError, isDirectory, validateContext } from './context.js';
import { cancelCurrentTask } from '../core/tools.ts';
import { ProviderError } from './errors.js';
import { MAX_USER_MESSAGE_CHARS } from './limits.js';
import { MESSAGES } from './messages.js';
import { buildSystemPrompt } from './prompt.js';
import { AiSettingsError } from './provider-settings.js';
import { redactSecrets } from './redact.js';

/** @import {AiContext, AiEvent, AiSendResult, AiTestConnectionOptions} from './types.js' */

// Re-exported for the app and tests, which import everything AI-related from here.
export { AiSettingsError, trimHistory };

/**
 * @param {string} kind
 * @param {string} message
 * @returns {{ok: false, error: {kind: string, message: string}}}
 */
const failure = (kind, message) => ({ ok: false, error: { kind, message } });

/** @param {unknown} error */
function errorMessage(error) {
    return error && typeof error === 'object' && 'message' in error ? error.message : undefined;
}

/**
 * @typedef {object} ChatServiceDeps
 * @property {{ read: () => Promise<object>, merge: (updates: object) => Promise<object> }} settings
 * @property {import('./key-store.js').KeyStore} keyStore
 * @property {(event: AiEvent) => void} emit           Default destination for events shown to the user.
 * @property {typeof fetch} [fetchImpl]
 * @property {(path: string) => Promise<boolean>} [isDirectory]
 * @property {(message: string) => void} [log]   Diagnostic logging (never receives API keys or message text).
 * @property {number} [confirmationTimeoutMs]
 * @property {() => Promise<import('../types/ui-language.d.ts').UiTranslator>} [getUiTranslator]
 */
export class ChatService {
    /** @param {ChatServiceDeps} deps */
    constructor({ settings, keyStore, emit, fetchImpl, isDirectory: isDir, log, confirmationTimeoutMs, getUiTranslator }) {
        this.log = log || (() => { });
        this.emit = emit;
        this.getUiTranslator = getUiTranslator;
        this.isDirectory = isDir || isDirectory;

        this.aiSettings = new AiSettings({ store: settings, keyStore, fetchImpl });
        this.conversation = new Conversation();
        this.confirmations = new ConfirmationBroker({ timeoutMs: confirmationTimeoutMs });
        this.running = null; // { controller } while a request is in progress
    }

    // ---------- settings (see ai-settings.js) ----------

    getSettings() {
        return this.aiSettings.get();
    }

    /** @param {Parameters<AiSettings['set']>[0]} update */
    setSettings(update) {
        return this.aiSettings.set(update);
    }

    /**
     * @param {string} type
     * @param {string} apiKey
     */
    setApiKey(type, apiKey) {
        return this.aiSettings.setApiKey(type, apiKey);
    }

    /** @param {string} type */
    removeApiKey(type) {
        return this.aiSettings.removeApiKey(type);
    }

    /**
     * @param {AiTestConnectionOptions} [overrides]
     * @returns {Promise<{ok: boolean, message: string}>} Never throws.
     */
    async testConnection(overrides = {}) {
        let secrets = [overrides.apiKey];
        try {
            secrets = await this.aiSettings.secrets(overrides.apiKey);
            const provider = await this.aiSettings.buildProvider(overrides);
            const result = await provider.testConnection();
            return { ok: result.ok === true, message: redactSecrets(result.message, secrets) };
        } catch (err) {
            return { ok: false, message: redactSecrets(errorMessage(err), secrets) };
        }
    }

    // ---------- chat ----------

    isBusy() {
        return this.running !== null;
    }

    /**
     * Run one user message through the agent.
     * @param {string} message
     * @param {AiContext} context  Current UI values.
     * @param {{emit?: (event: AiEvent) => void}} [options]  `emit` delivers this request's events (and
     *        confirmation prompts) to the window that sent it; defaults to the service-wide `emit`.
     * @returns {Promise<AiSendResult>}
     */
    async send(message, context = {}, options = {}) {
        if (this.running) return failure('busy', MESSAGES.assistantBusy);
        const text = typeof message === 'string' ? message.trim() : '';
        if (!text) return failure('bad_request', 'Message is empty.');
        if (text.length > MAX_USER_MESSAGE_CHARS) {
            return failure('bad_request', `Message is too long (max ${MAX_USER_MESSAGE_CHARS} characters).`);
        }

        const controller = new AbortController();
        /** @param {AiEvent} event */
        const emit = (event) => (options.emit ?? this.emit)(event);
        this.running = { controller };
        /** @type {string[]} */
        let secrets = [];

        try {
            const ctx = await validateContext(context, this.isDirectory);
            const saved = await this.getSettings();
            secrets = await this.aiSettings.secrets();
            const provider = await this.aiSettings.buildProvider();
            this.log(`request started: provider=${provider.id} model=${provider.model} history=${this.conversation.length}`);

            const system = buildSystemPrompt({
                downloadFolder: ctx.downloadFolder,
                browser: ctx.browser,
                proxyEnabled: Boolean(ctx.proxy)
            });

            this.conversation.startTurn();

            const result = await runAgent({
                provider,
                system,
                history: this.conversation.messages,
                userText: text,
                ctx: { ...ctx, onProgress: (line) => emit({ type: 'progress', text: line }) },
                onEvent: createEventHandler({ log: (line) => this.log(line), emit }),
                confirm: (request) => this.confirmations.request(request, emit),
                confirmMode: saved.confirmMode,
                translateUi: await this.getUiTranslator?.(),
                signal: controller.signal
            });

            this.log(`request finished: ${result.stoppedBecause} after ${result.steps} agent step(s), ${result.text.length} characters`);
            return { ok: true, text: result.text, stoppedBecause: result.stoppedBecause, steps: result.steps };
        } catch (err) {
            const kind = err instanceof ProviderError ? err.kind : err instanceof AiSettingsError ? 'settings' : 'unexpected';
            const messageText = redactSecrets(errorMessage(err) || 'Unexpected error.', secrets);
            this.log(`request failed: kind=${kind} message=${messageText}`);
            this.conversation.failTurn(MESSAGES.requestFailed(messageText));
            if (err instanceof AiContextError) {
                return { ok: false, error: { kind, message: messageText, contextField: err.field } };
            }
            return failure(kind, messageText);
        } finally {
            this.confirmations.denyAll();
            this.running = null;
        }
    }

    /** Stop the current request: aborts the model call, cancels the running task, denies prompts. */
    cancel() {
        if (!this.running) return false;
        this.running.controller.abort();
        this.confirmations.denyAll();
        // A download/encode may be mid-flight inside a tool call; stop it too.
        cancelCurrentTask();
        return true;
    }

    reset() {
        if (this.running) return false;
        this.conversation.reset();
        return true;
    }

    /**
     * Called when the user clicks Allow / Deny in the renderer.
     * @param {string} requestId
     * @param {boolean} approved
     */
    resolveConfirmation(requestId, approved) {
        return this.confirmations.resolve(requestId, approved);
    }
}

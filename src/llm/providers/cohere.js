import { ProviderError } from '../errors.js';
import { CONNECTION_TEST_TIMEOUT_MS, MODEL_REQUEST_TIMEOUT_MS } from '../limits.js';
import { MESSAGES } from '../messages.js';
import { requestJson, requestStream, DEFAULT_RETRIES, DEFAULT_RETRY_DELAY_MS } from './http.js';
import { isStreamable, parseStreamJson, readJsonBody, readSse } from './stream.js';

const COHERE_ORIGIN = 'https://api.cohere.com';
export const DEFAULT_COHERE_BASE_URL = `${COHERE_ORIGIN}/v2`;
export const DEFAULT_COHERE_MODEL = 'command-a-plus-05-2026';

/** Cohere's native v2 Chat API. */
export class CohereProvider {
    id = 'cohere';
    displayName = 'Cohere';
    baseUrl = DEFAULT_COHERE_BASE_URL;

    constructor({
        apiKey,
        model,
        retries = DEFAULT_RETRIES,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        fetchImpl = globalThis.fetch
    } = {}) {
        this.apiKey = apiKey;
        this.model = model || DEFAULT_COHERE_MODEL;
        this.retries = retries;
        this.retryDelayMs = retryDelayMs;
        this.fetchImpl = fetchImpl;
    }

    #headers() {
        if (!this.apiKey) throw new ProviderError(MESSAGES.cohereMissingKey, { kind: 'auth' });
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    /** Check authentication and whether the selected model supports Chat, without generating text. */
    async testConnection({ signal } = {}) {
        const data = await requestJson({
            fetchImpl: this.fetchImpl,
            providerName: this.displayName,
            url: `${COHERE_ORIGIN}/v1/models/${encodeURIComponent(this.model)}`,
            method: 'GET',
            headers: this.#headers(),
            signal,
            model: this.model,
            timeoutMs: CONNECTION_TEST_TIMEOUT_MS
        });
        if (!data?.endpoints?.includes('chat')) return { ok: false, message: MESSAGES.cohereModelNotChat(this.model) };
        return { ok: true, message: MESSAGES.cohereConnected(this.model) };
    }

    #toMessages(system, messages) {
        const out = system ? [{ role: 'system', content: system }] : [];
        for (const msg of messages) {
            if (msg.role === 'tool') {
                out.push({ role: 'tool', tool_call_id: msg.toolCallId, content: JSON.stringify(msg.result) });
            } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
                out.push({
                    role: 'assistant',
                    ...(msg.text ? { content: msg.text } : {}),
                    tool_calls: msg.toolCalls.map(({ id, name, args }) => ({
                        id,
                        type: 'function',
                        function: { name, arguments: JSON.stringify(args || {}) }
                    }))
                });
            } else {
                out.push({ role: msg.role, content: msg.text });
            }
        }
        return out;
    }

    #parseToolCalls(calls) {
        return calls.map(({ id, function: fn }) => {
            let args;
            try {
                args = JSON.parse(fn?.arguments || '{}');
            } catch {
                throw new ProviderError(MESSAGES.cohereInvalidToolCall, { kind: 'bad_response' });
            }
            if (!id || !fn?.name || !args || typeof args !== 'object' || Array.isArray(args)) {
                throw new ProviderError(MESSAGES.cohereInvalidToolCall, { kind: 'bad_response' });
            }
            return { id, name: fn.name, args };
        });
    }

    async chat({ system, messages, tools = [], signal, onTextDelta, onRetry }) {
        const request = {
            fetchImpl: this.fetchImpl,
            providerName: this.displayName,
            url: `${DEFAULT_COHERE_BASE_URL}/chat`,
            headers: this.#headers(),
            body: {
                model: this.model,
                stream: Boolean(onTextDelta),
                messages: this.#toMessages(system, messages),
                ...(tools.length ? {
                    tools: tools.map(({ name, description, parameters }) => ({
                        type: 'function', function: { name, description, parameters }
                    }))
                } : {})
            },
            signal,
            model: this.model,
            timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
            retries: this.retries,
            retryDelayMs: this.retryDelayMs,
            onRetry
        };
        if (onTextDelta) {
            request.headers.Accept = 'text/event-stream';
            return this.#stream(request, onTextDelta);
        }
        return this.#parseReply(await requestJson(request));
    }

    #parseReply(data) {
        this.#checkFinish(data);
        if (!data?.message) throw new ProviderError(MESSAGES.cohereNoAnswer, { kind: 'bad_response' });
        const text = (data.message.content || [])
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('');
        return { text: text.trim(), toolCalls: this.#parseToolCalls(data.message.tool_calls || []), raw: null };
    }

    #checkFinish(info) {
        if (info?.error || ['ERROR', 'TIMEOUT'].includes(info?.finish_reason)) {
            throw new ProviderError(MESSAGES.cohereGenerationFailed(info.error || info.finish_reason));
        }
    }

    async #stream(request, onTextDelta) {
        const response = await requestStream(request);
        if (!isStreamable(response) || response.headers?.get('content-type')?.includes('application/json')) {
            return this.#parseReply(await readJsonBody(response, this.displayName));
        }

        let text = '';
        let completed = false;
        const calls = new Map();
        const pending = new Set();
        await readSse(response, { signal: request.signal, providerName: this.displayName }, (payload) => {
            const { type, delta, index } = parseStreamJson(payload, this.displayName);
            if (type === 'content-delta') {
                const chunk = delta?.message?.content?.text;
                if (typeof chunk === 'string' && chunk) {
                    text += chunk;
                    onTextDelta(chunk);
                }
            } else if (type === 'tool-call-start') {
                const call = delta?.message?.tool_calls;
                if (!call?.function || !Number.isInteger(index)) {
                    throw new ProviderError(MESSAGES.cohereInvalidToolCall, { kind: 'bad_response' });
                }
                calls.set(index, call);
                pending.add(index);
            } else if (type === 'tool-call-delta') {
                const args = delta?.message?.tool_calls?.function?.arguments;
                if (pending.has(index) && typeof args === 'string') {
                    const fn = calls.get(index).function;
                    fn.arguments = (fn.arguments || '') + args;
                }
            } else if (type === 'tool-call-end') {
                pending.delete(index);
            } else if (type === 'message-end') {
                this.#checkFinish(delta);
                completed = true;
            }
        });
        if (!completed || pending.size) throw new ProviderError(MESSAGES.cohereStreamIncomplete, { kind: 'bad_response' });
        return { text: text.trim(), toolCalls: this.#parseToolCalls([...calls.values()]), raw: null };
    }
}

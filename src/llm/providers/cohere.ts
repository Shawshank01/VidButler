import { ProviderError } from '../errors.js';
import { CONNECTION_TEST_TIMEOUT_MS, MODEL_REQUEST_TIMEOUT_MS } from '../limits.js';
import { MESSAGES } from '../messages.js';
import { requestJson, requestStream, DEFAULT_RETRIES, DEFAULT_RETRY_DELAY_MS } from './http.js';
import { isStreamable, parseStreamJson, readJsonBody, readSse } from './stream.js';
import type { ChatMessage, Provider, ProviderChatReply, ProviderChatRequest, ProviderOptions } from '../types.js';
import type { ProviderHttpRequest } from './types.js';

interface CohereCall {
    id?: string;
    function?: { name?: string; arguments?: string };
}

interface CohereFinish {
    error?: string;
    finish_reason?: string;
}

interface CohereReply extends CohereFinish {
    message?: { content?: { type: string; text?: string }[]; tool_calls?: CohereCall[] };
}

interface CohereEvent {
    type: string;
    index: number;
    delta?: CohereFinish & { message?: { content?: { text?: string }; tool_calls?: CohereCall } };
}

const COHERE_ORIGIN = 'https://api.cohere.com';
export const DEFAULT_COHERE_BASE_URL = `${COHERE_ORIGIN}/v2`;
export const DEFAULT_COHERE_MODEL = 'command-a-plus-05-2026';

/** Cohere's native v2 Chat API. */
export class CohereProvider implements Provider {
    declare model: string;
    declare apiKey: string | undefined;
    declare retries: number;
    declare retryDelayMs: number;
    declare fetchImpl: typeof fetch;

    id = 'cohere';
    displayName = 'Cohere';
    baseUrl = DEFAULT_COHERE_BASE_URL;

    constructor({
        apiKey,
        model,
        retries = DEFAULT_RETRIES,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        fetchImpl = globalThis.fetch
    }: ProviderOptions = {}) {
        this.apiKey = apiKey;
        this.model = model || DEFAULT_COHERE_MODEL;
        this.retries = retries;
        this.retryDelayMs = retryDelayMs;
        this.fetchImpl = fetchImpl;
    }

    #headers(): Record<string, string> {
        if (!this.apiKey) throw new ProviderError(MESSAGES.cohereMissingKey, { kind: 'auth' });
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    /** Check authentication and whether the selected model supports Chat, without generating text. */
    async testConnection({ signal }: { signal?: AbortSignal } = {}) {
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

    #toMessages(system: string | undefined, messages: ChatMessage[]) {
        const out: { role: string; content?: string; tool_call_id?: string; tool_calls?: CohereCall[] }[] =
            system ? [{ role: 'system', content: system }] : [];
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

    #parseToolCalls(calls: CohereCall[]): ProviderChatReply['toolCalls'] {
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

    async chat({ system, messages, tools = [], signal, onTextDelta, onRetry }: ProviderChatRequest): Promise<ProviderChatReply> {
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

    #parseReply(data: CohereReply): ProviderChatReply {
        this.#checkFinish(data);
        if (!data?.message) throw new ProviderError(MESSAGES.cohereNoAnswer, { kind: 'bad_response' });
        const text = (data.message.content || [])
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('');
        return { text: text.trim(), toolCalls: this.#parseToolCalls(data.message.tool_calls || []), raw: null };
    }

    #checkFinish(info?: CohereFinish) {
        const reason = info?.finish_reason;
        if (info?.error || reason === 'ERROR' || reason === 'TIMEOUT') {
            throw new ProviderError(MESSAGES.cohereGenerationFailed(info?.error || reason));
        }
    }

    async #stream(request: ProviderHttpRequest, onTextDelta: (chunk: string) => void): Promise<ProviderChatReply> {
        const response = await requestStream(request);
        if (!isStreamable(response) || response.headers?.get('content-type')?.includes('application/json')) {
            return this.#parseReply(await readJsonBody(response, this.displayName));
        }

        let text = '';
        let completed = false;
        const calls = new Map<number, CohereCall>();
        const pending = new Set<number>();
        await readSse(response, { signal: request.signal, providerName: this.displayName }, (payload: string) => {
            const { type, delta, index }: CohereEvent = parseStreamJson(payload, this.displayName);
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
                const fn = calls.get(index)?.function;
                if (fn && pending.has(index) && typeof args === 'string') {
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

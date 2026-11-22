import { ProviderError } from '../errors.js';
import { CONNECTION_TEST_TIMEOUT_MS, MODEL_REQUEST_TIMEOUT_MS } from '../limits.js';
import { requestJson, requestStream, DEFAULT_RETRIES, DEFAULT_RETRY_DELAY_MS } from './http.js';
import { isStreamable, parseStreamJson, readJsonBody, readSse } from './stream.js';
import type { ChatMessage, Provider, ProviderChatReply, ProviderChatRequest, ProviderOptions } from '../types.js';
import type { ProviderHttpRequest } from './types.js';

interface XaiResponse {
    status?: string;
    output?: {
        type: string;
        call_id?: string;
        id?: string;
        name?: string;
        arguments?: unknown;
        content?: { type: string; text?: string }[];
    }[];
}

export const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_XAI_MODEL = 'grok-4.3';
export const XAI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];
const MODELS_SUPPORTING_NO_REASONING = new Set(['grok-4.3', 'grok-4.3-latest']);

/** xAI's native Responses API provider. */
export class XaiProvider implements Provider {
    declare id: string;
    declare displayName: string;
    declare model: string;
    declare apiKey: string | undefined;
    declare baseUrl: string;
    declare retries: number;
    declare retryDelayMs: number;
    declare reasoningEffort: string;
    declare fetchImpl: typeof fetch;

    constructor({
        apiKey,
        model = DEFAULT_XAI_MODEL,
        reasoningEffort = 'none',
        retries = DEFAULT_RETRIES,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        fetchImpl = globalThis.fetch
    }: ProviderOptions = {}) {
        this.id = 'xai';
        this.displayName = 'xAI';
        this.retries = retries;
        this.retryDelayMs = retryDelayMs;
        this.apiKey = apiKey;
        this.model = model;
        this.reasoningEffort = XAI_REASONING_EFFORTS.includes(reasoningEffort) ? reasoningEffort : 'none';
        this.baseUrl = DEFAULT_XAI_BASE_URL;
        this.fetchImpl = fetchImpl;
    }

    #headers(): Record<string, string> {
        if (!this.apiKey) {
            throw new ProviderError(`No ${this.displayName} API key is configured. Add one in settings.`, { kind: 'auth' });
        }
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    /** Check connectivity by listing models. */
    async testConnection({ signal }: { signal?: AbortSignal } = {}) {
        try {
            const data: { data?: { id: string }[] } = await requestJson({
                fetchImpl: this.fetchImpl,
                providerName: this.displayName,
                url: `${this.baseUrl}/models`,
                method: 'GET',
                headers: this.#headers(),
                signal,
                timeoutMs: CONNECTION_TEST_TIMEOUT_MS
            });
            const ids = (data.data || []).map((m) => m.id);
            if (ids.length > 0 && !ids.includes(this.model)) {
                return {
                    ok: false,
                    message: `Connected, but model "${this.model}" was not in the server's model list. Check the spelling (some servers do not list aliases).`
                };
            }
            return { ok: true, message: `Connected to ${this.baseUrl}.` };
        } catch (err) {
            if (err instanceof ProviderError && err.kind === 'not_found') {
                return { ok: true, message: `Server reachable (it does not list models, so "${this.model}" is unverified).` };
            }
            throw err;
        }
    }

    #toInput(messages: ChatMessage[]) {
        const input = [];
        for (const msg of messages) {
            if (msg.role === 'user') {
                input.push({ role: 'user', content: msg.text });
            } else if (msg.role === 'assistant') {
                if (msg.text) input.push({ role: 'assistant', content: msg.text });
                for (const call of msg.toolCalls || []) {
                    input.push({
                        type: 'function_call',
                        call_id: call.providerCallId || call.id,
                        name: call.name,
                        arguments: JSON.stringify(call.args || {})
                    });
                }
            } else if (msg.role === 'tool') {
                input.push({
                    type: 'function_call_output',
                    call_id: msg.providerCallId || msg.toolCallId,
                    output: JSON.stringify(msg.result)
                });
            }
        }
        return input;
    }

    async chat({ system, messages, tools = [], signal, onTextDelta, onRetry }: ProviderChatRequest): Promise<ProviderChatReply> {
        if (!this.model) {
            throw new ProviderError('No model is configured for the xAI provider.', { kind: 'bad_request' });
        }

        // Use the provider's default when None is selected for another model.
        const sendReasoningEffort = this.reasoningEffort !== 'none' || MODELS_SUPPORTING_NO_REASONING.has(this.model);
        const request = {
            fetchImpl: this.fetchImpl,
            providerName: this.displayName,
            url: `${this.baseUrl}/responses`,
            headers: this.#headers(),
            body: {
                model: this.model,
                instructions: system || undefined,
                input: this.#toInput(messages),
                ...(sendReasoningEffort ? { reasoning: { effort: this.reasoningEffort } } : {}),
                ...(tools.length > 0
                    ? {
                        tools: tools.map((t) => ({
                            type: 'function',
                            name: t.name,
                            description: t.description,
                            parameters: t.parameters
                        }))
                    }
                    : {})
            },
            signal,
            model: this.model,
            timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
            retries: this.retries,
            retryDelayMs: this.retryDelayMs,
            onRetry
        };
        if (onTextDelta) {
            return this.#streamResponse({ ...request, body: { ...request.body, stream: true } }, onTextDelta, signal);
        }
        const data = await requestJson(request);
        return this.#parseResponse(data);
    }

    async #streamResponse(request: ProviderHttpRequest, onTextDelta: (text: string) => void, signal?: AbortSignal): Promise<ProviderChatReply> {
        const response = await requestStream(request);
        if (!isStreamable(response)) {
            return this.#parseResponse(await readJsonBody(response, this.displayName));
        }

        let completed: XaiResponse | undefined;
        await readSse(response, { signal, providerName: this.displayName }, (payload: string) => {
            const event: { type: string; delta?: string; response?: XaiResponse } = parseStreamJson(payload, this.displayName);
            if (event.type === 'response.output_text.delta' && event.delta) onTextDelta(event.delta);
            if (event.type === 'response.completed' && event.response) completed = event.response;
        });
        if (!completed) throw new ProviderError(`${this.displayName} ended the stream without a completed response.`, { kind: 'bad_response' });
        return this.#parseResponse(completed);
    }

    #parseResponse(data: XaiResponse): ProviderChatReply {
        const output = Array.isArray(data.output) ? data.output : [];
        const toolCalls = output
            .filter((item) => item.type === 'function_call')
            .map((call, index) => {
                let args = {};
                if (typeof call.arguments === 'string' && call.arguments.trim()) {
                    try { args = JSON.parse(call.arguments); } catch { args = {}; }
                } else if (call.arguments && typeof call.arguments === 'object') {
                    args = call.arguments;
                }
                return {
                    id: call.call_id || call.id || `xai-call-${Date.now()}-${index}`,
                    providerCallId: call.call_id || call.id,
                    name: call.name,
                    args
                };
            });
        const text = output
            .filter((item) => item.type === 'message')
            .flatMap((item) => item.content || [])
            .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('')
            .trim();

        if (!text && toolCalls.length === 0 && data.status !== 'completed') {
            throw new ProviderError(`${this.displayName} returned no answer.`, { kind: 'bad_response' });
        }
        return { text, toolCalls, raw: null };
    }
}

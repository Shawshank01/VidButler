import { ProviderError } from '../errors.js';
import { CONNECTION_TEST_TIMEOUT_MS, MODEL_REQUEST_TIMEOUT_MS } from '../limits.js';
import { MESSAGES } from '../messages.js';
import { requestJson, requestStream, DEFAULT_RETRIES, DEFAULT_RETRY_DELAY_MS } from './http.js';
import { isStreamable, parseStreamJson, readJsonBody, readSse } from './stream.js';
import type { ChatMessage, Provider, ProviderChatReply, ProviderChatRequest, ProviderOptions, ToolDeclaration } from '../types.js';

interface GeminiStep {
    type?: string;
    text?: string;
    content?: string | { type: string; text: string; thought?: boolean }[];
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: unknown;
    args?: unknown;
}

type GeminiUsage = Partial<Record<
    'total_input_tokens' | 'promptTokenCount' | 'input_tokens'
    | 'total_thought_tokens' | 'thoughtsTokenCount' | 'thought_tokens'
    | 'total_output_tokens' | 'candidatesTokenCount' | 'output_tokens', number
>>;

interface GeminiInteraction {
    id?: string | null;
    status?: string;
    steps?: GeminiStep[];
    error?: { message?: string; code?: string };
    promptFeedback?: { blockReason?: string };
    output_text?: string;
    finishReason?: string;
    usage?: GeminiUsage;
    usageMetadata?: GeminiUsage;
}

interface GeminiStreamEvent extends GeminiInteraction {
    type?: string;
    event_type?: string;
    interaction?: GeminiInteraction;
    interaction_id?: string;
    index?: number;
    step?: GeminiStep;
    delta?: {
        type?: string;
        text?: string;
        partial_arguments?: string;
        arguments_delta?: string;
        arguments?: string;
        args?: string;
    };
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

class InterruptedGeminiStreamError extends ProviderError {
    constructor(message: string) {
        super(message, { kind: 'bad_response' });
    }
}

/**
 * How much the model "thinks" before answering.
 */
export const THINKING_LEVELS = ['low', 'medium', 'high'];
export const DEFAULT_THINKING_LEVEL = 'low';

/**
 * Format a tool declaration for the Interactions API (`tools: [{ type: 'function', ... }]`).
 * Tools without parameters omit the parameters property.
 */
export function toGeminiDeclaration({ name, description, parameters }: ToolDeclaration) {
    const hasProperties = parameters && parameters.properties && Object.keys(parameters.properties).length > 0;
    return {
        type: 'function',
        name,
        description,
        ...(hasProperties ? { parameters } : {})
    };
}

/**
 * Google Gemini via the Interactions API (POST /v1beta/interactions with function calling & streaming).
 *
 * Multi-turn state is maintained server-side via `previous_interaction_id`, linking execution
 * steps and function calls without having to resend historical turns.
 */
export class GeminiProvider implements Provider {
    declare id: string;
    declare displayName: string;
    declare model: string;
    declare apiKey: string | undefined;
    declare baseUrl: string;
    declare retries: number;
    declare retryDelayMs: number;
    declare thinkingLevel: string;
    declare fetchImpl: typeof fetch;

    constructor({ apiKey, model, baseUrl, thinkingLevel, retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, fetchImpl = globalThis.fetch }: ProviderOptions = {}) {
        this.id = 'gemini';
        this.retries = retries;
        this.retryDelayMs = retryDelayMs;
        this.thinkingLevel = thinkingLevel === '' || (thinkingLevel && THINKING_LEVELS.includes(thinkingLevel))
            ? thinkingLevel
            : DEFAULT_THINKING_LEVEL;
        this.displayName = 'Gemini';
        this.apiKey = apiKey;
        this.model = (model || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
        this.baseUrl = (baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
        this.fetchImpl = fetchImpl;
    }

    #requireKey() {
        if (!this.apiKey) {
            throw new ProviderError('No Gemini API key is configured. Add one in settings.', { kind: 'auth' });
        }
    }

    #headers(): Record<string, string> {
        // Callers check for a configured key before building a request.
        return { 'x-goog-api-key': this.apiKey! };
    }

    #interactionsUrl() {
        return `${this.baseUrl}/interactions`;
    }

    #modelUrl() {
        return `${this.baseUrl}/models/${encodeURIComponent(this.model)}`;
    }

    /** Check that the key and model are valid without spending any tokens. */
    async testConnection({ signal }: { signal?: AbortSignal } = {}) {
        this.#requireKey();
        const info = await requestJson({
            fetchImpl: this.fetchImpl,
            providerName: this.displayName,
            url: this.#modelUrl(),
            method: 'GET',
            headers: this.#headers(),
            signal,
            model: this.model,
            timeoutMs: CONNECTION_TEST_TIMEOUT_MS
        });
        return { ok: true, message: `Connected to ${info.displayName || info.name || this.model}.` };
    }

    /**
     * Determine `input` and `previous_interaction_id` from the neutral message history.
     * If an earlier assistant message recorded a Gemini interactionId, we chain from it using
     * `previous_interaction_id` and send only subsequent messages (tool results or new user input).
     */
    #toInputAndPreviousId(messages: ChatMessage[]) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return { input: '', previousInteractionId: undefined };
        }

        const lastAssistantIdx = messages.findLastIndex(
            (m) => m.role === 'assistant' && m.raw?.provider === this.id && typeof m.raw?.interactionId === 'string'
        );

        let previousInteractionId;
        let pendingMessages;

        const lastAssistant = messages[lastAssistantIdx];
        if (lastAssistant?.role === 'assistant' && typeof lastAssistant.raw?.interactionId === 'string') {
            previousInteractionId = lastAssistant.raw.interactionId;
            pendingMessages = messages.slice(lastAssistantIdx + 1);
        } else {
            pendingMessages = messages;
        }

        // If single user message, send as plain string
        if (pendingMessages.length === 1 && pendingMessages[0].role === 'user') {
            return { input: pendingMessages[0].text, previousInteractionId };
        }

        // Convert pending messages into input items
        const input = [];
        for (const msg of pendingMessages) {
            if (msg.role === 'user') {
                const text = typeof msg.text === 'string' ? msg.text.trim() : '';
                if (text) {
                    input.push({
                        type: 'user_input',
                        content: [{ type: 'text', text }]
                    });
                }
            } else if (msg.role === 'assistant') {
                const text = typeof msg.text === 'string' ? msg.text.trim() : '';
                if (text) {
                    input.push({
                        type: 'model_output',
                        content: [{ type: 'text', text }]
                    });
                }
                for (const call of msg.toolCalls || []) {
                    input.push({
                        type: 'function_call',
                        id: call.providerCallId || call.id,
                        name: call.name,
                        arguments: call.args || {}
                    });
                }
            } else if (msg.role === 'tool') {
                const textResult = typeof msg.result === 'string'
                    ? msg.result
                    : JSON.stringify(msg.result);
                input.push({
                    type: 'function_result',
                    name: msg.name,
                    call_id: msg.providerCallId || msg.toolCallId,
                    result: [{ type: 'text', text: textResult || '{}' }]
                });
            }
        }

        return { input, previousInteractionId };
    }

    async chat({ system, messages, tools = [], signal, onTextDelta, onRetry }: ProviderChatRequest): Promise<ProviderChatReply> {
        this.#requireKey();

        const { input, previousInteractionId } = this.#toInputAndPreviousId(messages);
        const body = {
            model: this.model,
            input,
            ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
            ...(system ? { system_instruction: system } : {}),
            ...(tools.length > 0 ? { tools: tools.map(toGeminiDeclaration) } : {})
        };
        const options = { signal, onTextDelta, onRetry };

        const startedAt = Date.now();
        let data;
        try {
            data = await this.#generate(body, this.thinkingLevel, options);
        } catch (err) {
            // Older models do not accept thinking_level. Retry once without it
            // instead of failing the whole request.
            const thinkingRejected =
                this.thinkingLevel &&
                err instanceof ProviderError &&
                err.kind === 'bad_request' &&
                /thinking/i.test(err.message);
            if (!thinkingRejected) throw err;
            data = await this.#generate(body, '', options);
        }
        return this.#toReply(data, Date.now() - startedAt);
    }

    /** Call the API (streaming when `onTextDelta` is set) and return one interaction document. */
    async #generate(
        body: object,
        thinkingLevel: string,
        { signal, onTextDelta, onRetry }: Pick<ProviderChatRequest, 'signal' | 'onTextDelta' | 'onRetry'>
    ): Promise<GeminiInteraction> {
        const payload = thinkingLevel
            ? { ...body, generation_config: { thinking_level: thinkingLevel } }
            : body;

        const request = {
            fetchImpl: this.fetchImpl,
            providerName: this.displayName,
            url: this.#interactionsUrl(),
            headers: this.#headers(),
            body: payload,
            signal,
            model: this.model,
            retries: this.retries,
            retryDelayMs: this.retryDelayMs,
            onRetry
        };

        if (!onTextDelta) {
            return requestJson(request);
        }
        const response = await requestStream({
            ...request,
            headers: { ...this.#headers(), Accept: 'text/event-stream' },
            body: { ...payload, stream: true },
            timeoutMs: MODEL_REQUEST_TIMEOUT_MS
        });
        let emittedText = false;
        try {
            return await this.#readStream(response, signal, (text) => {
                emittedText ||= Boolean(text);
                onTextDelta(text);
            });
        } catch (err) {
            if (!(err instanceof InterruptedGeminiStreamError) || emittedText || signal?.aborted || this.retries < 1) {
                throw err;
            }
            // Resend the same model request, including any results from tools that already ran.
            onRetry?.({ attempt: 1, retries: 1, delayMs: 0, reason: MESSAGES.geminiStreamInterrupted });
            return requestJson({ ...request, retries: 0, timeoutMs: MODEL_REQUEST_TIMEOUT_MS });
        }
    }

    /** Read the SSE stream into an interaction-shaped document. */
    async #readStream(response: Response, signal: AbortSignal | undefined, onTextDelta: (text: string) => void): Promise<GeminiInteraction> {
        if (!isStreamable(response)) return readJsonBody(response, this.displayName);

        let completedInteraction: GeminiInteraction | undefined;
        let lastInteractionId: string | null = null;
        const accumulatedSteps: GeminiStep[] = [];
        let currentStep: (GeminiStep & { index: number }) | null = null;

        await readSse(response, { signal, providerName: this.displayName }, (payload: string) => {
            const data: GeminiStreamEvent = parseStreamJson(payload, this.displayName);
            const eventType = data.event_type || data.type;

            if (eventType === 'error') {
                const { code, message } = data.error || {};
                const description = MESSAGES.geminiStreamError(message || code);
                if (code === 'gateway_timeout') throw new InterruptedGeminiStreamError(description);
                throw new ProviderError(description, { kind: 'bad_response' });
            }

            if (data.interaction?.id) lastInteractionId = data.interaction.id;
            if (eventType === 'interaction.completed' && data.interaction) {
                completedInteraction = data.interaction;
            } else if (data.id && Array.isArray(data.steps)) {
                completedInteraction = data;
            }

            if (data.interaction_id) lastInteractionId = data.interaction_id;

            if (eventType === 'step.start') {
                currentStep = {
                    ...(data.step || {}),
                    index: data.index ?? accumulatedSteps.length
                };
                if (!currentStep.type && data.step?.type) currentStep.type = data.step.type;
                if (data.step?.arguments) {
                    currentStep.arguments = typeof data.step.arguments === 'object'
                        ? JSON.stringify(data.step.arguments)
                        : String(data.step.arguments);
                } else if (data.step?.args) {
                    currentStep.arguments = typeof data.step.args === 'object'
                        ? JSON.stringify(data.step.args)
                        : String(data.step.args);
                }
                accumulatedSteps[currentStep.index] = currentStep;
            }

            if (eventType === 'step.delta') {
                const delta = data.delta;
                if (delta) {
                    if (typeof delta.text === 'string' && delta.type !== 'thought') {
                        onTextDelta(delta.text);
                        const idx = data.index ?? (currentStep ? currentStep.index : 0);
                        if (!accumulatedSteps[idx]) {
                            accumulatedSteps[idx] = { type: 'model_output', content: [{ type: 'text', text: '' }] };
                        }
                        const step = accumulatedSteps[idx];
                        if (typeof step.content === 'string') {
                            step.content += delta.text;
                        } else if (Array.isArray(step.content)) {
                            const lastPart = step.content[step.content.length - 1];
                            if (lastPart && lastPart.type === 'text') {
                                lastPart.text += delta.text;
                            } else {
                                step.content.push({ type: 'text', text: delta.text });
                            }
                        } else {
                            step.content = [{ type: 'text', text: delta.text }];
                        }
                    }
                    const argsDelta = delta.partial_arguments
                        || delta.arguments_delta
                        || delta.arguments
                        || delta.args
                        || (delta.type === 'arguments' && typeof delta.text === 'string' ? delta.text : undefined);
                    if (argsDelta) {
                        const idx = data.index ?? (currentStep ? currentStep.index : 0);
                        if (!accumulatedSteps[idx]) {
                            accumulatedSteps[idx] = { type: 'function_call', arguments: '' };
                        }
                        const step = accumulatedSteps[idx];
                        if (typeof step.arguments === 'string') {
                            step.arguments += argsDelta;
                        } else if (step.arguments && typeof step.arguments === 'object') {
                            step.arguments = JSON.stringify(step.arguments);
                        } else {
                            step.arguments = argsDelta;
                        }
                    }
                }
            }

            if (eventType === 'step.stop') {
                currentStep = null;
            }
        });

        if (!completedInteraction) {
            throw new InterruptedGeminiStreamError(MESSAGES.geminiStreamIncomplete);
        }
        return {
            ...completedInteraction,
            id: completedInteraction.id || lastInteractionId,
            status: completedInteraction.status || 'completed',
            steps: completedInteraction.steps?.length ? completedInteraction.steps : accumulatedSteps.filter(Boolean)
        };
    }

    #toReply(data: GeminiInteraction, elapsedMs: number): ProviderChatReply {
        if (!data || typeof data !== 'object') {
            throw new ProviderError('Gemini returned no answer (empty response).', { kind: 'bad_response' });
        }

        if (data.promptFeedback?.blockReason) {
            throw new ProviderError(`Gemini returned no answer (${data.promptFeedback.blockReason}).`, { kind: 'bad_response' });
        }

        if (data.status === 'failed') {
            const reason = data.error?.message || data.status;
            throw new ProviderError(`Gemini returned no answer (${reason}).`, { kind: 'bad_response' });
        }

        const steps = Array.isArray(data.steps) ? data.steps : [];

        const textParts = [];
        const toolCalls = [];

        for (const [index, step] of steps.entries()) {
            if (!step || typeof step !== 'object') continue;

            if (step.type === 'model_output') {
                if (typeof step.content === 'string') {
                    textParts.push(step.content);
                } else if (Array.isArray(step.content)) {
                    for (const part of step.content) {
                        if (typeof part.text === 'string' && !part.thought && part.type !== 'thought') {
                            textParts.push(part.text);
                        }
                    }
                } else if (typeof step.text === 'string') {
                    textParts.push(step.text);
                }
            } else if (step.type === 'function_call' || step.type === 'tool_call') {
                let args = {};
                const rawArgs = step.arguments ?? step.args;
                if (typeof rawArgs === 'string' && rawArgs.trim()) {
                    try { args = JSON.parse(rawArgs); } catch { args = {}; }
                } else if (rawArgs && typeof rawArgs === 'object') {
                    args = rawArgs;
                }
                toolCalls.push({
                    id: step.id || step.call_id || `gemini-call-${Date.now()}-${index}`,
                    providerCallId: step.id || step.call_id,
                    name: step.name,
                    args
                });
            }
        }

        let text = textParts.join('').trim();
        if (!text && typeof data.output_text === 'string') {
            text = data.output_text.trim();
        }

        if (!text && toolCalls.length === 0 && data.status !== 'completed' && data.status !== 'requires_action') {
            const reason = data.finishReason || data.status || 'no content';
            throw new ProviderError(`Gemini returned no answer (${reason}).`, { kind: 'bad_response' });
        }

        const usage = data.usage || data.usageMetadata || {};
        return {
            text,
            toolCalls,
            raw: { provider: this.id, interactionId: data.id, steps },
            stats: {
                ms: elapsedMs,
                thinkingLevel: this.thinkingLevel || 'default',
                promptTokens: usage.total_input_tokens ?? usage.promptTokenCount ?? usage.input_tokens,
                thoughtTokens: usage.total_thought_tokens ?? usage.thoughtsTokenCount ?? usage.thought_tokens,
                outputTokens: usage.total_output_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens
            }
        };
    }
}

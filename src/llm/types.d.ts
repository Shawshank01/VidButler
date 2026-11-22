export interface ToolCall {
    id: string;
    name: string;
    /** Still unvalidated when returned by a provider. */
    args?: unknown;
    providerCallId?: string;
}

export type ChatMessage =
    | { role: 'user'; text: string }
    | { role: 'assistant'; text: string; toolCalls?: ToolCall[]; raw?: Record<string, unknown> }
    | { role: 'tool'; toolCallId: string; providerCallId?: string; name: string; result: Record<string, unknown> | string };

export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: object;
        required?: string[];
    };
}

export interface RetryInfo {
    attempt: number;
    retries: number;
    delayMs: number;
    reason: string;
}

export interface ProviderChatRequest {
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDeclaration[];
    signal?: AbortSignal;
    onTextDelta?: (text: string) => void;
    onRetry?: (info: RetryInfo) => void;
}

export interface ModelCallStats {
    ms: number;
    thinkingLevel: string;
    promptTokens?: number;
    thoughtTokens?: number;
    outputTokens?: number;
}

export interface ProviderChatReply {
    text: string;
    toolCalls: (Omit<ToolCall, 'name'> & { name?: string })[];
    raw?: Record<string, unknown> | null;
    stats?: ModelCallStats;
}

export interface ChatProvider {
    id: string;
    displayName?: string;
    chat(request: ProviderChatRequest): Promise<ProviderChatReply>;
}

export interface ProviderOptions {
    type?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    retries?: number;
    retryDelayMs?: number;
    thinkingLevel?: string;
    reasoningEffort?: string;
}

export interface Provider extends ChatProvider {
    model?: string;
    testConnection(options?: { signal?: AbortSignal }): Promise<{ ok: boolean; message: string }>;
}

export interface ConfirmationRequest {
    name: string;
    description: string;
    risk: 'low' | 'high';
    /** Why extra care is needed, when that is not obvious from the risk level. */
    reason?: string;
    args: Record<string, unknown>;
}

export type AgentEvent =
    | { type: 'assistant_text'; text: string }
    | { type: 'assistant_delta'; text: string }
    | ({ type: 'retrying'; provider: string } & RetryInfo)
    | (Omit<ConfirmationRequest, 'reason'> & { type: 'tool_start'; id: string })
    | { type: 'tool_result'; id: string; name: string; ok: boolean; cancelled: boolean; result: Record<string, unknown> }
    | { type: 'tool_denied'; id: string; name: string; description: string }
    | ({ type: 'model_call'; step: number } & ModelCallStats);

export type AiEvent =
    | Exclude<AgentEvent, { type: 'model_call' }>
    | { type: 'progress'; text: string }
    | (ConfirmationRequest & { type: 'confirm_request'; requestId: string });

export interface AiContext {
    downloadFolder?: string;
    browser?: string;
    /** Full proxy URL, or empty. */
    proxy?: string;
}

export type AiSendResult =
    | { ok: true; text: string; stoppedBecause: 'done' | 'max_steps' | 'aborted'; steps: number }
    | { ok: false; error: { kind: string; message: string } };

type ThinkingLevel = 'low' | 'medium' | 'high';
type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

interface AiProviderOptions {
    model?: string;
    baseUrl?: string;
    thinkingLevel?: ThinkingLevel;
    reasoningEffort?: ReasoningEffort;
}

interface AiProviderSnapshot {
    label: string;
    needsApiKey: boolean;
    editableBaseUrl: boolean;
    supportsThinkingLevel: boolean;
    supportsReasoningEffort: boolean;
    /** Empty when this provider has no such setting. */
    thinkingLevel: ThinkingLevel | '';
    reasoningEffort: ReasoningEffort | '';
    model: string;
    baseUrl: string;
    defaultModel: string;
    defaultBaseUrl: string;
    hasApiKey: boolean;
}

export interface AiSettingsSnapshot {
    mode: 'classic' | 'ai';
    provider: string;
    confirmMode: 'always' | 'risky' | 'never';
    /** False when API keys can only be kept in memory for this session. */
    keyStorageSecure: boolean;
    providers: Record<string, AiProviderSnapshot>;
}

export interface AiSettingsUpdate {
    mode?: 'classic' | 'ai';
    provider?: string;
    confirmMode?: string;
    providerConfig?: AiProviderOptions & { type: string };
}

export interface AiTestConnectionOptions extends AiProviderOptions {
    type?: string;
    apiKey?: string;
}

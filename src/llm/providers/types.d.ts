import type { requestJson } from './http.js';

export type ProviderHttpRequest = Parameters<typeof requestJson>[0];

export interface CompletionToolCall {
    id?: string;
    index?: number;
    name?: string;
    arguments?: unknown;
    function?: { name?: string; arguments?: unknown; args?: unknown };
}

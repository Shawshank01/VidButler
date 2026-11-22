import { promises as fs } from 'fs';
import { ProviderError } from './errors.js';
import { ValidationError } from './validate.ts';
import { getTool, getRisk, getToolDeclarations, TOOL_NAMES } from './tool-registry.ts';
import { cancelCurrentTask } from '../core/tools.ts';
import { MAX_AGENT_STEPS, MAX_TOOL_RESULT_CHARS, MAX_TRANSCRIPT_RESULT_CHARS } from './limits.js';
import { MESSAGES } from './messages.js';
import { isForeignUrl } from './provenance.js';
import { PROVIDER_TYPES } from './providers/index.ts';
import { writeTranscriptNotes } from './transcript-summary.ts';
import { normalizeToolArgs } from './agent-tool-args.ts';
import type { AgentEvent, ChatMessage, ChatProvider, ConfirmationRequest, RetryInfo, ToolCall } from './types.js';
import type { ToolContext } from './tool-registry.ts';
import type { ToolResult } from './tools/common.ts';

type ConfirmMode = 'always' | 'risky' | 'never';
type Confirm = (request: ConfirmationRequest & { id: string }) => Promise<boolean> | boolean;
type Tool = NonNullable<ReturnType<typeof getTool>>;
type CookieAccessFailure = { browser: string; denied: boolean };

type AgentToolResult = ToolResult & { macCookieAccess?: CookieAccessFailure };

interface ToolExecutionOptions {
    ctx: ToolContext;
    history: ChatMessage[];
    onEvent?: (event: AgentEvent) => void;
    confirm?: Confirm;
    confirmMode?: ConfirmMode;
    signal?: AbortSignal;
}

interface AgentOptions extends ToolExecutionOptions {
    provider: ChatProvider;
    system: string;
    userText: string;
    maxSteps?: number;
    maxResultChars?: number;
}

interface AgentReply {
    text: string;
    steps: number;
    stoppedBecause: 'done' | 'max_steps' | 'aborted';
}

const noop = () => { };
const cookieBrowserLabels: Record<string, string> = { brave: 'Brave', chrome: 'Chrome', firefox: 'Firefox', safari: 'Safari' };
const cookieTools = new Set<string>([
    TOOL_NAMES.getOnlineVideoInfo, TOOL_NAMES.listFormats, TOOL_NAMES.listSubtitles, TOOL_NAMES.getVideoTranscript,
    TOOL_NAMES.downloadVideo, TOOL_NAMES.downloadAudio, TOOL_NAMES.downloadSection, TOOL_NAMES.downloadThumbnail,
    TOOL_NAMES.downloadSubtitles, TOOL_NAMES.downloadWithHardsub
]);

function macCookieAccessFailure(tool: string, result: AgentToolResult, browser?: string): CookieAccessFailure | null {
    if (process.platform !== 'darwin' || result.ok !== false || result.cancelled || !cookieTools.has(tool)) return null;
    if (!browser || !Object.hasOwn(cookieBrowserLabels, browser)) return null;
    const errors = `${result.error || ''}\n${result.output || ''}`.split('\n')
        .map((line) => line.trim().toLowerCase().replace(/^could not list subtitles: /, ''))
        .filter((line) => line.startsWith('error:'));
    const denied = errors.some((line) => /operation not permitted|permission denied/.test(line)
        && (line.startsWith(`error: cannot read ${browser} cookies:`)
            || line.startsWith(`error: could not read ${browser} cookies:`)
            || /^error: (?:cannot|could not|unable to) (?:read|open|copy) (?:the )?cook(?:ie|ies) database\b/.test(line)));
    const notFound = errors.some((line) => line.startsWith(`error: could not find ${browser} cookies database`));
    return denied || notFound ? { browser: cookieBrowserLabels[browser], denied } : null;
}

/** Keep tool results small enough for the model's context (small local models especially). */
export function shapeResult(result: Record<string, unknown>, maxChars: number): Record<string, unknown> {
    let json = JSON.stringify(result);
    if (json.length <= maxChars) return result;

    const copy: Record<string, unknown> = { ...result, truncated: true };
    if (typeof copy.output === 'string') {
        const overflow = json.length - maxChars + 100;
        const keep = Math.max(400, copy.output.length - overflow);
        const head = copy.output.slice(0, Math.floor(keep * 0.6));
        const tail = copy.output.slice(copy.output.length - Math.floor(keep * 0.4));
        copy.output = `${head}\n... [output truncated] ...\n${tail}`;
        json = JSON.stringify(copy);
        if (json.length <= maxChars) return copy;
    }

    // Fallback: keep a prefix of the JSON. Re-serialising escapes quotes, so shrink until it fits.
    let keep = Math.max(200, maxChars - 100);
    let shaped = { ok: result.ok, truncated: true, partial_json: json.slice(0, keep) };
    while (JSON.stringify(shaped).length > maxChars && keep > 50) {
        keep = Math.floor(keep * 0.8);
        shaped = { ok: result.ok, truncated: true, partial_json: json.slice(0, keep) };
    }
    return shaped;
}

function needsConfirmation(confirmMode: ConfirmMode, risk: ConfirmationRequest['risk']) {
    if (confirmMode === 'never') return false;
    if (confirmMode === 'always') return true;
    return risk === 'high';
}

/**
 * Run one user turn through the agent loop.
 *
 * The loop calls the model, executes any tool calls it requests (one at a time, because the
 * app runs a single yt-dlp/ffmpeg task at once), feeds the results back, and repeats until the
 * model answers in plain text or `maxSteps` model calls have been made.
 */
export async function runAgent({
    provider,
    system,
    history,
    userText,
    ctx,
    onEvent = noop,
    confirm,
    confirmMode = 'risky',
    maxSteps = MAX_AGENT_STEPS,
    maxResultChars,
    signal
}: AgentOptions): Promise<AgentReply> {
    const tools = getToolDeclarations();
    const onRetry = (info: RetryInfo) => onEvent({ type: 'retrying', provider: provider.displayName || provider.id, ...info });
    const toolContext: ToolContext = {
        ...ctx,
        signal,
        transcriptInputChars: PROVIDER_TYPES[provider.id]?.transcriptInputChars,
        summarizeTranscriptPart: (part) => writeTranscriptNotes(provider, {
            ...part, request: userText, signal, onRetry
        })
    };
    history.push({ role: 'user', text: userText });

    let steps = 0;
    let retriedEmpty = false;
    let cookieGuidance = '';
    const withCookieGuidance = (text: string) => [text, cookieGuidance].filter(Boolean).join('\n\n');
    const finishAborted = (): AgentReply => {
        cancelCurrentTask();
        const text = MESSAGES.stopped;
        history.push({ role: 'assistant', text });
        onEvent({ type: 'assistant_text', text });
        return { text, steps, stoppedBecause: 'aborted' };
    };

    while (steps < maxSteps) {
        if (signal?.aborted) return finishAborted();

        steps += 1;
        let reply;
        let streamedText = '';
        try {
            reply = await provider.chat({
                system,
                messages: history,
                tools,
                signal,
                onTextDelta: (text) => {
                    streamedText += text;
                    onEvent({ type: 'assistant_delta', text });
                },
                onRetry
            });
        } catch (err) {
            if (err instanceof ProviderError && err.kind === 'aborted') return finishAborted();
            throw err;
        }

        if (reply.stats) onEvent({ type: 'model_call', step: steps, ...reply.stats });

        const toolCalls = reply.toolCalls.filter((call): call is ToolCall => Boolean(call.name));
        const replyText = reply.text || streamedText;

        if (toolCalls.length === 0 && !replyText && steps < maxSteps && !retriedEmpty) {
            retriedEmpty = true;
            history.push({
                role: 'assistant',
                text: '',
                toolCalls: [],
                ...(reply.raw ? { raw: reply.raw } : {})
            });
            history.push({
                role: 'user',
                text: MESSAGES.emptyAnswerRetryPrompt
            });
            continue;
        }

        const assistant: Extract<ChatMessage, { role: 'assistant' }> = {
            role: 'assistant',
            text: replyText,
            toolCalls,
            ...(reply.raw ? { raw: reply.raw } : {})
        };
        history.push(assistant);

        if (toolCalls.length === 0) {
            const text = withCookieGuidance(replyText || (cookieGuidance ? '' : MESSAGES.emptyAnswer));
            assistant.text = text;
            onEvent({ type: 'assistant_text', text });
            return { text, steps, stoppedBecause: 'done' };
        }

        if (replyText) onEvent({ type: 'assistant_text', text: replyText });

        let cookieFailure: CookieAccessFailure | undefined;
        let otherResult = false;
        for (const call of toolCalls) {
            let result: AgentToolResult;

            if (signal?.aborted) {
                result = { ok: false, error: MESSAGES.cancelledByUser };
            } else {
                result = await executeToolCall(call, { ctx: toolContext, history, onEvent, confirm, confirmMode, signal });
            }
            cookieFailure ??= result.macCookieAccess;
            otherResult ||= !result.macCookieAccess;

            const resultLimit = call.name === TOOL_NAMES.getVideoTranscript && result.ok
                ? MAX_TRANSCRIPT_RESULT_CHARS
                : MAX_TOOL_RESULT_CHARS;
            history.push({
                role: 'tool',
                toolCallId: call.id,
                providerCallId: call.providerCallId,
                name: call.name,
                result: shapeResult(result, maxResultChars ?? resultLimit)
            });
        }
        if (signal?.aborted) return finishAborted();
        if (cookieFailure) {
            cookieGuidance = MESSAGES.macBrowserCookieAccess(cookieFailure.browser, cookieFailure.denied);
            if (otherResult) continue;
            const text = cookieGuidance;
            history.push({ role: 'assistant', text });
            onEvent({ type: 'assistant_text', text });
            return { text, steps, stoppedBecause: 'done' };
        }
    }

    const text = withCookieGuidance(MESSAGES.maxSteps(maxSteps));
    history.push({ role: 'assistant', text });
    onEvent({ type: 'assistant_text', text });
    return { text, steps, stoppedBecause: 'max_steps' };
}

/**
 * The risk of this call. A URL the user never typed (it came from a web page the model read) is
 * treated as high risk, so it needs confirmation in the default "risky" mode.
 */
function assessRisk(tool: Tool, args: Record<string, unknown>, history: ChatMessage[]): Pick<ConfirmationRequest, 'risk' | 'reason'> {
    const risk = getRisk(tool, args);
    if (typeof args.url === 'string' && isForeignUrl(history, args.url)) {
        return { risk: 'high', reason: MESSAGES.urlNotFromUser };
    }
    return { risk, reason: undefined };
}

async function executeToolCall(
    call: ToolCall,
    { ctx, history, onEvent = noop, confirm, confirmMode = 'risky', signal }: ToolExecutionOptions
): Promise<AgentToolResult> {
    const tool = getTool(call.name);
    if (!tool) {
        return { ok: false, error: `Unknown tool "${call.name}".` };
    }

    const args = await normalizeToolArgs(call, tool, history, ctx);

    if (call.name === TOOL_NAMES.deleteFiles && (!Array.isArray(args.files) || args.files.length === 0)) {
        if (ctx?.downloadFolder) {
            try {
                const entries = await fs.readdir(ctx.downloadFolder, { withFileTypes: true });
                const diskFiles = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));
                if (diskFiles.length === 0) {
                    return {
                        ok: true,
                        message: 'There are no files in the download folder to delete.',
                        deleted: [],
                        skipped: []
                    };
                }
            } catch { /* ignore read error */ }
        }
        return {
            ok: false,
            error: 'Please specify which files you want to delete (e.g. from list_downloads).'
        };
    }

    const { risk, reason } = assessRisk(tool, args, history);
    const description = safeDescribe(tool, args);

    if (needsConfirmation(confirmMode, risk)) {
        const approved = await askConfirmation(confirm, {
            id: call.id, name: tool.name, args, description, risk, reason
        });
        if (!approved) {
            onEvent({ type: 'tool_denied', id: call.id, name: tool.name, description });
            return { ok: false, error: MESSAGES.declinedByUser };
        }
    }

    if (signal?.aborted) return { ok: false, error: MESSAGES.cancelledByUser };

    onEvent({ type: 'tool_start', id: call.id, name: tool.name, args, description, risk });
    let result: AgentToolResult;
    let providerError;
    try {
        result = await tool.run(args, ctx);
    } catch (err) {
        if (signal?.aborted) {
            result = { ok: false, cancelled: true, error: MESSAGES.cancelledByUser };
        } else if (err instanceof ProviderError) {
            providerError = err;
            result = { ok: false, error: MESSAGES.transcriptSummaryFailed };
        } else {
            result = { ok: false, error: err instanceof ValidationError ? err.message : `Tool failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
    const macCookieAccess = macCookieAccessFailure(tool.name, result, ctx?.browser);
    if (macCookieAccess) {
        result = { ok: false, error: MESSAGES.browserCookiesUnreadable(macCookieAccess.browser), macCookieAccess };
    }
    onEvent({
        type: 'tool_result',
        id: call.id,
        name: tool.name,
        ok: result.ok !== false,
        cancelled: result.cancelled === true,
        result
    });
    if (providerError) throw providerError;
    return result;
}

/** Ask the user; a missing callback or a throwing callback counts as "no". */
async function askConfirmation(confirm: Confirm | undefined, request: Parameters<Confirm>[0]) {
    if (!confirm) return false;
    try {
        return (await confirm(request)) === true;
    } catch {
        return false;
    }
}

function safeDescribe(tool: Tool, args: Record<string, unknown>) {
    try {
        return tool.describe(args);
    } catch {
        return tool.name;
    }
}

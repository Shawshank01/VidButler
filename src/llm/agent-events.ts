import type { AgentEvent, AiEvent } from './types.js';

/**
 * Build the `onEvent` handler for one agent run: diagnostics go to `log` (never message text or keys),
 * and events the user should see are forwarded to `emit`.
 *
 */
export function createEventHandler({ log, emit }: {
    log: (line: string) => void;
    emit: (event: AiEvent) => void;
}) {
    return (event: AgentEvent) => {
        switch (event.type) {
            case 'model_call':
                // Timing and token counts only; not shown in the chat.
                log(
                    `model call ${event.step}: ${event.ms} ms, thinking=${event.thinkingLevel}, ` +
                    `tokens prompt=${event.promptTokens ?? '?'} thought=${event.thoughtTokens ?? '?'} output=${event.outputTokens ?? '?'}`
                );
                return;
            case 'retrying':
                log(`retrying after ${event.reason}: attempt ${event.attempt} of ${event.retries}, waiting ${event.delayMs} ms`);
                emit(event);
                return;
            default:
                log(`event: ${event.type}${'name' in event && event.name ? ` ${event.name}` : ''}${'ok' in event && event.ok === false ? ' (failed)' : ''}`);
                emit(event);
        }
    };
}

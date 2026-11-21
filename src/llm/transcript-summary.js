import { ProviderError } from './errors.js';
import { MAX_TRANSCRIPT_INPUT_CHARS, MAX_TRANSCRIPT_NOTE_TARGET_CHARS } from './limits.js';
import { MESSAGES } from './messages.js';

/** Combine consecutive sections into batches while keeping their original timestamp ranges. */
function groupSections(sections, maxChars) {
    const groups = [];
    for (const section of sections) {
        const last = groups.at(-1);
        if (last && last.text.length + 2 + section.text.length <= maxChars) {
            last.text += '\n\n' + section.text;
            last.through = section.through;
        } else {
            groups.push({ ...section });
        }
    }
    return groups;
}

/** Get intermediate notes through the same provider, using a fresh request with no tools. */
export async function writeTranscriptNotes(provider, { section, sourceType, request, targetChars, maxChars, signal, onRetry }) {
    for (const budget of [targetChars, Math.floor(targetChars / 2)]) {
        signal?.throwIfAborted();
        const reply = await provider.chat({
            system: MESSAGES.transcriptNotesSystem(budget),
            messages: [{ role: 'user', text: JSON.stringify({ request, sourceType, ...section }) }],
            tools: [],
            signal,
            onRetry
        });
        signal?.throwIfAborted();
        const notes = reply.text?.replace(/[\p{Cc}\p{Cs}]/gu, (char) => char === '\n' ? char : ' ').trim();
        if (notes && notes.length <= maxChars && !reply.toolCalls?.length) return notes;
    }
    throw new ProviderError(MESSAGES.transcriptSummaryFailed, { kind: 'bad_response' });
}

/** Pass short transcripts through whole and reduce longer ones in chronological batches. */
export async function prepareTranscript(sections, {
    transcriptInputChars = MAX_TRANSCRIPT_INPUT_CHARS,
    summarizeTranscriptPart,
    onProgress,
    signal
}) {
    let groups = groupSections(sections, transcriptInputChars);
    if (groups.length === 1) return { transcript: groups[0].text };
    if (!summarizeTranscriptPart) throw new ProviderError(MESSAGES.transcriptSummaryFailed, { kind: 'bad_response' });

    // Bound each note so at least two can always fit in the next round.
    const maxNoteChars = Math.floor(transcriptInputChars / 4);
    const targetChars = Math.min(MAX_TRANSCRIPT_NOTE_TARGET_CHARS, Math.floor(maxNoteChars * 2 / 3));
    let sourceType = 'captions';
    while (groups.length > 1) {
        const notes = [];
        for (const [index, section] of groups.entries()) {
            signal?.throwIfAborted();
            const progress = sourceType === 'captions' ? MESSAGES.transcriptChunkProgress : MESSAGES.transcriptMergeProgress;
            onProgress?.(progress(index + 1, groups.length));
            const label = `[${section.from}–${section.through}]\n`;
            const note = await summarizeTranscriptPart({
                section, sourceType, targetChars, maxChars: maxNoteChars - label.length
            });
            notes.push({ from: section.from, through: section.through, text: label + note });
        }
        groups = groupSections(notes, transcriptInputChars);
        sourceType = 'notes';
    }
    return { summary_notes: groups[0].text };
}

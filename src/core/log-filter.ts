import { StringDecoder } from 'string_decoder';
import type { ChildProcessWithoutNullStreams } from 'child_process';

import classification from '../log-classification.cjs';

export const { isProgressLine, shouldSuppressLogLine } = classification;

// Line buffer wrapper to safely handle chunked stream data and filter noise
class LineStreamFilter {
    declare buffer: string;
    declare onLine: (line: string) => void;
    declare decoder: StringDecoder;
    declare suppressNoise: boolean;

    constructor(onLine: (line: string) => void, suppressNoise: boolean) {
        this.buffer = '';
        this.onLine = onLine;
        // Keeps a multi-byte character (CJK titles, emoji) that is split across two chunks intact.
        this.decoder = new StringDecoder('utf8');
        this.suppressNoise = suppressNoise;
    }

    push(chunk: Buffer | string) {
        this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
        const lines = this.buffer.split(/\r\n|\r|\n/);
        this.buffer = lines.pop() ?? ''; // Keep incomplete trailing fragment in buffer

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && (!this.suppressNoise || !shouldSuppressLogLine(trimmed))) {
                this.onLine(line);
            }
        }
    }

    flush() {
        this.buffer += this.decoder.end();
        if (this.buffer.length > 0) {
            const trimmed = this.buffer.trim();
            if (trimmed.length > 0 && (!this.suppressNoise || !shouldSuppressLogLine(trimmed))) {
                this.onLine(this.buffer);
            }
            this.buffer = '';
        }
    }
}

// Helper to attach stdout and stderr line-stream filters to a child process
export function attachLineStreamFilters(
    child: Pick<ChildProcessWithoutNullStreams, 'stdout' | 'stderr'>,
    onLine: (line: string) => void,
    { suppressNoise = true } = {}
) {
    const stdoutFilter = new LineStreamFilter(onLine, suppressNoise);
    const stderrFilter = new LineStreamFilter(onLine, suppressNoise);

    child.stdout.on('data', (data) => stdoutFilter.push(data));
    child.stderr.on('data', (data) => stderrFilter.push(data));

    return () => {
        stdoutFilter.flush();
        stderrFilter.flush();
    };
}

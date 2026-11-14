import { StringDecoder } from 'string_decoder';

import classification from '../log-classification.cjs';

export const { isProgressLine, shouldSuppressLogLine } = classification;

// Line buffer wrapper to safely handle chunked stream data and filter noise
class LineStreamFilter {
    constructor(onLine) {
        this.buffer = '';
        this.onLine = onLine;
        // Keeps a multi-byte character (CJK titles, emoji) that is split across two chunks intact.
        this.decoder = new StringDecoder('utf8');
    }

    push(chunk) {
        this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
        const lines = this.buffer.split(/\r\n|\r|\n/);
        this.buffer = lines.pop(); // Keep incomplete trailing fragment in buffer

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && !shouldSuppressLogLine(trimmed)) {
                this.onLine(line);
            }
        }
    }

    flush() {
        this.buffer += this.decoder.end();
        if (this.buffer.length > 0) {
            const trimmed = this.buffer.trim();
            if (trimmed.length > 0 && !shouldSuppressLogLine(trimmed)) {
                this.onLine(this.buffer);
            }
            this.buffer = '';
        }
    }
}

// Helper to attach stdout and stderr line-stream filters to a child process
export function attachLineStreamFilters(child, onLine) {
    const stdoutFilter = new LineStreamFilter(onLine);
    const stderrFilter = new LineStreamFilter(onLine);

    child.stdout.on('data', (data) => stdoutFilter.push(data));
    child.stderr.on('data', (data) => stderrFilter.push(data));

    return () => {
        stdoutFilter.flush();
        stderrFilter.flush();
    };
}

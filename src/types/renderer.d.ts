interface Window {
    showUpdateModal: typeof showUpdateModal;
    LogClassification: {
        isProgressLine(line: string): boolean;
        isExtractorOrNoiseLine(line: string): boolean;
        shouldSuppressLogLine(line: string): boolean;
    };
    SharedContext: {
        getProxyUrl(): string;
    };
    MarkdownLite?: {
        isSafeUrl(url: string): boolean;
        render(text: string, doc: Document, options?: { onLink?: (url: string) => void }): DocumentFragment;
    };
}

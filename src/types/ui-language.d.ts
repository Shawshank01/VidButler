export type UiTranslator = (key: string, values?: Record<string, unknown>) => string;

declare global {
    interface Window {
        UiCatalog: typeof import('../i18n/catalog.cjs');
        UiLanguage: {
            text: UiTranslator;
            label(element: HTMLElement, key: string): void;
            restore(settings: Record<string, unknown>): void;
        };
    }
}

(function () {
    const catalog = window.UiCatalog;
    const picker = document.querySelector<HTMLSelectElement>('#uiLanguage');
    let systemLanguage = catalog.resolveLanguage(navigator.languages);
    let language = systemLanguage;
    let preference = 'auto';

    function text(key: string, values?: Record<string, unknown>) {
        return catalog.translate(language, key, values);
    }

    function apply(nextPreference: string) {
        preference = catalog.isPreference(nextPreference) ? nextPreference : 'auto';
        language = preference === 'auto' ? systemLanguage : preference;
        document.documentElement.lang = language;
        if (picker) picker.value = preference;

        document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
            element.textContent = text(element.dataset.i18n!);
        });
        for (const attribute of ['aria-label', 'placeholder', 'title']) {
            document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`).forEach((element) => {
                element.setAttribute(attribute, text(element.getAttribute(`data-i18n-${attribute}`)!));
            });
        }
        document.dispatchEvent(new Event('ui-language-changed'));
    }

    function label(element: HTMLElement, key: string) {
        element.dataset.i18n = key;
        element.textContent = text(key);
    }

    window.UiLanguage = {
        text,
        label,
        restore(settings) {
            systemLanguage = catalog.resolveLanguage([settings.systemLanguage, systemLanguage]);
            apply(typeof settings.uiLanguage === 'string' ? settings.uiLanguage : 'auto');
            if (picker) picker.disabled = !window.electronAPI;
        }
    };

    if (!picker) return;
    for (const [code, name] of Object.entries(catalog.languages)) {
        const option = new Option(name, code);
        option.lang = code;
        picker.add(option);
    }
    apply(preference);
    if (!window.electronAPI) return;
    picker.disabled = true;

    picker.addEventListener('change', async () => {
        const next = picker.value;
        picker.disabled = true;
        try {
            await window.electronAPI.setSettings({ uiLanguage: next });
            apply(next);
        } catch (error) {
            picker.value = preference;
            console.error('Could not save the UI language:', error);
            window.alert(text('languageSaveFailed'));
        } finally {
            picker.disabled = false;
        }
    });
})();

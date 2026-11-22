// Classic / AI mode switch, chat panel, AI settings dialog and action confirmation dialog.
//
// Everything that comes from the model is rendered with textContent (never innerHTML), so model
// or website text can never inject markup. API keys are write-only here: the main process only
// tells us whether a key exists.
(function () {
    'use strict';

    type AiEvent = import('./llm/types.js').AiEvent;
    type AiFailure = Extract<import('./llm/types.js').AiSendResult, { ok: false }>['error'];
    type AiTestConnectionOptions = import('./llm/types.js').AiTestConnectionOptions;
    type ProviderConfig = NonNullable<import('./llm/types.js').AiSettingsUpdate['providerConfig']>;
    type Mode = AiSettings['mode'];
    type MessageKind = 'user' | 'assistant';
    type ToolStep = { el: HTMLDivElement; title: HTMLDivElement; detail: HTMLDivElement; description: string };

    const api = window.electronAPI && window.electronAPI.ai;

    function $<T extends HTMLElement = HTMLElement>(id: string): T {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Missing AI control: ${id}`);
        return element as T;
    }

    if (!api) {
        // Preload did not expose the AI API; keep the app in classic mode with no AI controls.
        const switchEl = document.querySelector<HTMLElement>('.mode-switch');
        if (switchEl) switchEl.style.display = 'none';
        return;
    }

    // Where to get an API key, per provider (shown as a link under the key field).
    const KEY_HELP: Record<string, { url: string; text: string }> = {
        gemini: { url: 'https://aistudio.google.com/apikey', text: 'Get a Gemini API key from Google AI Studio' },
        xai: { url: 'https://console.x.ai', text: 'Get an xAI API key from the xAI console' },
        cohere: { url: 'https://dashboard.cohere.com/api-keys', text: 'Get a Cohere API key from the Cohere dashboard' }
    };
    const KEYLESS_PROVIDERS = new Set(['ollama']);
    const EXAMPLE_GROUPS = [
        {
            category: 'Download',
            items: [
                'Download this video in 1080p: <link>',
                'Get the audio of <link>',
                'Extract the audio from <filename>',
                'Download as a clip from <time> to <time>'
            ]
        },
        {
            category: 'Subtitles',
            items: [
                'Download <link> with English subtitles burned in',
                'Download the available subtitles for <link>',
                'Are subtitles for <link> manual or auto-generated?',
                'Add subtitles at the top'
            ]
        },
        {
            category: 'Information',
            items: [
                'Summarize this video: <link>',
                'What’s the title, uploader, and duration of <link>?',
                'List all available video formats for <link>',
                'Download the thumbnail of <link>'
            ]
        },
        {
            category: 'File Management',
            items: [
                'Show me the files in my download folder',
                'Give me information about <filename>',
                'Re-encode <filename> as high-quality MP4',
                'Delete <filename> in my download folder'
            ]
        }
    ];

    const els = {
        classicBtn: $('modeClassicBtn'),
        aiBtn: $('modeAiBtn'),
        notice: $('modeNotice'),
        settingsBtn: $('aiSettingsBtn'),
        banner: $('aiSetupBanner'),
        bannerText: $('aiSetupText'),
        bannerBtn: $('aiSetupBtn'),
        messages: $('aiMessages'),
        progress: $('aiProgress'),
        modelHint: $('aiModelHint'),
        input: $<HTMLTextAreaElement>('aiInput'),
        sendBtn: $<HTMLButtonElement>('aiSendBtn'),
        stopBtn: $<HTMLButtonElement>('aiStopBtn'),
        newChatBtn: $<HTMLButtonElement>('aiNewChatBtn'),
        settingsModal: $('aiSettingsModal'),
        providerSelect: $<HTMLSelectElement>('aiProviderSelect'),
        modelInput: $<HTMLInputElement>('aiModelInput'),
        baseUrlField: $('aiBaseUrlField'),
        baseUrlInput: $<HTMLInputElement>('aiBaseUrlInput'),
        thinkingField: $('aiThinkingField'),
        thinkingSelect: $<HTMLSelectElement>('aiThinkingSelect'),
        keyField: $('aiKeyField'),
        keyInput: $<HTMLInputElement>('aiKeyInput'),
        keySaveBtn: $('aiKeySaveBtn'),
        keyRemoveBtn: $<HTMLButtonElement>('aiKeyRemoveBtn'),
        keyStatus: $('aiKeyStatus'),
        keyHelp: $('aiKeyHelp'),
        keyHelpLink: $('aiKeyHelpLink'),
        confirmSelect: $<HTMLSelectElement>('aiConfirmSelect'),
        privacyNote: $('aiPrivacyNote'),
        testResult: $('aiTestResult'),
        testBtn: $<HTMLButtonElement>('aiTestBtn'),
        settingsCancelBtn: $('aiSettingsCancelBtn'),
        settingsSaveBtn: $('aiSettingsSaveBtn'),
        confirmModal: $('aiConfirmModal'),
        confirmDesc: $('aiConfirmDescription'),
        confirmRisk: $('aiConfirmRisk'),
        confirmAllow: $('aiConfirmAllowBtn'),
        confirmDeny: $('aiConfirmDenyBtn')
    };

    let settings: AiSettings | null = null;
    let mode: Mode = 'classic';
    let busy = false;
    let noticeTimer: number | undefined;
    let pendingConfirmId: string | null = null;
    let assistantBubblesThisTurn = 0;
    let streamingBubble: HTMLDivElement | null = null;
    let streamingText = '';
    let lastAssistantText = '';
    let retryTimer: number | null = null;
    const steps = new Map<string, ToolStep>();

    // ------------------------------------------------------------------ helpers

    function showNotice(text: string) {
        els.notice.textContent = text || '';
        els.notice.title = text || '';
        window.clearTimeout(noticeTimer);
        if (text) {
            noticeTimer = window.setTimeout(() => {
                els.notice.textContent = '';
                els.notice.title = '';
            }, 5000);
        }
    }

    function currentProvider() {
        return settings ? settings.providers[settings.provider] : null;
    }

    function refreshModelHint() {
        const provider = currentProvider();
        if (!provider?.model) {
            els.modelHint.textContent = '';
            return;
        }
        const effort = provider.supportsReasoningEffort
            ? provider.reasoningEffort
            : provider.supportsThinkingLevel
                ? provider.thinkingLevel
                : null;
        els.modelHint.textContent = effort
            ? `Using ${provider.label}: ${provider.model} (reasoning effort: ${effort})`
            : `Using ${provider.label}: ${provider.model}`;
    }

    function getContext(): import('./llm/types.js').AiContext {
        return {
            downloadFolder: document.querySelector<HTMLInputElement>('#downloadFolder')?.value.trim() ?? '',
            browser: document.querySelector<HTMLSelectElement>('#browser')?.value ?? '',
            proxy: window.SharedContext.getProxyUrl()
        };
    }

    function classicTaskRunning() {
        const controls = document.getElementById('cancelActionControls');
        return Boolean(controls && controls.style.display !== 'none');
    }

    function scrollMessagesToBottom() {
        if (!els.messages) return;
        els.messages.scrollTop = els.messages.scrollHeight;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
            });
        }
    }

    function append(el: HTMLElement) {
        clearEmptyHint();
        els.messages.appendChild(el);
        scrollMessagesToBottom();
    }

    function openLink(url: string) {
        // Only http(s) links are ever rendered, but check again before handing a URL to the OS.
        if (window.MarkdownLite && window.MarkdownLite.isSafeUrl(url)) window.electronAPI.openExternal(url);
    }

    // Assistant text is Markdown. It is rendered with DOM calls only (see markdown.js), so model or
    // website text can never inject markup. If anything goes wrong we fall back to plain text.
    function fillMessage(el: HTMLElement, kind: MessageKind, text: string) {
        el.dataset.rawText = text;
        if (kind === 'assistant' && window.MarkdownLite) {
            try {
                el.classList.add('md');
                el.textContent = '';
                el.appendChild(window.MarkdownLite.render(text, document, { onLink: openLink }));
                return;
            } catch (err) {
                console.error('Markdown rendering failed, showing plain text:', err);
                el.classList.remove('md');
                el.textContent = '';
            }
        }
        el.textContent = text;
    }

    function addMessage(kind: MessageKind, text: string) {
        if (kind === 'assistant') {
            const last = els.messages.lastElementChild;
            if (last instanceof HTMLElement && last.dataset.rawText && last.dataset.rawText.trim() === String(text).trim()) {
                return last;
            }
        }
        const el = document.createElement('div');
        el.className = `ai-msg ${kind}`;
        fillMessage(el, kind, text);
        append(el);
        return el;
    }

    function updateStreamingMessage(text?: string, done = false) {
        if (!streamingBubble) {
            streamingBubble = document.createElement('div');
            streamingBubble.className = 'ai-msg assistant';
            append(streamingBubble);
        }
        if (text !== undefined) fillMessage(streamingBubble, 'assistant', text);
        scrollMessagesToBottom();
        if (done) {
            const finalText = (text ?? streamingText) || '';
            fillMessage(streamingBubble, 'assistant', finalText);
            lastAssistantText = finalText;
            assistantBubblesThisTurn += 1;
            streamingBubble = null;
            streamingText = '';
            scrollMessagesToBottom();
        }
    }

    function clearEmptyHint() {
        const hint = els.messages.querySelector('.ai-empty-hint');
        if (hint) hint.remove();
    }

    function renderEmptyHint() {
        els.messages.textContent = '';
        const hint = document.createElement('div');
        hint.className = 'ai-empty-hint';
        const title = document.createElement('div');
        title.className = 'ai-empty-title';
        title.textContent = 'Tell me what you want to do. Click an example to try it:';
        hint.appendChild(title);

        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'ai-example-groups';

        for (const group of EXAMPLE_GROUPS) {
            const section = document.createElement('div');
            section.className = 'ai-example-group';

            const catTitle = document.createElement('div');
            catTitle.className = 'ai-example-cat';
            catTitle.textContent = group.category;
            section.appendChild(catTitle);

            const list = document.createElement('ul');
            list.className = 'ai-example-list';
            for (const example of group.items) {
                const item = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ai-example';
                btn.textContent = example;
                btn.addEventListener('click', () => {
                    els.input.value = example;
                    els.input.focus();
                });
                item.appendChild(btn);
                list.appendChild(item);
            }
            section.appendChild(list);
            groupsContainer.appendChild(section);
        }

        hint.appendChild(groupsContainer);
        els.messages.appendChild(hint);
    }

    // ------------------------------------------------------------------ mode switch

    function applyMode(next: Mode) {
        mode = next;
        document.body.dataset.mode = next;
        const isAi = next === 'ai';
        els.classicBtn.classList.toggle('active', !isAi);
        els.aiBtn.classList.toggle('active', isAi);
        els.classicBtn.setAttribute('aria-pressed', String(!isAi));
        els.aiBtn.setAttribute('aria-pressed', String(isAi));
        els.settingsBtn.style.display = isAi ? '' : 'none';
        refreshBanner();
        if (isAi) els.input.focus();
    }

    async function switchMode(next: Mode) {
        if (next === mode) return;
        if (classicTaskRunning()) {
            showNotice('A classic action is still running. Wait for it to finish or cancel it first.');
            return;
        }
        if (busy) {
            showNotice('The assistant is still working. Press Stop first.');
            return;
        }
        showNotice('');
        applyMode(next);
        const res = await api.setSettings({ mode: next });
        if (res.ok) {
            settings = res.settings;
            refreshModelHint();
        }
    }

    function refreshBanner() {
        const provider = currentProvider();
        let text = '';
        if (provider) {
            if (provider.needsApiKey && !provider.hasApiKey) {
                text = `${provider.label} needs an API key before the assistant can work.`;
            } else if (!provider.model) {
                text = `${provider.label} needs a model name.`;
            }
        }
        els.banner.style.display = mode === 'ai' && text ? 'flex' : 'none';
        els.bannerText.textContent = text;
        refreshModelHint();
    }

    // ------------------------------------------------------------------ chat

    function clearRetryProgress() {
        if (retryTimer) {
            window.clearInterval(retryTimer);
            retryTimer = null;
            els.progress.textContent = '';
        }
        els.progress.classList.remove('retrying');
    }

    function startRetryProgress(event: Extract<AiEvent, { type: 'retrying' }>) {
        clearRetryProgress();
        els.progress.classList.add('retrying');
        const startTime = Date.now();
        const deadline = startTime + Math.max(0, event.delayMs || 0);
        const details = `${event.provider}: ${event.reason}, attempt ${event.attempt} of ${event.retries}`;

        function tick() {
            const now = Date.now();
            if (now < deadline) {
                const secondsLeft = Math.max(1, Math.ceil((deadline - now) / 1000));
                els.progress.textContent = `Retrying in ${secondsLeft} s (${details})\u2026`;
            } else {
                const elapsedSinceRetry = Math.floor((now - deadline) / 1000);
                const elapsedText = elapsedSinceRetry > 0 ? ` (${elapsedSinceRetry}s)` : '';
                els.progress.textContent = `Retrying now (${details})\u2026${elapsedText}`;
            }
        }

        tick();
        retryTimer = window.setInterval(tick, 250);
    }

    function setBusy(value: boolean) {
        busy = value;
        els.sendBtn.disabled = value;
        els.sendBtn.style.display = value ? 'none' : '';
        els.input.disabled = value;
        els.newChatBtn.disabled = value;
        els.stopBtn.style.display = value ? '' : 'none';
        els.stopBtn.disabled = false;
        els.stopBtn.textContent = 'Stop';
        if (!value) {
            clearRetryProgress();
            els.progress.textContent = '';
            hideConfirm();
            els.input.focus();
        }
        scrollMessagesToBottom();
    }

    function describeError(error: AiFailure) {
        const isContextError = /download folder|cookie browser|proxy address/i.test(error.message);
        const isFolderError = /download folder/i.test(error.message);
        const needsSettings = !isContextError && ['auth', 'not_found', 'settings'].includes(error.kind);
        return {
            text: error.message,
            needsSettings,
            needsFolder: isFolderError,
            rateLimited: error.kind === 'rate_limit'
        };
    }

    function addError(error: AiFailure) {
        const info = describeError(error);
        const el = document.createElement('div');
        el.className = 'ai-msg error';
        el.setAttribute('role', 'alert');
        el.textContent = info.text;
        if (info.rateLimited) {
            const hint = document.createElement('div');
            hint.textContent = 'Tip: you can switch to Classic mode, which does not use the AI.';
            el.appendChild(hint);
        }
        if (info.needsFolder) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Choose Download Folder';
            btn.addEventListener('click', () => {
                if (typeof window.chooseFolder === 'function') {
                    window.chooseFolder();
                } else {
                    const folderEl = document.getElementById('downloadFolder');
                    if (folderEl) folderEl.focus();
                }
            });
            el.appendChild(btn);
        }
        if (info.needsSettings) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Open AI Settings';
            btn.addEventListener('click', openSettings);
            el.appendChild(btn);
        }
        append(el);
    }

    async function sendMessage() {
        const text = els.input.value.trim();
        if (!text || busy) return;

        clearRetryProgress();
        addMessage('user', text);
        els.input.value = '';
        assistantBubblesThisTurn = 0;
        lastAssistantText = '';
        streamingText = '';
        setBusy(true);
        els.progress.textContent = 'Thinking…';
        scrollMessagesToBottom();
        try {
            const res = await api.send(text, getContext());
            if (!res.ok) {
                if (streamingBubble) {
                    streamingBubble.remove();
                    streamingBubble = null;
                    streamingText = '';
                }
                addError(res.error);
            } else {
                const answerText = (res.text || '').trim();
                if (streamingBubble) {
                    // Finalize the in-progress streaming bubble with the complete text
                    updateStreamingMessage(answerText || streamingText, true);
                } else if (assistantBubblesThisTurn === 0) {
                    // The answer normally arrives as an 'assistant_text' event. If it did not, show the
                    // returned text so the user is never left without a reply.
                    const fallbackText = answerText || '(The assistant did not return any text.)';
                    lastAssistantText = fallbackText;
                    assistantBubblesThisTurn += 1;
                    addMessage('assistant', fallbackText);
                }
            }
        } catch (err) {
            if (streamingBubble) {
                streamingBubble.remove();
                streamingBubble = null;
                streamingText = '';
            }
            addError({ kind: 'unexpected', message: 'Something went wrong talking to the assistant.' });
            console.error(err);
        } finally {
            setBusy(false);
        }
    }

    async function stop() {
        clearRetryProgress();
        els.stopBtn.disabled = true;
        els.stopBtn.textContent = 'Stopping…';
        hideConfirm();
        await api.cancel();
    }

    async function newChat() {
        if (busy) return;
        const ok = await api.reset();
        if (ok) {
            steps.clear();
            streamingBubble = null;
            streamingText = '';
            renderEmptyHint();
        }
    }

    function summarizeResult(name: string, result: Record<string, unknown>) {
        if (!result) return '';
        if (result.error) return String(result.error);
        if (name === 'get_video_transcript') return `Captions from ${result.from} to ${result.through}`;
        if (Array.isArray(result.files) && result.files.length > 0 && result.saved_to_folder) {
            return `Saved: ${result.files.join(', ')}`;
        }
        if (Array.isArray(result.deleted)) {
            const skipped = Array.isArray(result.skipped) && result.skipped.length ? ` (skipped ${result.skipped.length})` : '';
            return `Deleted: ${result.deleted.join(', ') || 'nothing'}${skipped}`;
        }
        if (Array.isArray(result.subtitles)) return `${result.subtitles.length} subtitle language(s) found`;
        if (typeof result.total_files === 'number') return `${result.total_files} file(s) in the folder`;
        if (result.title) return String(result.title);
        if (result.message) return String(result.message);
        if (name === 'list_formats') return 'Format list retrieved';
        return '';
    }

    function handleEvent(event: AiEvent) {
        switch (event.type) {
            case 'assistant_text':
                clearRetryProgress();
                if (event.text) {
                    const text = event.text.trim();
                    if (streamingBubble) {
                        updateStreamingMessage(text, true);
                        break;
                    }
                    if (text === lastAssistantText.trim()) break;
                    lastAssistantText = text;
                    assistantBubblesThisTurn += 1;
                    addMessage('assistant', text);
                }
                break;
            case 'assistant_delta':
                clearRetryProgress();
                if (event.text && busy) {
                    streamingText += event.text;
                    updateStreamingMessage(streamingText);
                }
                break;
            case 'progress':
                clearRetryProgress();
                els.progress.textContent = event.text;
                break;
            case 'retrying':
                startRetryProgress(event);
                break;
            case 'tool_start': {
                clearRetryProgress();
                const el = document.createElement('div');
                el.className = 'ai-step running';
                const title = document.createElement('div');
                title.textContent = `⏳ ${event.description}`;
                const detail = document.createElement('div');
                detail.className = 'ai-step-detail';
                el.append(title, detail);
                steps.set(event.id, { el, title, detail, description: event.description });
                append(el);
                break;
            }
            case 'tool_result': {
                clearRetryProgress();
                const step = steps.get(event.id);
                if (!step) break;
                const failed = !event.ok || event.cancelled;
                step.el.className = `ai-step ${failed ? 'fail' : 'ok'}`;
                step.title.textContent = `${event.cancelled ? '⏹' : failed ? '✗' : '✓'} ${step.description}`;
                const summary = summarizeResult(event.name, event.result);
                step.detail.textContent = summary.length > 300 ? `${summary.slice(0, 300)}…` : summary;

                if (event.name === 'list_formats' && event.result && typeof event.result.output === 'string' && event.result.output.trim()) {
                    const expander = document.createElement('details');
                    expander.className = 'ai-step-expander';
                    const summaryEl = document.createElement('summary');
                    summaryEl.textContent = 'View full format list';
                    const pre = document.createElement('pre');
                    pre.className = 'ai-step-raw';
                    pre.textContent = event.result.output.trim();
                    expander.append(summaryEl, pre);
                    step.detail.append(expander);
                }

                els.progress.textContent = 'Thinking…';
                scrollMessagesToBottom();
                break;
            }
            case 'tool_denied': {
                clearRetryProgress();
                const el = document.createElement('div');
                el.className = 'ai-step denied';
                el.textContent = `⊘ Declined: ${event.description}`;
                append(el);
                hideConfirm();
                break;
            }
            case 'confirm_request':
                clearRetryProgress();
                showConfirm(event);
                break;
            default:
                break;
        }
    }

    // ------------------------------------------------------------------ confirmation dialog

    function showConfirm(request: Extract<AiEvent, { type: 'confirm_request' }>) {
        pendingConfirmId = request.requestId;
        els.confirmDesc.textContent = request.description;
        els.confirmRisk.textContent =
            request.reason ||
            (request.risk === 'high'
                ? 'This can take a long time, use a lot of CPU, or replace or delete files.'
                : '');
        els.confirmModal.style.display = 'flex';
        // Default focus is the safe choice so a stray Enter key does not approve anything.
        els.confirmDeny.focus();
    }

    function hideConfirm() {
        pendingConfirmId = null;
        els.confirmModal.style.display = 'none';
    }

    async function answerConfirm(approved: boolean) {
        const id = pendingConfirmId;
        if (!id) return;
        hideConfirm();
        await api.confirm(id, approved);
    }

    // ------------------------------------------------------------------ settings dialog

    let settingsReturnFocus: Element | null = null;

    function populateProviderSelect() {
        if (!settings) return;
        els.providerSelect.textContent = '';
        for (const [id, info] of Object.entries(settings.providers)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = info.label;
            els.providerSelect.appendChild(option);
        }
        els.providerSelect.value = settings.provider;
    }

    function renderProviderFields() {
        const id = els.providerSelect.value;
        const info = settings?.providers[id];
        if (!info) return;
        els.modelInput.value = info.model || '';
        els.modelInput.placeholder = info.defaultModel || 'Model name';
        els.baseUrlField.style.display = info.editableBaseUrl ? '' : 'none';
        els.baseUrlInput.value = info.baseUrl || '';
        els.baseUrlInput.placeholder = info.defaultBaseUrl || 'http://...';
        els.thinkingField.style.display = info.supportsThinkingLevel || info.supportsReasoningEffort ? '' : 'none';
        els.thinkingSelect.textContent = '';
        const efforts = info.supportsReasoningEffort
            ? [
                ['none', 'None (fastest)'],
                ['low', 'Low'],
                ['medium', 'Medium'],
                ['high', 'High'],
                ['xhigh', 'Extra high']
            ]
            : [
                ['low', 'Fast (recommended)'],
                ['medium', 'Balanced: slower, more careful'],
                ['high', 'Thorough: much slower']
            ];
        for (const [value, label] of efforts) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            els.thinkingSelect.appendChild(option);
        }
        els.thinkingSelect.value = info.supportsReasoningEffort ? info.reasoningEffort : info.thinkingLevel;
        $('aiThinkingHint').textContent = info.supportsReasoningEffort
            ? 'The available effort depends on the selected xAI model.'
            : 'How long Gemini thinks before answering. Fast is enough for downloads and conversions.';

        const usesKey = !KEYLESS_PROVIDERS.has(id);
        els.keyField.style.display = usesKey ? '' : 'none';
        els.keyInput.value = '';
        const help = KEY_HELP[id];
        els.keyHelp.style.display = help ? '' : 'none';
        if (help) {
            els.keyHelpLink.textContent = help.text;
            els.keyHelpLink.dataset.url = help.url;
        }
        renderKeyStatus();

        const notes: Record<string, string> = {
            gemini:
                'Your messages, video links and the results of actions are sent to Google. Depending on your plan, Google may use free-tier data to improve its products, so check Google\u2019s terms. Choose Ollama if you want everything to stay on your computer.',
            xai:
                'Your messages, video links and the results of actions are sent to xAI. Check xAI\u2019s data and privacy terms. Choose Ollama if you want everything to stay on your computer.',
            cohere:
                'Your messages, video links and the results of actions are sent to Cohere. Choose Ollama if you want everything to stay on your computer.',
            ollama:
                'Everything stays on your computer. Ollama must be running, and the model must support tool calling (for example LFM3-1.7B, Qwen3). Small models are less reliable.',
            'openai-compatible':
                'Your messages are sent to the server URL above. Use this for OpenAI, OpenRouter, Groq, LM Studio and similar services.'
        };
        els.privacyNote.textContent = notes[id] || '';
        els.testResult.textContent = '';
        els.testResult.className = 'ai-test-result';
    }

    function renderKeyStatus() {
        if (!settings) return;
        const id = els.providerSelect.value;
        const info = settings.providers[id];
        if (!info) return;
        const parts = [];
        parts.push(info.hasApiKey ? 'A key is saved.' : info.needsApiKey ? 'No key saved yet.' : 'No key saved (optional for this provider).');
        if (!settings.keyStorageSecure) {
            parts.push('This system has no secure key storage, so the key is only remembered until you close the app.');
        }
        els.keyStatus.textContent = parts.join(' ');
        els.keyStatus.classList.toggle('warn', !settings.keyStorageSecure);
        els.keyRemoveBtn.disabled = !info.hasApiKey;
    }

    async function openSettings() {
        const res = await api.getSettings();
        if (!res.ok) {
            showNotice(res.error || 'Could not load AI settings.');
            return;
        }
        settings = res.settings;
        populateProviderSelect();
        els.confirmSelect.value = settings.confirmMode;
        renderProviderFields();
        refreshModelHint();
        settingsReturnFocus = document.activeElement;
        els.settingsModal.style.display = 'flex';
        els.providerSelect.focus();
    }

    function closeSettings() {
        els.settingsModal.style.display = 'none';
        els.keyInput.value = '';
        if (settingsReturnFocus instanceof HTMLElement || settingsReturnFocus instanceof SVGElement) settingsReturnFocus.focus();
    }

    function formOverrides(): AiTestConnectionOptions {
        const id = els.providerSelect.value;
        const info = settings?.providers[id];
        const overrides: AiTestConnectionOptions = { type: id, model: els.modelInput.value.trim() };
        if (info?.editableBaseUrl) overrides.baseUrl = els.baseUrlInput.value.trim();
        if (info?.supportsReasoningEffort) overrides.reasoningEffort = els.thinkingSelect.value as AiTestConnectionOptions['reasoningEffort'];
        const typedKey = els.keyInput.value.trim();
        if (typedKey) overrides.apiKey = typedKey;
        return overrides;
    }

    async function testConnection() {
        els.testBtn.disabled = true;
        els.testResult.className = 'ai-test-result';
        els.testResult.textContent = 'Testing…';
        try {
            const result = await api.testConnection(formOverrides());
            els.testResult.className = `ai-test-result ${result.ok ? 'ok' : 'fail'}`;
            els.testResult.textContent = `${result.ok ? '✓' : '✗'} ${result.message}`;
        } catch {
            els.testResult.className = 'ai-test-result fail';
            els.testResult.textContent = '✗ The test could not be run.';
        } finally {
            els.testBtn.disabled = false;
        }
    }

    async function saveKey() {
        const id = els.providerSelect.value;
        const value = els.keyInput.value.trim();
        if (!value) {
            els.testResult.className = 'ai-test-result fail';
            els.testResult.textContent = 'Paste a key first.';
            return false;
        }
        const res = await api.setApiKey(id, value);
        if (!res.ok) {
            els.testResult.className = 'ai-test-result fail';
            els.testResult.textContent = res.error || 'Could not save the key.';
            return false;
        }
        settings = res.settings;
        els.keyInput.value = '';
        renderKeyStatus();
        els.testResult.className = 'ai-test-result ok';
        els.testResult.textContent = res.persisted ? '✓ Key saved securely.' : '✓ Key kept for this session only.';
        return true;
    }

    async function removeKey() {
        const res = await api.removeApiKey(els.providerSelect.value);
        if (res.ok) {
            settings = res.settings;
            renderKeyStatus();
            els.testResult.className = 'ai-test-result';
            els.testResult.textContent = 'Key removed.';
        }
    }

    async function saveSettings() {
        const id = els.providerSelect.value;
        const info = settings?.providers[id];
        if (!info) return;
        const model = els.modelInput.value.trim();
        if (!model) {
            els.testResult.className = 'ai-test-result fail';
            els.testResult.textContent = 'Enter a model name.';
            els.modelInput.focus();
            return;
        }

        // A key that was typed but not saved yet is saved together with the settings.
        if (els.keyInput.value.trim() && !(await saveKey())) return;

        const providerConfig: ProviderConfig = { type: id, model };
        if (info.editableBaseUrl) providerConfig.baseUrl = els.baseUrlInput.value.trim();
        if (info.supportsThinkingLevel) providerConfig.thinkingLevel = els.thinkingSelect.value as ProviderConfig['thinkingLevel'];
        if (info.supportsReasoningEffort) providerConfig.reasoningEffort = els.thinkingSelect.value as ProviderConfig['reasoningEffort'];

        const res = await api.setSettings({
            provider: id,
            confirmMode: els.confirmSelect.value,
            providerConfig
        });
        if (!res.ok) {
            els.testResult.className = 'ai-test-result fail';
            els.testResult.textContent = res.error || 'Could not save settings.';
            return;
        }
        settings = res.settings;
        refreshModelHint();
        closeSettings();
        refreshBanner();
    }

    function trapFocus(event: KeyboardEvent, container: HTMLElement) {
        if (event.key !== 'Tab') return;
        const focusable = [...container.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(
            (el) => !('disabled' in el && el.disabled) && el.offsetParent !== null
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    // ------------------------------------------------------------------ wiring

    els.classicBtn.addEventListener('click', () => switchMode('classic'));
    els.aiBtn.addEventListener('click', () => switchMode('ai'));
    els.settingsBtn.addEventListener('click', openSettings);
    els.bannerBtn.addEventListener('click', openSettings);

    els.sendBtn.addEventListener('click', sendMessage);
    els.stopBtn.addEventListener('click', stop);
    els.newChatBtn.addEventListener('click', newChat);
    els.input.addEventListener('keydown', (e) => {
        // Do not send while an IME (Chinese/Japanese/Korean input) is composing text.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            sendMessage();
        }
    });

    els.providerSelect.addEventListener('change', renderProviderFields);
    els.testBtn.addEventListener('click', testConnection);
    els.keySaveBtn.addEventListener('click', saveKey);
    els.keyRemoveBtn.addEventListener('click', removeKey);
    els.settingsSaveBtn.addEventListener('click', saveSettings);
    els.settingsCancelBtn.addEventListener('click', closeSettings);
    els.keyHelpLink.addEventListener('click', (e) => {
        e.preventDefault();
        const url = els.keyHelpLink.dataset.url;
        if (url) window.electronAPI.openExternal(url);
    });
    els.settingsModal.addEventListener('mousedown', (e) => {
        if (e.target === els.settingsModal) closeSettings();
    });

    els.confirmAllow.addEventListener('click', () => answerConfirm(true));
    els.confirmDeny.addEventListener('click', () => answerConfirm(false));

    document.addEventListener('keydown', (e) => {
        if (els.confirmModal.style.display !== 'none') {
            if (e.key === 'Escape') answerConfirm(false);
            else trapFocus(e, els.confirmModal);
        } else if (els.settingsModal.style.display !== 'none') {
            if (e.key === 'Escape') closeSettings();
            else trapFocus(e, els.settingsModal);
        }
    });

    api.onEvent(handleEvent);

    renderEmptyHint();
    api.getSettings().then((res) => {
        if (!res.ok) return;
        settings = res.settings;
        applyMode(settings.mode);
        refreshModelHint();
    });
})();

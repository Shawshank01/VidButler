// Text the AI mode shows to the user or feeds back to the model, kept out of the logic.

export const MESSAGES = {
    stopped: 'Stopped.',
    emptyAnswer: '(The assistant returned an empty answer.)',
    emptyAnswerRetryPrompt: 'Please answer the user\'s request or call the appropriate tool. Do not leave the response empty.',
    geminiStreamInterrupted: 'response stream interrupted',
    geminiStreamIncomplete: 'Gemini ended the stream before completing its response.',
    geminiStreamError: (detail) => detail ? `Gemini reported a streaming error: ${detail}` : 'Gemini reported a streaming error.',
    cohereFixedUrl: 'The Cohere server URL is fixed.',
    cohereMissingKey: 'No Cohere API key is configured. Add one in settings.',
    cohereModelNotChat: (model) => `Connected, but model "${model}" does not support Chat. Choose a text generation model that supports Chat.`,
    cohereConnected: (model) => `Connected to Cohere. Model "${model}" supports Chat.`,
    cohereNoAnswer: 'Cohere returned no answer.',
    cohereInvalidToolCall: 'Cohere returned an invalid tool call.',
    cohereStreamIncomplete: 'Cohere ended the stream before completing its response.',
    cohereGenerationFailed: (detail) => `Cohere could not complete the response: ${detail}`,
    noThumbnailSaved: 'yt-dlp reported no saved thumbnail file.',
    cancelledByUser: 'Cancelled by the user.',
    declinedByUser: 'The user declined to run this action.',
    toolNotRun: 'Not run: the request failed.',
    browserCookiesUnreadable: (browser) => `Could not read ${browser} cookies.`,
    macBrowserCookieAccess: (browser, denied) => [
        denied
            ? `macOS is blocking access to ${browser}’s cookie database.`
            : `macOS may be blocking access to ${browser}’s cookie database. yt-dlp’s “could not find” error can also mean the profile has no cookie database. First, open ${browser} and confirm that the profile you use has cookies saved.`,
        `1. Open System Settings → Privacy & Security → Files & Folders. Allow access to ${browser}’s app data for VidButler if that option appears. If you started VidButler from VS Code’s terminal in dev mode, check Visual Studio Code instead. Downloads Folder access does not grant access to browser data.`,
        '2. Fully quit and reopen VidButler, then retry. If running from VS Code, quit and reopen VS Code before restarting VidButler.',
        `3. ${denied ? 'If the installed release is still denied access or the permission does not stick' : 'If the installed release’s browser-data permission does not stick'}, add VidButler.app in System Settings → Privacy & Security → Full Disk Access, then quit and reopen it and retry. This grants access to more than browser data, so enable it only if you trust the app.`
    ].join('\n\n'),
    /** Returned to the model when a tool needs a folder and none is selected. */
    noDownloadFolderForTool:
        'No download folder is selected. Ask the user to choose a download folder in the app first.',
    /** Part of the system prompt when no folder is selected. */
    noDownloadFolderInPrompt:
        'No download folder is selected yet. If the user wants to download or convert something, tell them to choose a download folder in the app first.',
    /** Shown in the confirmation dialog when a tool is about to use an address the user did not type. */
    urlNotFromUser:
        'This address was not in your message. It may come from the web page the assistant read. Only allow it if you trust it.',
    maxSteps: (steps) => `I stopped after ${steps} steps without finishing. Tell me if you want me to continue.`,
    requestFailed: (reason) => `(The request failed: ${reason})`
};

# Project status and handoff

Snapshot of where the project stands, why it is built the way it is, what has and has not been verified, and what to do next. Written so that a new contributor, or another AI assistant, can continue without the earlier conversation.

## 1. What this project is

A desktop app (Electron 45, TypeScript and JavaScript ES modules, pnpm) that downloads videos with **yt-dlp** and processes them with **FFmpeg**. Release builds bundle yt-dlp, FFmpeg, and Deno for yt-dlp's EJS challenge solver. `pnpm prepare-tools` (`scripts/prepare-tools.mjs`) uses `tools-versions.json` to stage them in `build-tools/<os>-<arch>`. The release workflow stages binaries from `build-tools.yml`, which builds FFmpeg from source for macOS and Windows. Electron-builder copies the tools to `process.resourcesPath/tools` via `extraResources`. At runtime, `dependencies.js` prepends that directory to `PATH` and prefers bundled copies before falling back to system binaries. Media commands pass `--remote-components ejs:github` so yt-dlp can fetch the YouTube challenge solver components when needed.

It originally had only a form-based UI ("Classic mode"). The goal of the current work is:

> Let users do everything by describing it in plain language ("Help me download this video `link`"), using the Gemini API (default, free tier) or other providers including a local Ollama model, and eventually expose everything yt-dlp and FFmpeg can do through prompts, while keeping Classic mode as a no-LLM fallback.

## 2. What has been achieved

| Phase | Result | Status |
| --- | --- | --- |
| 1. Refactor | `src/main.ts` split into Electron-free modules in `src/core/`. `main.ts` is thin IPC handlers. Classic behaviour unchanged. | Done, user-verified |
| 2. AI backend | `src/llm/`: 15 tools, input validation, agent loop, five provider adapters, system prompt. | Done |
| 3A. Main-process integration | Encrypted API-key storage, chat service (settings, conversation, confirmations, cancel), IPC and preload API (`window.electronAPI.ai`). | Done, user-verified (key save, connection test) |
| 3B. UI | Classic / AI switch, chat panel, AI settings dialog, Allow/Deny dialog, live progress, streamed replies, auto-scroll, shared Browser / Download Folder / Proxy context controls. | Done, user-verified for the original SOCKS5 control. |
| Follow-ups | Gemini `thinkingLevel`, streamed Markdown replies, retries on HTTP 503 and similar, xAI Responses provider, Ollama streaming, empty-parameter tool schema fix, diagnostic `[ai]` log lines, CSP and navigation guards, repo-wide ESLint. | Done |
| Built-in updates | Packaged apps check GitHub Releases at launch. Windows and Linux AppImages ask before downloading, then install and restart. Ad hoc–signed macOS builds offer a copyable Homebrew tap command plus a GitHub fallback. The cask removes quarantine. | Done, unit-tested. The packaged update flow needs live verification. |
| 5.2.0 | AI time-range downloads, caption-based summaries and questions, original-language automatic caption detection, and local data cleanup. | Implemented with automated coverage. The packaged clip, transcript, and cleanup flows need live verification. |

## 3. Architecture

```text
Renderer (window)                          Main process (Node)
-----------------                          -------------------
renderer.ts   Classic UI  ---IPC--->       main.ts  (thin handlers, per-request event routing)
ai-ui.ts      AI UI       ---IPC--->         |-- settings-store.js / settings-schema.js
markdown.js   safe render                    |-- core/tools.ts  <-----------------+
                                             |     (yt-dlp / ffmpeg operations)    |
                                             |-- llm/chat-service.js               |
                                             |     |-- ai-settings.js              |
                                             |     |-- conversation.ts             |
                                             |     |-- confirmations.js            |
                                             |     '-- agent.ts (loop)             |
                                             |           |-- providers/*           |
                                             |           '-- tool-registry.ts ----+
                                             |                 '-- tools/*
                                             '-- llm/key-store.js (safeStorage)
```

### Layout

```text
src/main.ts              Window, IPC handlers (Classic + ai-* channels). 'ai-send' routes events to the
                         requesting window and cancels the request if that window closes or reloads.
src/preload.cjs          contextBridge: window.electronAPI and .ai (checked CommonJS)
src/types/ipc.ts         Shared IPC request arguments, response values, and event payloads
src/renderer.ts          Classic UI (classic script, see sections 7 and 8 for coverage)
src/ai-ui.ts             AI UI (classic script, IIFE, uses window.electronAPI.ai)
src/markdown.js          Safe Markdown renderer (classic script, exposes window.MarkdownLite)
src/ui-language.ts       Language picker and classic-script DOM translation
src/i18n/catalog.cjs      UI translations shared by the renderer, native dialogs and AI tool descriptions
src/settings-store.js    user-settings.json: queued merges, atomic writes, explicit first-run defaults
src/settings-schema.js   Allow-list for the generic 'set-settings' IPC channel
src/external-url.js      Which addresses 'open-external' may open (http(s) and the macOS privacy pane)
src/update.js            Electron-free update coordinator (support detection, check, download/install state)
src/dependencies.js      PATH setup (login-shell PATH is cached), bundled-tool lookup, dependency checks
src/core/                Electron-free media operations, process management, encoding settings,
                         WebVTT parsing, local data management, and logging
src/llm/                 Electron-free:
  chat-service.js          Coordinates one request (settings, conversation, confirmations, agent)
  ai-settings.js           AI settings, API key slots, provider construction
  provider-settings.js     Validation (AiSettingsError, sanitizeProviderConfig, allowed browsers, proxy pattern)
  context.js               Single definition of a valid request context; requireFolder()
  conversation.ts          History, trimming, repair after a failed turn
  confirmations.js         Pending Allow/Deny prompts with timeout
  agent.ts, agent-events.ts  Model/tool loop; log + event routing
  agent-tool-args.ts          Normalizes model arguments before tool validation
  provenance.js            Is a URL one the user typed?
  tool-registry.ts         Assembles tools/ and exposes getTool, getRisk, getToolDeclarations
  tools/                   names.ts (TOOL_NAMES), common.ts (defineTool, helpers),
                           info.ts, transcript.ts, download.ts, section.ts, media.ts, files.ts
  providers/               gemini, xai, cohere, ollama, openai-compatible, index (PROVIDER_TYPES capabilities),
                           http.js (requestJson/requestStream, retries), stream.js (SSE / NDJSON readers)
  transcript-summary.ts   Groups timestamped caption sections and reduces long transcripts to notes
  prompt.js, messages.js, limits.js, redact.js, validate.ts, errors.js, key-store.js
test/                    node:test suite
```

`core/` and `llm/` never import Electron. Anything Electron-specific (safeStorage, userData path, windows) is injected from `main.ts`.

### Tools the model can call (`src/llm/tools/`)

- `info.ts` provides `get_online_video_info`, `list_formats`, and `list_subtitles`.
- `transcript.ts` provides `get_video_transcript` in `summary` (default) and `page` modes. It caches the caption track during the current turn, prefers matching manual captions, and can use original-language automatic captions.
- `download.ts` provides `download_video` (`max_height`, `format_code`, `container`, `playlist`), `download_audio` (`best`, `m4a`, `mp3`, `opus`, `flac`, `wav`), `download_thumbnail`, and `download_subtitles`.
- `section.ts` provides `download_section` for online video and audio clips. On macOS, MP4 clips prefer VideoToolbox for H.264, and MP4 and M4A clips prefer AudioToolbox for AAC. The tool retries with FFmpeg's encoders on matching encoder errors.
- `media.ts` provides `get_local_media_info`, `download_with_hardsub`, `reencode_mp4`, and `extract_audio_from_file`.
- `files.ts` provides `list_downloads` and `delete_files`.

Tools are declared with `defineTool()` using names from `TOOL_NAMES`. A test checks that the system prompt references valid tool names and parameters. Each tool has a `risk` (`low`/`high`, optionally a function of the arguments), a `describe()` text for the confirmation dialog, and a `run(args, ctx)` that validates inputs and builds argument arrays for yt-dlp or FFmpeg where needed. High-risk calls include hardsubbing, re-encoding, `delete_files`, whole-playlist downloads, and calls with URLs absent from user messages (see invariant 11).

### Providers

`PROVIDER_TYPES` (`providers/index.ts`) declares `needsApiKey`, `editableBaseUrl`, `lockedBaseUrlError`, provider options such as `thinkingLevel` and `reasoningEffort`, and any override for `transcriptInputChars`. Settings and validation read these capabilities. All providers use `requestJson` and `requestStream` (`http.js`) and the shared stream readers (`stream.js`). Shared AI limits live in `limits.js`, default retry settings live in `providers/http.js`, and shared user-facing and model-facing strings live in `messages.js`.

### Neutral message format (all providers translate to/from this)

```text
{ role: 'user', text }
{ role: 'assistant', text, toolCalls: [{ id, name, args, providerCallId? }], raw? }
{ role: 'tool', toolCallId, providerCallId?, name, result }
```

`raw` stores provider-specific response data. For Gemini it holds the interaction ID: the adapter sends only the messages after the last assistant message that has one, chained with `previous_interaction_id`, so earlier turns (and Gemini 3's thought signatures) stay server-side and are not replayed.

### Agent loop (`agent.ts`)

The agent calls the model, runs requested tools one at a time, and feeds the results back. It stops when the model returns an answer without tool calls, on cancellation, or when it reaches `MAX_AGENT_STEPS` (8). `TaskManager` allows one long-running yt-dlp or FFmpeg task at a time. Short metadata queries can run outside that lock. Tool results are shaped to `MAX_TOOL_RESULT_CHARS`, with a larger `MAX_TRANSCRIPT_RESULT_CHARS` limit for successful transcript results. Events go to the requesting window, including streamed text, tool status, confirmation prompts, progress, and retry notices. `Conversation.failTurn()` answers unresolved tool calls and records the failure in history. Abort cancels the model request and the running managed task.

Transcript summary mode passes short transcripts through as timestamped text. For long transcripts, `transcript-summary.ts` makes separate provider calls without tools to condense successive sections into timestamped notes. These calls run inside the transcript tool and fall outside `MAX_AGENT_STEPS`. The transcript input budget is 60,000 characters by default and 3,000 for Ollama and OpenAI-compatible servers. Page mode returns up to six individual pages per turn. See `limits.js` for the caption file size and individual page limits.

## 4. Design decisions and invariants (do not break these)

1. **The model never gets a shell and never supplies raw flags.** Tools build argument arrays from validated values (`validate.ts`). URLs must be `http(s)` without whitespace; file names cannot contain `/`, `\` or `..`; language and format codes are pattern-checked.
2. **The download folder, cookie browser and proxy come from the user's UI settings.** `context.js` checks the browser allowlist and proxy URL on every message. A supplied download folder must be an existing absolute directory. Many tools require a folder, including all tools that write user media files.
3. **The confirmation mode controls approvals.** The settings are `always`, `risky` (default), and `never`. When a call requires confirmation, a missing callback or a prompt left unanswered for five minutes causes denial.
4. **Tool output is untrusted data** (video titles, subtitles, error text): the system prompt says so. Replies are rendered with DOM calls only. **Never use `innerHTML` for model text** (a test enforces this in `ai-ui.ts`).
5. **The renderer receives key status only.** The settings form passes newly typed keys to the main process for saving or connection tests. `safeStorage` encrypts keys per provider in `ai-keys.json`. When secure storage is unavailable, including the Linux `basic_text` backend, new keys stay in memory. AI error paths redact stored keys and any key supplied for a connection test. Gemini, xAI, and Cohere use fixed endpoints. The OpenAI-compatible adapter uses the configured server URL and sends an optional key to that server.
6. **`set-settings` (the generic IPC handler) is an allow-list** (`settings-schema.js`: `downloadFolder`, `browser`, `subtitlePosition`, `proxyEnabled`, `proxyType`, `proxyAddress`, `uiLanguage`, each type-checked). Existing settings without `proxyType` use SOCKS5. AI settings go only through the validated `ai-*` handlers.
7. **AI downloads default to `--no-playlist`.**
8. **Downloaded source files and sidecars left after a successful re-encode or hardsub require explicit cleanup.** Classic mode asks before deleting paths reported in `tmpFiles`. In AI mode, `delete_files` is high risk and only deletes regular files that are direct children of the download folder. Tools clean up their own scratch files and attempt to remove unfinished FFmpeg outputs. Cancelled yt-dlp downloads can leave partial files.
9. **Classic mode must keep working with no AI configured.** Both modes share `core/tools.ts` and the same `TaskManager` lock for long-running media jobs.
10. **VidButler retains conversation history in memory only** (up to 40 retained messages). Providers can retain data they receive under their own policies. `[ai]` diagnostics record status and redacted errors. Keep chat prompts and replies out of diagnostics. The core logger redacts credentials in URLs and `--proxy` values.
11. **A URL the user did not type is high risk.** If a tool call's `url` is not in any user message (it may have come from a web page the model read), the agent treats the call as high risk and the dialog explains why (`provenance.js`). This is the main defence against prompt injection through low-risk tools; it does not cover other kinds of steering, so keep the "untrusted data" prompt rule and the high-risk confirmations.
12. **Events and confirmations go to the window that started the request.** That window owns the AI cancellation and confirmation calls. If it is destroyed, crashes or navigates away, the request and any running task are cancelled.

## 5. Provider facts learned (verify again, these change quickly)

**Gemini** (`providers/gemini.js`)

- REST Interactions API (`POST /v1beta/interactions` with `stream: true` for SSE streaming), header `x-goog-api-key` (never in the URL). Default model `gemini-3.5-flash-lite`; the ID is editable.
- Multi-turn state is managed server-side via `previous_interaction_id`, with function calls returning `function_result` inputs.
- VidButler sends `low` by default in `generation_config.thinking_level` and offers `low`, `medium`, and `high`. Gemini 3.5 Flash-Lite supports `minimal` and Gemini 3.8 Flash supports the three levels exposed by the app. If a model returns HTTP 400 mentioning "thinking", the adapter retries once with the field omitted, including for streamed requests. [Google's thinking-level reference](https://aistudio.google.com/docs/thinking#thinking-levels)
- Function declarations with empty `parameters.properties` have been rejected (400). Parameter-less tools are declared with only name and description (`toGeminiDeclaration`).
- Streaming parses SSE `step.start`, `step.delta`, and `interaction.completed` events. Invalid stream data is reported as an error rather than skipped.
- Free tier returns **HTTP 503 "high demand"** at times and 429 when out of quota.

**xAI** (`XaiProvider`, type `xai`) uses a fixed endpoint at `https://api.x.ai/v1`, requires its own key, and defaults to `grok-4.3`. The adapter uses the Responses API (`/responses`) with function calling and SSE. The UI offers `none`, `low`, `medium`, `high`, and `xhigh`. The adapter serializes `reasoningEffort` as `reasoning.effort`. It sends `none` explicitly for `grok-4.3` and `grok-4.3-latest`. With `none` selected for another model, it omits `reasoning` so that model uses its default. [xAI reasoning effort documentation](https://docs.x.ai/developers/model-capabilities/text/best-practices#reasoning-effort)

**Cohere** (`CohereProvider`, type `cohere`): fixed `https://api.cohere.com`, requires its own API key. Sends text and function calls through `/v2/chat` with SSE streaming. The default model is `command-a-plus-05-2026`; users can set another Chat-compatible model ID. The connection test uses `GET /v1/models/{model}` to check Chat compatibility without generating text.

**Ollama**: `/api/chat`, needs a tool-capable model, streamed NDJSON. Unsupported-tools and unreachable-server errors are turned into actionable messages for both streaming and non-streaming calls. lfm3:1.7b has passed testing.

**Retries** (`providers/http.js`): `DEFAULT_RETRIES` is **1** (up to 2 attempts), 3.0 s backoff, for HTTP 500/502/503/504, connection errors, and HTTP 429 responses that include a `Retry-After` header; not for other 4xx errors, bare 429s without `Retry-After`, or requests that already hit their timeout. When a `Retry-After` header (delay-seconds or HTTP-date) is present up to `MAX_RETRY_AFTER_MS` (60 s), it overrides exponential backoff; longer waits fail immediately instead of blocking. Retries apply to requests before a streamed response starts. Cancelling during the wait stops immediately. The UI shows "retrying". Tests derive their expectations from `DEFAULT_RETRIES`.

## 6. Where data lives

On macOS, development and release share Electron's user-data profile under `~/Library/Application Support/vidbutler/`. One app instance holds the shared profile at a time.

| File | Content |
| --- | --- |
| `user-settings.json` | Classic settings, `uiLanguage`, and `aiMode`, `aiProvider`, `aiConfirmMode`, `aiProviderConfigs`. No secrets. Written atomically; a missing file means first run (defaults to AI mode), an unreadable one is treated as empty and logged. |
| `ai-keys.json` | API keys, encrypted (`safeStorage`), file mode 0600. |
| `tool-data/` | App-specific yt-dlp and Deno caches, and per-process scratch directories for manifests and transcripts. Normal operations clean up their scratch files. Startup removes scratch directories from dead app processes. |
| electron-updater cache | On Windows/Linux, a verified pending app update after the user chooses Download and Restart. |

Homebrew zap targets known app-owned paths at both historical profile casings. The About dialog can clear local settings, saved API keys, browser data and tool files before quitting. Downloads and unfinished media files stay in the selected download folder. Shared caches made by older versions and OS-managed keychain entries are outside the profile.

## 7. Testing and verification

```bash
pnpm install
pnpm run lint   # ESLint for JavaScript and TypeScript
pnpm run typecheck   # TypeScript and JavaScript files that opt in with // @ts-check
pnpm test       # node --test test/   (no API key; a few need ffmpeg/ffprobe on PATH)
```

`pnpm start` compiles the app to `out/` before launching Electron. Electron-builder uses the same compile script through its `beforePack` hook. The TypeScript renderer entry points emit the classic scripts `renderer.js` and `ai-ui.js` loaded by `index.html`. Node 26 runs the source tests with native type stripping, and the build test checks that the generated backend loads with type stripping disabled.

The `test/` suite covers the tool registry, agent, providers (mocked `fetch`), IPC contract, renderer wiring, settings and key storage, updater and release manifests, macOS signing, Homebrew cask, local data cleanup, clip encoding, subtitles and transcripts, and media operations. `media-info.test.js` uses real `ffmpeg` and `ffprobe`.

CI uses Node.js 26 and pnpm 12. `.github/workflows/lint.yml` runs lint, type checking and tests for pull requests and pushes to `main` matching its path filters, with an exception for pushes whose head commit message starts with `Bump version to`. The tag-triggered `.github/workflows/release.yml` checks that the tag matches the package version and runs lint and type checking before packaging. Run all three checks on a clean checkout before pushing to match what CI sees.

The release matrix and standalone macOS and Windows build jobs run `node scripts/verify-package.mjs <target> [output-directory]` before uploading artifacts. The check starts the app from the macOS ZIP, the extracted Linux AppImage, or the Windows installer build's unpacked app. It verifies the ASAR contents, runs all four bundled binaries, and exercises a Classic download and a streamed AI reply against local fixtures through the renderer bridge. Linux CI uses Xvfb and sets `VIDBUTLER_SMOKE_NO_SANDBOX=1` for the isolated test launch. The macOS and Linux x64 smoke tests passed locally. Windows and arm64 runs await CI.

**Not covered by automated tests / not verified live:**

- The packaged smoke test covers startup and IPC. Dialog interactions, cancellation, and the Windows install wizard still need manual verification.
- The packaged 5.2.0 flows for downloading a clip, summarising a long transcript, and deleting local data while preserving downloads still need a live run.
- A packaged Windows/Linux automatic update from an older release through download, install, and relaunch. The macOS launch prompt, copied Homebrew command, tap refresh/upgrade, and cask quarantine removal also need a live run.
- The owner verified Brave cookie access on macOS 27 with an ad hoc–signed copy of VidButler 5.1.0. The release builds now apply ad hoc signing and check the packaged signature. Browser permission persistence across updates still needs a live run.
- Live checks still needed from the 2026-11 review pass include the confirmation text for a URL absent from the user message, window close during an active request, `Check for Updates`, and CSP enforcement in a packaged window. The development app has exercised mode switching, AI settings, approval dialogs, cancellation and reload, and the Classic download controls.
- Live runs of hardsub / re-encode / delete via the assistant, the thinking-level setting, xAI, a real Ollama model, the generic OpenAI-compatible provider, and secure key storage on Windows and Linux.

## 8. Known limitations and rough edges

- The assistant can download a time range from an online source. Local file trimming, GIFs, joining, resizing, speed change, SponsorBlock, and chapter/metadata editing are still outside its capabilities. Time-range downloads require FFmpeg and work directly or through an HTTP proxy that supports CONNECT. `download_section` rejects SOCKS proxies. yt-dlp passes the configured HTTP proxy to FFmpeg, and the app clears inherited `NO_PROXY` exceptions for those yt-dlp processes.
- One conversation at a time; history is lost on New chat or quit; capped at 40 messages.
- The UI supports English, German, French, Spanish, Italian, Polish, Dutch, Portuguese, Simplified Chinese, Traditional Chinese and Japanese. Model replies follow the user’s prompt language. Provider diagnostics and raw tool output retain their source language.
- **`renderer.ts` and `ai-ui.ts` are large classic scripts** sharing global state and DOM IDs. Exercise the affected dialogs in a live Electron window when refactoring either script.
- Re-encoding an `.mp4` replaces the original file (flagged high risk and described in the confirmation text).
- Small local models have not been evaluated; expect weaker tool selection.
- The login-shell `PATH` is read once per app run, so changes to shell config are picked up after a restart.
- `src/index.html` enforces a `Content-Security-Policy` (`default-src 'none'; script-src 'self' 'report-sample'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`) and `src/main.ts` blocks unexpected navigation and popups (`will-navigate`, `setWindowOpenHandler`), while `style-src` still allows `'unsafe-inline'` because `index.html`, `renderer.ts`, and `ai-ui.ts` use inline `style` attributes. `open-external` only opens `http(s)` and the macOS privacy settings pane (`external-url.js`).

## 9. Roadmap (suggested order)

### A. Close the capability gap (the original goal)

1. Typed tools, each validated and building its own arguments: `trim_video` for local files (start/end, stream copy or re-encode), `convert_media`, `make_gif`, `compress_video` (target size or CRF), `merge/concat`, `change_speed`, `resize`, SponsorBlock, chapters/metadata, playlist ranges. Add them as new files under `src/llm/tools/` with a name in `TOOL_NAMES`.
2. Then a **guarded passthrough** (`run_ytdlp`, `run_ffmpeg`) for the long tail: flag **allowlist** (not denylist); block `--exec`, `--exec-before-download`, `--config-locations`, `--plugin-dirs`, `--cookies-from-browser` changes, output templates escaping the folder; for ffmpeg, restrict input/output paths to the download folder and block protocol/file-reading filters (`concat:`, `movie=`, `subtitles=` on outside files, `drawtext` with `textfile`, lavfi network sources); always show the exact command and require confirmation.
3. Add tests for every new tool, including path-escape and flag-injection cases.

### B. UX

Show the command a step ran (collapsible), add a "Reveal in Finder / Open folder" button and an AI-mode progress bar, support drag-and-drop URLs or files and clipboard URL detection, offer opt-in saved chat history with export and "delete all" and an opt-in log file, and split `ai-ui.ts` and `renderer.ts` with smoke tests.

### C. Providers

Add a model dropdown from each provider's list-models endpoint; optional automatic fallback to another model or provider after repeated 503; Anthropic adapter (add it to `PROVIDER_TYPES`); token and cost display; evaluate and document recommended Ollama models.

### D. Quality and security

Extend packaged Electron coverage to dialog interactions and installer/update flows; prompt to tool-call evaluation suite per provider (including small models); prompt-injection tests with malicious titles and subtitles.

## 10. Working agreements for whoever continues

- Work in small steps and run `pnpm run lint` and `pnpm test` after each; add or update tests with every change.
- Do not commit or push on the owner's behalf; the owner commits manually.
- Keep `core/` and `llm/` free of Electron imports. Keep renderer scripts as classic scripts. Keep `preload.cjs` CommonJS. Keep `electron.d.ts` in step with `preload.cjs` (a test checks it).
- Put new limits in `limits.js`, new user/model-facing strings in `messages.js`, new tool names in `TOOL_NAMES`, new provider capabilities in `PROVIDER_TYPES`.
- Add dependencies only when justified (`electron-updater` is the sole production dependency added for built-in app updates).
- Never log or return API keys; never render model text as HTML; never let the model choose paths or raw flags.
- State plainly what was and was not tested, especially anything that touches the Electron window.
- Do not rely on memory for provider APIs and model IDs; check current documentation.

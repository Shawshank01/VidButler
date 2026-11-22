<p align="center">
  <img src="build/icon.svg" alt="Video Downloader Icon" width="128">
</p>

# VidButler

[Deutsch](docs/README.de.md) · [Français](docs/README.fr.md) · [Español](docs/README.es.md) · [Italiano](docs/README.it.md) · [Polski](docs/README.pl.md) · [Nederlands](docs/README.nl.md) · [Português](docs/README.pt.md) · [简体中文](docs/README.zh-Hans.md) · [繁體中文](docs/README.zh-Hant.md) · [日本語](docs/README.ja.md) · [Русский](docs/README.ru.md) · [Українська](docs/README.uk.md)

A desktop video downloader and media processor built with Electron, powered by **yt-dlp** and **FFmpeg**. Download videos and audio from YouTube, X (Twitter), Instagram, and hundreds of other sites, with support for format selection, subtitle extraction, re-encoding, and hardsubbing.

The app provides two interfaces you can switch between at any time:

- **Classic Mode**: A traditional form with URL input, action selection, and cookie/proxy settings.
- **AI Mode**: Describe what you want in plain language (e.g., *"Download this video and add an English hardsub to it"*). The app translates your request into safe `yt-dlp` or `FFmpeg` commands and runs them for you.

<!--
![VidButler UI](public/YT-Downloader-UI.png)
*Classic UI*
-->

![VidButler UI AI Mode](public/VidButler-UI.png)
*AI Mode UI*

Click the VidButler icon to open **About**, then use the **Language** picker to choose English, German, French, Spanish, Italian, Polish, Dutch, Portuguese, Simplified Chinese, Traditional Chinese, Japanese, Russian, or Ukrainian. The **System language** setting follows your operating system’s language preferences, with English as the fallback. VidButler remembers your choice across restarts.

## Features

- **Dual interfaces**: Switch between the traditional form and a conversational AI chat at any time.
- **Broad platform support**: Downloads media using `yt-dlp` from YouTube, X, Instagram, TikTok, and more.
- **Quality & format control**: Select specific resolutions and containers, or extract audio directly (M4A, MP3, Opus, FLAC, WAV).
- **Embedded thumbnails**: Embeds thumbnails in supported video downloads. You can also save the thumbnail by itself.
- **Subtitle handling**: Download subtitles by language, or burn them into the video (hardsub) with top or bottom positioning.
- **MP4 re-encoding**: Convert videos to universally compatible H.264/AAC MP4 files via FFmpeg.
- **Hardware acceleration**: Uses macOS VideoToolbox for hardsubs and supported MP4 clips.
- **Cookie support**: Pass cookies from Chrome, Firefox, Brave, or Safari to download age-restricted or member-only videos.
- **HTTP and SOCKS5 proxies**: Route downloads and queries through a local or remote proxy. Turn on **Proxy**, select the type, and enter the host and port.
- **Cancellation**: Stop a running download or encoding job. Interrupted downloads can leave partial files in the download folder.

## Installation

Packaged releases bundle yt-dlp, FFmpeg, and Deno. Choose `arm64` for Apple Silicon, Windows on Arm, or ARM64 Linux, and `x64` for Intel Macs and most Intel or AMD Windows and Linux PCs.

### Method 1: Homebrew (macOS)

Install and update using Homebrew:

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Method 2: Direct Download

1. Download the latest release from the [Releases](https://github.com/Shawshank01/Vidbutler/releases) page.
2. Run the installer for your operating system:
   - **macOS:** `.dmg`
   - **Windows:** `.exe` installer
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> The macOS app is ad hoc–signed and is not notarised. macOS may block a direct DMG installation. Homebrew is the recommended macOS installation method. Direct-download users may need **Open Anyway** in **System Settings > Privacy & Security**, or as a fallback run `xattr -cr /Applications/VidButler.app`.

### Method 3: From Source

The CI workflows use Node.js 26 and pnpm 12. For `pnpm start`, install yt-dlp and FFmpeg on your system. On macOS, run `brew install yt-dlp ffmpeg`. On Ubuntu or Debian, run `sudo apt install yt-dlp ffmpeg`. On Windows, add the tools to your `PATH`. Hardsubbing requires an FFmpeg build with the `subtitles` filter, such as Homebrew's `ffmpeg-full`. Install Deno for full [YouTube support](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Clone the repository:

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start the application:

   ```bash
   pnpm start
   ```

   *(On macOS, you can also double-click `start.command` in the project root to install dependencies and launch the app.)*

#### Building Distributables

To build an installer for your current platform:

```bash
pnpm run build
```

Installers and executables are output to the `dist/` directory.

macOS release builds use ad hoc signing, which requires no Apple Developer Program credentials. macOS may ask for browser access again after an update. Windows signing is used when the optional `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secrets are configured.

## Uninstallation

To remove the Homebrew release and its local data, quit VidButler and run `brew uninstall --cask --zap Shawshank01/tap/vidbutler`. For a manual install, use **About VidButler → Delete Local Data** before removing the app. This clears settings, saved API keys, and app-managed caches while keeping your downloads. On macOS, development and release share this data. macOS Keychain entries and caches from standalone tools or older VidButler releases are outside the app's cleanup scope.

## AI Mode Usage

Click **AI** in the top-right corner to open the chat panel. You can ask for downloads, conversions, file management, or media inspection in conversational language.

### Example Prompts

- *"Download this video: https://..."*
- *"Download this video in 720p: https://..."*
- *"Download this video from 0:45 to 2:10: https://..."*
- *"Download the audio from 1:15 to 2:30: https://..."*
- *"Get the audio of this video as an M4A"*
- *"Summarise this video: https://..."*
- *"What subtitle languages are available for this video?"* followed by *"Hardcode the English ones at the top"*
- *"Download it, then re-encode it to a compatible MP4"*
- *"Show me what's in my download folder"* / *"Delete the leftover subtitle files"*

Clip downloads work with online sources and require FFmpeg. To clip through a proxy, select **HTTP** and enter the address of an HTTP proxy that supports CONNECT. If your proxy only offers SOCKS5, use a local HTTP-to-SOCKS5 bridge. Video summaries use available captions and can cite timestamps. Long transcripts can require several requests to your AI provider.

### Setting Up a Provider

1. Click **AI** in the top-right corner, then open **AI Settings**.
2. Select your provider and check the model. If your provider uses an API key, paste it and click **Save key**. For Ollama or an OpenAI-compatible server, check the server address.
3. Click **Test connection**, then **Save**.
4. Choose your download folder and start chatting.

| Provider | Requirement | Notes |
| --- | --- | --- |
| **Google Gemini** (default, model `gemini-3.5-flash-lite`) | API key from [Google AI Studio](https://aistudio.google.com/apikey) | The default model has a [free tier](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). Your messages go to Google. |
| **xAI Grok** (model `grok-4.3`) | API key from the [xAI console](https://console.x.ai) | Uses xAI's Responses API at `https://api.x.ai/v1/responses`. Your messages go to xAI. |
| **Cohere** (model `command-a-plus-05-2026`) | API key from the [Cohere dashboard](https://dashboard.cohere.com/api-keys) | Streams replies via the [Cohere Chat API](https://docs.cohere.com/docs/streaming). Your messages go to Cohere. |
| **Ollama (local)** | [Ollama](https://ollama.com) running with a tool-capable model such as `lfm3:1.7b`. | With a local model and local server, the app sends chat data to Ollama on your computer. |
| **OpenAI-compatible** | Server URL, model name, usually an API key | Works with llama.cpp, OpenAI, OpenRouter, Groq, LM Studio and similar. |

Choose a model with tool calling for downloads and media operations.

Additional settings:

- **Reasoning effort**: Gemini and xAI expose provider-specific settings. **None** disables reasoning on Grok 4.3 and uses the model's default effort for other xAI models.
- **Confirmation level**: Choose whether to require approval for *Risky actions only* (default), *Every action*, or *Never*.

For model requests that fail with HTTP 503, the app usually retries once. For HTTP 429, it retries if the provider supplies a valid `Retry-After` delay of up to 60 seconds. For authentication errors, check your key in **AI Settings** and click **Test connection**.

### Privacy & Security

- **What is sent to the provider**: The app sends chat content, tool definitions, and tool results to the provider you select. Tool results can include video titles, captions, filenames, and the download folder path.
- **API key storage**: The settings form passes the key to the main process. Saved keys are encrypted locally using Electron's `safeStorage`. If secure storage is unavailable, keys stay in memory for the current app session.
- **Chat history**: VidButler keeps chat history in memory until you start a new chat or quit the app. Hosted providers handle sent data under their own retention policies.
- **File operations**: The assistant operates on media in your selected download folder. File deletion requires confirmation under the default settings.

## Classic Mode Usage

Classic mode doesn't require an AI API key.

1. Paste a video URL and select your destination folder.
2. Choose your action:
   - **Download Video (Best Quality)**: Grabs the best available stream.
   - **List Formats**: Shows every available stream and its format code.
   - **Download (Custom Format)**: Enter a specific format code (run **List Formats** first to view available options). Choose an audio-only format code to download just the audio.
   - **Download Thumbnail**: Saves only the thumbnail image.
   - **Download Subtitles**: Displays available subtitle tracks and lets you pick which to save.
   - **Download & Re-encode to MP4**: Re-encodes with H.264/AAC for maximum playback compatibility.
   - **Download & Add Hardsub**: Burns subtitles directly into the video stream with customizable position (top or bottom).
3. If needed, select your browser under **Browser for Cookies** (helpful for age-restricted or private links) or configure **Proxy**.
4. Click **Run**.

To stop an ongoing task, click **Cancel Action**. VidButler removes unfinished FFmpeg outputs for cancelled re-encoding and hardsubbing. Interrupted downloads may leave partial files.

## Updating

Packaged macOS and Windows builds and Linux AppImages check GitHub Releases at launch.

1. On **Windows and Linux AppImage**, choose **Download and Restart**. The update is checksum-verified, installed, and the new version launches automatically.
2. On **macOS**, choose **Copy Homebrew Command**, then paste the command into Terminal to refresh the tap and upgrade.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   If VidButler was installed directly from a DMG, choose **Open GitHub Release** instead.
3. To check manually, click the VidButler icon and choose **Check for Updates**.

> [!NOTE]
> In source runs and extracted Linux builds, **Check for Updates** offers to open the [latest release](https://github.com/Shawshank01/Vidbutler/releases/latest).

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - The core media download engine
- [FFmpeg](https://ffmpeg.org/) - Audio/video processing, transcoding, and subtitle burn-in
- [Deno](https://deno.com/) - Lightweight JS runtime for yt-dlp challenge solving
- [Electron](https://www.electronjs.org/) - Desktop application framework

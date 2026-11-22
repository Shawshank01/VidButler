<p align="center">
  <img src="../build/icon.svg" alt="视频下载应用图标" width="128">
</p>

# VidButler

[English](../README.md)

VidButler 是一款基于 Electron 的桌面应用，使用 **yt-dlp** 和 **FFmpeg** 下载并处理媒体。你可以从 YouTube、X（Twitter）、Instagram 和数百个其他网站下载视频与音频，也可以选择格式、提取字幕、重新编码视频和将字幕嵌入画面。

应用提供两种界面，你可以随时切换：

- **经典模式**：通过表单输入网址、选择操作并设置 Cookie 和代理。
- **AI 模式**：用自然语言描述你的需求，例如 *“下载这个视频并将英文字幕嵌入画面”*。应用会将请求转换为安全的 `yt-dlp` 或 `FFmpeg` 命令，然后执行。

<!--
![VidButler 经典界面](../public/YT-Downloader-UI.png)
*经典界面*
-->

![VidButler AI 模式](../public/VidButler-UI.png)
*AI 模式界面*

点击 VidButler 图标打开 **关于 VidButler**，在 **语言** 中选择英语、德语、法语、西班牙语、意大利语、波兰语、荷兰语、葡萄牙语、简体中文、繁体中文、日语、俄语或乌克兰语。**系统语言** 会遵循操作系统的语言偏好，找不到匹配项时使用英语。重启后，VidButler 会保留你的选择。

## 功能

- **两种界面**：随时在经典表单和 AI 对话之间切换。
- **支持多个平台**：使用 `yt-dlp` 从 YouTube、X、Instagram、TikTok 等网站下载媒体。
- **画质与格式**：选择分辨率和容器格式，或直接提取音频（M4A、MP3、Opus、FLAC、WAV）。
- **内嵌缩略图**：将缩略图嵌入支持此功能的下载视频，也可以单独保存缩略图。
- **字幕处理**：按语言下载字幕，或将字幕嵌入视频画面顶部或底部。
- **重新编码为 MP4**：使用 FFmpeg 将视频转换为兼容性广泛的 H.264/AAC MP4 文件。
- **硬件加速**：在 macOS 上使用 VideoToolbox 嵌入字幕并处理受支持的 MP4 片段。
- **浏览器 Cookie**：使用 Chrome、Firefox、Brave 或 Safari 的 Cookie 下载有年龄限制或仅限会员观看的视频。
- **HTTP 和 SOCKS5 代理**：通过本地或远程代理进行下载和查询。开启 **代理**，选择类型并输入主机和端口。
- **取消操作**：停止正在进行的下载或编码。中断的下载可能会在下载文件夹中留下不完整的文件。

## 安装

发布安装包随附 yt-dlp、FFmpeg 和 Deno。Apple 芯片 Mac、Arm 版 Windows 或 ARM64 Linux 请选择 `arm64`。Intel Mac 以及大多数采用 Intel 或 AMD 处理器的 Windows 和 Linux 电脑请选择 `x64`。

### 方法一：Homebrew（macOS）

使用 Homebrew 安装和更新：

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### 方法二：直接下载

1. 从 [发布页面](https://github.com/Shawshank01/Vidbutler/releases) 下载最新版本。
2. 运行适用于你的操作系统的安装程序：
   - **macOS:** `.dmg`
   - **Windows：** `.exe` 安装程序
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> macOS 应用使用临时签名（ad hoc），未经 Apple 公证。macOS 可能会阻止从 DMG 直接安装，推荐使用 Homebrew。直接下载的用户可能需要在 **系统设置 > 隐私与安全性** 中点击 **仍要打开**，也可以尝试运行 `xattr -cr /Applications/VidButler.app`。

### 方法三：从源代码运行

CI 工作流使用 Node.js 26 和 pnpm 12。运行 `pnpm start` 前，请在系统中安装 yt-dlp 和 FFmpeg。在 macOS 上运行 `brew install yt-dlp ffmpeg`，在 Ubuntu 或 Debian 上运行 `sudo apt install yt-dlp ffmpeg`。在 Windows 上，将这些工具添加到 `PATH`。嵌入字幕需要包含 `subtitles` 滤镜的 FFmpeg 构建，例如 Homebrew 的 `ffmpeg-full`。请安装 Deno 以获得 [完整的 YouTube 支持](https://github.com/yt-dlp/yt-dlp/wiki/EJS)。

1. 克隆仓库：

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. 安装依赖项：

   ```bash
   pnpm install
   ```

3. 启动应用：

   ```bash
   pnpm start
   ```

   *（在 macOS 上，也可以双击项目根目录中的 `start.command` 来安装依赖项并启动应用。）*

#### 构建发行包

为当前平台构建安装程序：

```bash
pnpm run build
```

安装程序和可执行文件会输出到 `dist/` 目录。

macOS 发布版本使用临时签名（ad hoc），无需 Apple Developer Program 凭据。更新后，macOS 可能会再次请求访问浏览器。配置了可选的 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 密钥后，Windows 构建会使用签名。

## 卸载

如要移除 Homebrew 版本及其本地数据，请退出 VidButler 并运行 `brew uninstall --cask --zap Shawshank01/tap/vidbutler`。若为手动安装，请在移除应用前选择 **关于 VidButler → 删除本地数据**。这会清除设置、已保存的 API 密钥和应用管理的缓存，并保留下载的文件。macOS 上的开发版本和发布版本共用这些数据。清理范围不包括 macOS 钥匙串条目、独立工具的缓存或旧版 VidButler 的缓存。

## 使用 AI 模式

点击右上角的 **AI** 打开聊天面板。你可以用自然语言请求下载、转换或检查媒体，以及管理文件。

### 请求示例

- *“下载这个视频：https://…”*
- *“以 720p 下载这个视频：https://…”*
- *“下载这个视频从 0:45 到 2:10 的片段：https://…”*
- *“下载从 1:15 到 2:30 的音频：https://…”*
- *“把这个视频的音频保存为 M4A”*
- *“总结这个视频：https://…”*
- *“这个视频有哪些字幕语言？”*，然后说 *“把英文字幕嵌入画面顶部”*
- *“下载这个视频，然后重新编码为兼容的 MP4”*
- *“显示我的下载文件夹中有哪些文件”* / *“删除剩余的字幕文件”*

从在线源下载片段需要 FFmpeg。通过代理下载片段时，请选 **HTTP** 并输入支持 CONNECT 的 HTTP 代理地址。如果你的代理仅支持 SOCKS5，请使用本地 HTTP 转 SOCKS5 桥接。视频摘要基于可用字幕，并且可以引用时间戳。较长的字幕文本可能需要向 AI 服务提供商发送多次请求。

### 设置服务提供商

1. 点击右上角的 **AI**，然后打开 **AI 设置**。
2. 选择服务提供商并检查模型。如果提供商需要 API 密钥，请粘贴密钥并点击 **保存密钥**。使用 Ollama 或兼容 OpenAI 的服务器时，请检查服务器地址。
3. 点击 **测试连接**，然后点击 **保存**。
4. 选择下载文件夹，即可开始对话。

| 服务提供商 | 要求 | 说明 |
| --- | --- | --- |
| **Google Gemini**（默认，模型 `gemini-3.5-flash-lite`） | 从 [Google AI Studio](https://aistudio.google.com/apikey) 获取 API 密钥 | 默认模型提供 [免费套餐](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite)。你的消息会发送给 Google。 |
| **xAI Grok**（模型 `grok-4.3`） | 从 [xAI 控制台](https://console.x.ai) 获取 API 密钥 | 使用 xAI 的 Responses API，地址为 `https://api.x.ai/v1/responses`。你的消息会发送给 xAI。 |
| **Cohere**（模型 `command-a-plus-05-2026`） | 从 [Cohere 控制面板](https://dashboard.cohere.com/api-keys) 获取 API 密钥 | 通过 [Cohere Chat API](https://docs.cohere.com/docs/streaming) 流式传输回复。你的消息会发送给 Cohere。 |
| **Ollama（本地）** | 运行 [Ollama](https://ollama.com)，并使用支持工具调用的模型，例如 `lfm3:1.7b`。 | 使用本地模型和服务器时，应用会将聊天数据发送给你电脑上的 Ollama。 |
| **兼容 OpenAI** | 服务器网址、模型名称，通常还需要 API 密钥 | 支持 llama.cpp、OpenAI、OpenRouter、Groq、LM Studio 等。 |

如需下载或处理媒体，请选择支持工具调用的模型。

其他设置：

- **推理强度**：Gemini 和 xAI 提供各自的推理设置。选择 **无** 会关闭 Grok 4.3 的推理，并对其他 xAI 模型采用其默认推理强度。
- **确认级别**：选择何时要求确认：*仅在有风险时询问*（默认）、*每次操作* 或 *从不询问*。

模型请求遇到 HTTP 503 时，应用通常会重试一次。遇到 HTTP 429 时，如果提供商通过 `Retry-After` 提供有效且不超过 60 秒的等待时间，应用会重试。如果身份验证失败，请在 **AI 设置** 中检查密钥，然后点击 **测试连接**。

### 隐私与安全

- **发送给提供商的数据**：应用会将聊天内容、工具定义和工具结果发送给你选择的提供商。工具结果可能包含视频标题、字幕、文件名和下载文件夹路径。
- **API 密钥存储**：设置表单会将密钥传递给主进程。保存的密钥在本地使用 Electron 的 `safeStorage` 加密。如果无法安全存储，密钥只会在当前应用会话中保留在内存中。
- **聊天记录**：在你新建对话或退出应用前，VidButler 会将聊天记录保留在内存中。托管服务提供商根据各自的保留政策处理收到的数据。
- **文件操作**：助手会处理你所选下载文件夹中的媒体。默认设置下，删除文件前需要确认。

## 使用经典模式

经典模式无需 AI 服务的 API 密钥。

1. 粘贴视频网址并选择目标文件夹。
2. 选择操作：
   - **下载视频（最高画质）**：下载可用的最佳媒体流。
   - **列出可用格式**：显示所有可用媒体流及其格式代码。
   - **下载（自定义格式）**：输入指定的格式代码。可以先运行 **列出可用格式** 查看选项。选择纯音频格式代码即可只下载音频。
   - **下载缩略图**：只保存缩略图。
   - **下载字幕**：显示可用的字幕轨道，并让你选择保存哪些。
   - **下载并重新编码为高质量 MP4（H.264/AAC）**：使用 H.264/AAC 重新编码，提高播放兼容性。
   - **下载并将字幕嵌入画面**：将字幕直接嵌入画面顶部或底部。
3. 如有需要，可在 **Cookie 来源浏览器** 中选择浏览器，以处理有年龄限制或不公开的链接，也可配置 **代理**。
4. 点击 **运行**。

要停止正在进行的任务，请点击 **取消操作**。取消重新编码或字幕嵌入时，VidButler 会删除 FFmpeg 未完成的输出文件。下载中断后可能会留下不完整的文件。

## 更新

macOS 和 Windows 安装包版本以及 Linux AppImage 会在启动时检查 GitHub 上的发布版本。

1. 在 **Windows 和 Linux AppImage** 中，选择 **下载并重启**。应用会校验更新的校验和、安装更新，并自动启动新版本。
2. 在 **macOS** 中，选择 **复制 Homebrew 命令**，然后将命令粘贴到“终端”中，刷新 tap 并升级。

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   如果你从 DMG 直接安装了 VidButler，请选择 **打开 GitHub 发布页面**。
3. 如需手动检查更新，请点击 VidButler 图标并选择 **检查更新**。

> [!NOTE]
> 从源代码运行或使用解包后的 Linux 构建时，**检查更新** 会提供打开 [最新版本](https://github.com/Shawshank01/Vidbutler/releases/latest) 的选项。

## 致谢

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 核心媒体下载引擎
- [FFmpeg](https://ffmpeg.org/) — 音视频处理、转码和字幕嵌入
- [Deno](https://deno.com/) — 用于解决 yt-dlp 验证挑战的轻量级 JavaScript 运行时
- [Electron](https://www.electronjs.org/) — 桌面应用框架

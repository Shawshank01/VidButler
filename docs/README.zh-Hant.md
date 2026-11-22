<p align="center">
  <img src="../build/icon.svg" alt="影片下載應用程式圖示" width="128">
</p>

# VidButler

[English](../README.md)

VidButler 是一款以 Electron 打造的桌面應用程式，使用 **yt-dlp** 和 **FFmpeg** 下載及處理媒體。你可以從 YouTube、X（Twitter）、Instagram 和數百個其他網站下載影片與音訊，也可以選擇格式、擷取字幕、重新編碼影片和將字幕嵌入畫面。

應用程式提供兩種介面，你可以隨時切換：

- **經典模式**：透過表單輸入網址、選擇操作及設定 Cookie 和代理伺服器。
- **AI 模式**：用自然語言描述你的需求，例如 *「下載這部影片並將英文字幕嵌入畫面」*。應用程式會將要求轉成安全的 `yt-dlp` 或 `FFmpeg` 指令並執行。

<!--
![VidButler 經典介面](../public/YT-Downloader-UI.png)
*經典介面*
-->

![VidButler AI 模式](../public/VidButler-UI.png)
*AI 模式介面*

按一下 VidButler 圖示開啟 **關於 VidButler**，在 **語言** 中選擇英文、德文、法文、西班牙文、義大利文、波蘭文、荷蘭文、葡萄牙文、簡體中文、繁體中文、日文、俄文或烏克蘭文。**系統語言** 遵循作業系統的語言偏好，找不到相符項目時使用英文。重新啟動後，VidButler 會保留你的選擇。

## 功能

- **兩種介面**：隨時在經典表單與 AI 對話之間切換。
- **支援多個平台**：使用 `yt-dlp` 從 YouTube、X、Instagram、TikTok 等網站下載媒體。
- **畫質與格式**：選擇解析度和容器格式，或直接擷取音訊（M4A、MP3、Opus、FLAC、WAV）。
- **內嵌縮圖**：將縮圖嵌入支援此功能的下載影片，也可以單獨儲存縮圖。
- **字幕處理**：依語言下載字幕，或將字幕嵌入影片畫面頂端或底部。
- **重新編碼為 MP4**：使用 FFmpeg 將影片轉換為相容性廣泛的 H.264/AAC MP4 檔案。
- **硬體加速**：在 macOS 上使用 VideoToolbox 嵌入字幕並處理支援的 MP4 片段。
- **瀏覽器 Cookie**：使用 Chrome、Firefox、Brave 或 Safari 的 Cookie 下載有年齡限制或僅限會員觀看的影片。
- **HTTP 和 SOCKS5 代理伺服器**：透過本機或遠端代理伺服器下載與查詢。開啟 **代理伺服器**，選擇類型並輸入主機和連接埠。
- **取消操作**：停止正在進行的下載或編碼。中斷下載後，下載資料夾中可能會留下不完整的檔案。

## 安裝

發行的安裝套件包含 yt-dlp、FFmpeg 和 Deno。Apple 晶片 Mac、Arm 版 Windows 或 ARM64 Linux 請選擇 `arm64`。Intel Mac 和大多數採用 Intel 或 AMD 處理器的 Windows 與 Linux 電腦請選擇 `x64`。

### 方法一：Homebrew（macOS）

使用 Homebrew 安裝和更新：

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### 方法二：直接下載

1. 從 [版本發布頁面](https://github.com/Shawshank01/Vidbutler/releases) 下載最新版本。
2. 執行適用於你的作業系統的安裝程式：
   - **macOS:** `.dmg`
   - **Windows：** `.exe` 安裝程式
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> macOS 應用程式使用 ad hoc 簽署，未經 Apple 公證。macOS 可能會阻止從 DMG 直接安裝，建議使用 Homebrew。直接下載的使用者可能需要前往 **系統設定 > 隱私權與安全性** 選擇 **強制打開**，或改為執行 `xattr -cr /Applications/VidButler.app`。

### 方法三：從原始碼執行

CI 工作流程使用 Node.js 26 和 pnpm 12。執行 `pnpm start` 前，請先安裝 yt-dlp 和 FFmpeg。在 macOS 上執行 `brew install yt-dlp ffmpeg`，在 Ubuntu 或 Debian 上執行 `sudo apt install yt-dlp ffmpeg`。在 Windows 上將這些工具加入 `PATH`。嵌入字幕需要包含 `subtitles` 濾鏡的 FFmpeg 組建，例如 Homebrew 的 `ffmpeg-full`。安裝 Deno 可獲得 [完整的 YouTube 支援](https://github.com/yt-dlp/yt-dlp/wiki/EJS)。

1. 複製儲存庫：

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. 安裝相依套件：

   ```bash
   pnpm install
   ```

3. 啟動應用程式：

   ```bash
   pnpm start
   ```

   *（在 macOS 上，也可以按兩下專案根目錄的 `start.command` 來安裝相依套件並啟動應用程式。）*

#### 建置發行套件

為目前的平台建置安裝程式：

```bash
pnpm run build
```

安裝程式和執行檔會輸出至 `dist/` 目錄。

macOS 發行組建採用 ad hoc 簽署，無須 Apple Developer Program 憑證。更新後，macOS 可能再次要求取用瀏覽器。若已設定選用的 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 機密，則會簽署 Windows 組建。

## 解除安裝

若要移除 Homebrew 版本及其本機資料，請結束 VidButler 並執行 `brew uninstall --cask --zap Shawshank01/tap/vidbutler`。若為手動安裝，請先選擇 **關於 VidButler → 刪除本機資料**，再移除應用程式。這會清除設定、已儲存的 API 金鑰和應用程式管理的快取，並保留已下載的檔案。macOS 上的開發版和發行版共用這些資料。清理範圍不包括 macOS 鑰匙圈項目、獨立工具的快取或舊版 VidButler 的快取。

## 使用 AI 模式

按一下右上角的 **AI** 開啟對話面板。你可以用自然語言要求下載、轉換或檢查媒體，也可以管理檔案。

### 要求範例

- *「下載這部影片：https://…」*
- *「以 720p 下載這部影片：https://…」*
- *「下載這部影片從 0:45 到 2:10 的片段：https://…」*
- *「下載從 1:15 到 2:30 的音訊：https://…」*
- *「將這部影片的音訊儲存為 M4A」*
- *「摘要這部影片：https://…」*
- *「這部影片有哪些字幕語言？」*，接著說 *「把英文字幕嵌入畫面頂端」*
- *「下載這部影片，然後重新編碼為相容的 MP4」*
- *「顯示我的下載資料夾裡有哪些檔案」* / *「刪除剩下的字幕檔案」*

從線上來源下載片段需要 FFmpeg。透過代理伺服器下載片段時，請選擇 **HTTP** 並輸入支援 CONNECT 的 HTTP 代理伺服器位址。若代理伺服器僅支援 SOCKS5，請使用本機 HTTP 至 SOCKS5 橋接。影片摘要根據可用字幕產生，並可引用時間標記。較長的逐字稿可能需要向 AI 服務供應商傳送多次要求。

### 設定服務供應商

1. 按一下右上角的 **AI**，然後開啟 **AI 設定**。
2. 選擇服務供應商並確認模型。如果供應商需要 API 金鑰，請貼上金鑰並按一下 **儲存金鑰**。若使用 Ollama 或相容 OpenAI 的伺服器，請確認伺服器位址。
3. 按一下 **測試連線**，然後按一下 **儲存**。
4. 選擇下載資料夾後即可開始對話。

| 服務供應商 | 需求 | 備註 |
| --- | --- | --- |
| **Google Gemini**（預設，模型 `gemini-3.5-flash-lite`） | 從 [Google AI Studio](https://aistudio.google.com/apikey) 取得 API 金鑰 | 預設模型提供 [免費方案](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite)。你的訊息會傳送給 Google。 |
| **xAI Grok**（模型 `grok-4.3`） | 從 [xAI 控制台](https://console.x.ai) 取得 API 金鑰 | 使用 xAI 的 Responses API，位址為 `https://api.x.ai/v1/responses`。你的訊息會傳送給 xAI。 |
| **Cohere**（模型 `command-a-plus-05-2026`） | 從 [Cohere 儀表板](https://dashboard.cohere.com/api-keys) 取得 API 金鑰 | 透過 [Cohere Chat API](https://docs.cohere.com/docs/streaming) 串流回覆。你的訊息會傳送給 Cohere。 |
| **Ollama（本機）** | 執行 [Ollama](https://ollama.com) 並使用支援工具呼叫的模型，例如 `lfm3:1.7b`。 | 使用本機模型和伺服器時，應用程式會將對話資料傳送到你電腦上的 Ollama。 |
| **相容 OpenAI** | 伺服器網址、模型名稱，通常還需要 API 金鑰 | 支援 llama.cpp、OpenAI、OpenRouter、Groq、LM Studio 等。 |

若要下載或處理媒體，請選擇支援工具呼叫的模型。

其他設定：

- **推理強度**：Gemini 和 xAI 提供各自的推理設定。選擇 **無** 會關閉 Grok 4.3 的推理，並對其他 xAI 模型採用其預設推理強度。
- **確認層級**：選擇何時要求確認：*僅在有風險時詢問*（預設）、*每次操作* 或 *從不詢問*。

模型要求遇到 HTTP 503 時，應用程式通常會重試一次。遇到 HTTP 429 時，若供應商透過 `Retry-After` 提供有效且不超過 60 秒的等候時間，則會重試。若驗證失敗，請在 **AI 設定** 中檢查金鑰，再按一下 **測試連線**。

### 隱私權與安全性

- **傳送給供應商的資料**：應用程式會把對話內容、工具定義和工具結果傳送給所選供應商。工具結果可能包含影片標題、字幕、檔案名稱和下載資料夾路徑。
- **儲存 API 金鑰**：設定表單將金鑰傳給主程序。已儲存的金鑰會在本機使用 Electron 的 `safeStorage` 加密。若無法使用安全儲存空間，金鑰只會在目前的工作階段保留於記憶體。
- **對話記錄**：在你新增對話或結束應用程式之前，VidButler 會將記錄保留於記憶體。託管供應商依各自的保留政策處理收到的資料。
- **檔案操作**：助理會處理你所選下載資料夾中的媒體。依預設設定，刪除檔案前需要確認。

## 使用經典模式

經典模式不需要 AI 服務的 API 金鑰。

1. 貼上影片網址並選擇目的地資料夾。
2. 選擇操作：
   - **下載影片（最高畫質）**：下載目前可用的最佳媒體串流。
   - **列出可用格式**：顯示所有可用串流及其格式代碼。
   - **下載（自訂格式）**：輸入指定的格式代碼。可先執行 **列出可用格式** 查看選項。選擇純音訊格式代碼即可只下載音訊。
   - **下載縮圖**：只儲存縮圖。
   - **下載字幕**：顯示可用的字幕軌道，讓你選擇要儲存的字幕。
   - **下載並重新編碼為高畫質 MP4（H.264/AAC）**：以 H.264/AAC 重新編碼，提高播放相容性。
   - **下載並將字幕嵌入畫面**：將字幕直接嵌入畫面頂端或底部。
3. 如有需要，可在 **Cookie 來源瀏覽器** 中選擇瀏覽器，以處理私人或有年齡限制的連結，也可設定 **代理伺服器**。
4. 按一下 **執行**。

若要停止正在進行的工作，請按一下 **取消操作**。取消重新編碼或字幕嵌入時，VidButler 會移除 FFmpeg 未完成的輸出檔案。下載中斷後可能會留下不完整的檔案。

## 更新

macOS 和 Windows 安裝套件版本，以及 Linux AppImage，會在啟動時檢查 GitHub 上的發行版本。

1. 在 **Windows 和 Linux AppImage** 上，選擇 **下載並重新啟動**。應用程式會驗證更新的總和檢查碼、安裝更新，再自動啟動新版本。
2. 在 **macOS** 上，選擇 **複製 Homebrew 指令**，再將指令貼到「終端機」，以重新整理 tap 並升級。

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   若你從 DMG 直接安裝 VidButler，請選擇 **開啟 GitHub 版本發布頁面**。
3. 若要手動檢查更新，請按一下 VidButler 圖示並選擇 **檢查更新**。

> [!NOTE]
> 從原始碼執行或使用解開的 Linux 組建時，**檢查更新** 會提供開啟 [最新版本](https://github.com/Shawshank01/Vidbutler/releases/latest) 的選項。

## 致謝

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 核心媒體下載引擎
- [FFmpeg](https://ffmpeg.org/) — 音訊與影片處理、轉碼及字幕嵌入
- [Deno](https://deno.com/) — 用於解決 yt-dlp 驗證挑戰的輕量級 JavaScript 執行環境
- [Electron](https://www.electronjs.org/) — 桌面應用程式框架

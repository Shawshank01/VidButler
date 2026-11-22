<p align="center">
  <img src="../build/icon.svg" alt="Symbol der Video-Download-App" width="128">
</p>

# VidButler

[English](../README.md)

VidButler ist ein plattformübergreifender Medienassistent auf Basis von Electron, der **yt-dlp** und **FFmpeg** nutzt. Lade Videos und Audiodateien von YouTube, X (Twitter), Instagram und Hunderten weiterer Websites herunter. Du kannst Formate auswählen, Untertitel extrahieren, Videos neu kodieren und Untertitel einbrennen. Der KI-Modus kann Videos anhand verfügbarer Untertitel zusammenfassen und anhand von Start- und Endzeit Ausschnitte aus Online-Quellen herunterladen.

Du kannst jederzeit zwischen zwei Oberflächen wechseln:

- **Klassischer Modus** – Ein Formular für die URL, die gewünschte Aktion sowie Cookie- und Proxy-Einstellungen.
- **KI-Modus** – Beschreibe in Alltagssprache, was du tun möchtest, etwa *„Lade dieses Video herunter und brenne englische Untertitel ein“*. Die App setzt deine Anfrage in sichere `yt-dlp`- oder `FFmpeg`-Befehle um und führt sie aus.

<!--
![Klassische Oberfläche von VidButler](../public/YT-Downloader-UI.png)
*Klassische Oberfläche*
-->

![VidButler im KI-Modus](../public/VidButler-UI.png)
*Oberfläche im KI-Modus*

Klicke auf das VidButler-Symbol, um **Über VidButler** zu öffnen. Unter **Sprache** kannst du Englisch, Deutsch, Französisch, Spanisch, Italienisch, Polnisch, Niederländisch, Portugiesisch, vereinfachtes Chinesisch, traditionelles Chinesisch, Japanisch, Russisch oder Ukrainisch wählen. **Systemsprache** folgt der Spracheinstellung des Betriebssystems und verwendet Englisch als Fallback. VidButler speichert deine Auswahl über Neustarts hinweg.

## Funktionen

- **Zwei Oberflächen** – Wechsle jederzeit zwischen dem klassischen Formular und dem KI-Chat.
- **Viele unterstützte Plattformen** – Lade mit `yt-dlp` Medien von YouTube, X, Instagram, TikTok und weiteren Websites herunter.
- **Qualität und Format** – Wähle die Auflösung und das Containerformat oder extrahiere direkt die Audiospur (M4A, MP3, Opus, FLAC, WAV).
- **Eingebettete Vorschaubilder** – Bei unterstützten Video-Downloads wird das Vorschaubild eingebettet. Du kannst es auch separat speichern.
- **Untertitel** – Lade Untertitel nach Sprache herunter oder brenne sie oben oder unten ins Video ein.
- **MP4-Neukodierung** – Wandle Videos mit FFmpeg in breit kompatible MP4-Dateien mit H.264/AAC um.
- **Hardwarebeschleunigung** – Unter macOS nutzt die App VideoToolbox für das Einbrennen von Untertiteln und unterstützte MP4-Ausschnitte.
- **Cookies** – Verwende Cookies aus Chrome, Firefox, Brave oder Safari für altersbeschränkte Videos oder Inhalte nur für Mitglieder.
- **HTTP- und SOCKS5-Proxys** – Leite Downloads und Abfragen über einen lokalen oder entfernten Proxy. Aktiviere **Proxy**, wähle den Typ aus und gib Host und Port ein.
- **Abbrechen** – Stoppe laufende Downloads oder Kodierungen. Bei abgebrochenen Downloads können unvollständige Dateien im Download-Ordner zurückbleiben.

## Installation

Die fertigen Pakete enthalten yt-dlp, FFmpeg und Deno. Wähle `arm64` für Apple Silicon, Windows auf Arm oder ARM64-Linux. Verwende `x64` für Intel-Macs und die meisten Windows- und Linux-PCs mit Intel- oder AMD-Prozessor.

### Methode 1 – Homebrew (macOS)

Installation und Updates über Homebrew:

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Methode 2 – Direkter Download

1. Lade die aktuelle Version von der Seite [Releases](https://github.com/Shawshank01/Vidbutler/releases) herunter.
2. Führe das Installationsprogramm für dein Betriebssystem aus:
   - **macOS:** `.dmg`
   - **Windows:** Installationsprogramm `.exe`
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> Die macOS-App ist ad hoc signiert und wurde nicht von Apple notarisiert. macOS kann die direkte Installation aus einer DMG blockieren. Empfohlen wird die Installation über Homebrew. Beim Direktdownload musst du gegebenenfalls unter **Systemeinstellungen > Datenschutz & Sicherheit** auf **Dennoch öffnen** klicken oder ersatzweise `xattr -cr /Applications/VidButler.app` ausführen.

### Methode 3 – Aus dem Quellcode

Die CI-Workflows nutzen Node.js 26 und pnpm 12. Installiere für `pnpm start` zunächst yt-dlp und FFmpeg. Unter macOS verwende `brew install yt-dlp ffmpeg`, unter Ubuntu oder Debian `sudo apt install yt-dlp ffmpeg`. Füge die Werkzeuge unter Windows deinem `PATH` hinzu. Zum Einbrennen von Untertiteln brauchst du einen FFmpeg-Build mit dem Filter `subtitles`, etwa `ffmpeg-full` von Homebrew. Installiere Deno für die vollständige [YouTube-Unterstützung](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Klone das Repository:

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Installiere die Abhängigkeiten:

   ```bash
   pnpm install
   ```

3. Starte die Anwendung:

   ```bash
   pnpm start
   ```

   *(Unter macOS kannst du auch im Projektstamm auf `start.command` doppelklicken, um die Abhängigkeiten zu installieren und die App zu starten.)*

#### Installationspakete erstellen

So erstellst du ein Installationspaket für deine Plattform:

```bash
pnpm run build
```

Installationsprogramme und ausführbare Dateien landen im Verzeichnis `dist/`.

macOS-Release-Builds sind ad hoc signiert und benötigen keinen Zugang zum Apple Developer Program. Nach einem Update fragt macOS möglicherweise erneut nach Browserzugriff. Windows-Builds werden signiert, wenn die optionalen Secrets `WIN_CSC_LINK` und `WIN_CSC_KEY_PASSWORD` eingerichtet sind.

## Deinstallation

Um die Homebrew-Version samt lokalen Daten zu entfernen, beende VidButler und führe `brew uninstall --cask --zap Shawshank01/tap/vidbutler` aus. Bei manueller Installation wähle vor dem Entfernen der App **Über VidButler → Lokale Daten löschen**. Das löscht Einstellungen, gespeicherte API-Schlüssel und von der App verwaltete Caches. Deine Downloads bleiben erhalten. Unter macOS teilen sich Entwicklungs- und Release-Version diese Daten. Einträge im macOS-Schlüsselbund und Caches eigenständiger Werkzeuge oder älterer VidButler-Versionen liegen außerhalb dieses Bereinigungsbereichs.

## KI-Modus verwenden

Klicke oben rechts auf **KI**, um den Chat zu öffnen. Du kannst in Alltagssprache Downloads, Konvertierungen, Dateioperationen oder Informationen zu Medien anfordern.

### Beispielanfragen

- *„Lade dieses Video herunter: https://…“*
- *„Lade dieses Video in 720p herunter: https://…“*
- *„Lade den Ausschnitt von 0:45 bis 2:10 herunter: https://…“*
- *„Lade die Tonspur von 1:15 bis 2:30 herunter: https://…“*
- *„Lade die Tonspur dieses Videos als M4A herunter“*
- *„Fasse dieses Video zusammen: https://…“*
- *„Welche Untertitelsprachen gibt es für dieses Video?“*, gefolgt von *„Brenne die englischen Untertitel oben ein“*
- *„Lade es herunter und kodiere es als kompatibles MP4 neu“*
- *„Zeige mir den Inhalt meines Download-Ordners“* / *„Lösche die übrigen Untertiteldateien“*

Ausschnitte lassen sich aus Online-Quellen herunterladen und benötigen FFmpeg. Wenn du einen Proxy verwendest, wähle **HTTP** und gib die Adresse eines HTTP-Proxys mit CONNECT-Unterstützung ein. Bietet dein Proxy nur SOCKS5, verwende eine lokale HTTP-zu-SOCKS5-Bridge. Videozusammenfassungen nutzen verfügbare Untertitel und können Zeitmarken nennen. Lange Transkripte können mehrere Anfragen an deinen KI-Anbieter erfordern.

### Anbieter einrichten

1. Klicke oben rechts auf **KI** und öffne die **KI-Einstellungen**.
2. Wähle den Anbieter und prüfe das Modell. Benötigt der Anbieter einen API-Schlüssel, füge ihn ein und klicke auf **Schlüssel speichern**. Prüfe bei Ollama oder einem OpenAI-kompatiblen Server die Serveradresse.
3. Klicke auf **Verbindung testen** und dann auf **Speichern**.
4. Wähle deinen Download-Ordner und beginne den Chat.

| Anbieter | Voraussetzung | Hinweise |
| --- | --- | --- |
| **Google Gemini** (Standard, Modell `gemini-3.5-flash-lite`) | API-Schlüssel aus [Google AI Studio](https://aistudio.google.com/apikey) | Das Standardmodell hat einen [kostenlosen Tarif](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). Deine Nachrichten gehen an Google. |
| **xAI Grok** (Modell `grok-4.3`) | API-Schlüssel aus der [xAI-Konsole](https://console.x.ai) | Verwendet die Responses API von xAI unter `https://api.x.ai/v1/responses`. Deine Nachrichten gehen an xAI. |
| **Cohere** (Modell `command-a-plus-05-2026`) | API-Schlüssel aus dem [Cohere-Dashboard](https://dashboard.cohere.com/api-keys) | Überträgt Antworten als Stream über die [Cohere Chat API](https://docs.cohere.com/docs/streaming). Deine Nachrichten gehen an Cohere. |
| **Ollama (lokal)** | [Ollama](https://ollama.com) muss mit einem Modell laufen, das Tool-Aufrufe unterstützt, beispielsweise `lfm3:1.7b`. | Mit lokalem Modell und lokalem Server sendet die App Chatdaten an Ollama auf deinem Computer. |
| **OpenAI-kompatibel** | Server-URL, Modellname, meist ein API-Schlüssel | Funktioniert mit llama.cpp, OpenAI, OpenRouter, Groq, LM Studio und ähnlichen Diensten. |

Wähle für Downloads und Medienoperationen ein Modell, das Tool-Aufrufe unterstützt.

Weitere Einstellungen:

- **Denkaufwand** – Gemini und xAI bieten anbieterspezifische Einstellungen. **Keiner** deaktiviert den Denkaufwand bei Grok 4.3 und verwendet für andere xAI-Modelle deren Standardwert.
- **Bestätigungsstufe** – Wähle, wann die App nach Freigabe fragt: *Nur riskante Aktionen* (Standard), *Jede Aktion* oder *Nie*.

Schlägt eine Modellanfrage mit HTTP 503 fehl, versucht es die App in der Regel einmal erneut. Bei HTTP 429 geschieht das, wenn der Anbieter eine gültige Wartezeit von höchstens 60 Sekunden in `Retry-After` angibt. Bei Authentifizierungsfehlern prüfe deinen Schlüssel in den **KI-Einstellungen** und klicke auf **Verbindung testen**.

### Datenschutz und Sicherheit

- **Übermittelte Daten** – Chatinhalt, Tool-Definitionen und Tool-Ergebnisse gehen an den gewählten Anbieter. Ergebnisse können Videotitel, Untertitel, Dateinamen und den Pfad zum Download-Ordner enthalten.
- **Speicherung von API-Schlüsseln** – Das Einstellungsformular übergibt den Schlüssel an den Hauptprozess. Gespeicherte Schlüssel werden lokal über Electrons `safeStorage` verschlüsselt. Ist kein sicherer Speicher verfügbar, bleiben die Schlüssel für die aktuelle Sitzung im Arbeitsspeicher.
- **Chatverlauf** – VidButler hält den Verlauf im Arbeitsspeicher, bis du einen neuen Chat startest oder die App beendest. Gehostete Anbieter wenden auf gesendete Daten ihre eigenen Aufbewahrungsregeln an.
- **Dateioperationen** – Der Assistent verarbeitet Medien im ausgewählten Download-Ordner. Standardmäßig muss das Löschen von Dateien bestätigt werden.

## Klassischen Modus verwenden

Im klassischen Modus brauchst du keinen KI-API-Schlüssel.

1. Füge eine Video-URL ein und wähle deinen Zielordner.
2. Wähle eine Aktion:
   - **Video herunterladen (beste Qualität)** – Lädt den besten verfügbaren Stream herunter.
   - **Formate auflisten** – Zeigt alle verfügbaren Streams und deren Formatcodes.
   - **Herunterladen (eigenes Format)** – Gib einen Formatcode ein. Unter **Formate auflisten** siehst du die verfügbaren Optionen. Ein reines Audioformat lädt nur die Tonspur herunter.
   - **Vorschaubild herunterladen** – Speichert nur das Vorschaubild.
   - **Untertitel herunterladen** – Zeigt die verfügbaren Untertitelspuren und lässt dich auswählen, welche gespeichert werden.
   - **Herunterladen und als hochwertiges MP4 neu kodieren (H.264/AAC)** – Kodiert mit H.264/AAC für eine möglichst breite Wiedergabekompatibilität.
   - **Herunterladen und Untertitel einbrennen** – Brennt Untertitel oben oder unten direkt in das Video ein.
3. Wähle bei Bedarf unter **Browser für Cookies** einen Browser, etwa für altersbeschränkte oder private Links, oder konfiguriere **Proxy**.
4. Klicke auf **Ausführen**.

Klicke auf **Aktion abbrechen**, um eine laufende Aufgabe zu stoppen. Bei abgebrochener Neukodierung oder Untertiteleinbettung löscht VidButler die unvollständigen FFmpeg-Ausgaben. Abgebrochene Downloads können unvollständige Dateien hinterlassen.

## Updates

Die fertigen Builds für macOS und Windows sowie Linux-AppImages prüfen beim Start die GitHub-Releases.

1. Wähle unter **Windows und bei Linux-AppImages** **Herunterladen und neu starten**. Die Prüfsumme des Updates wird überprüft, das Update wird installiert und die neue Version startet automatisch.
2. Wähle unter **macOS** **Homebrew-Befehl kopieren** und füge den Befehl ins Terminal ein, um den Tap zu aktualisieren und das Upgrade auszuführen.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   Wenn du VidButler direkt aus einer DMG installiert hast, wähle **GitHub-Release öffnen**.
3. Zur manuellen Prüfung klicke auf das VidButler-Symbol und wähle **Nach Updates suchen**.

> [!NOTE]
> Beim Start aus dem Quellcode und bei extrahierten Linux-Builds bietet **Nach Updates suchen** an, das [neueste Release](https://github.com/Shawshank01/Vidbutler/releases/latest) zu öffnen.

## Mitwirkende Projekte

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) – Kernwerkzeug für Medien-Downloads
- [FFmpeg](https://ffmpeg.org/) – Audio- und Videoverarbeitung, Neukodierung und Einbrennen von Untertiteln
- [Deno](https://deno.com/) – Schlanke JavaScript-Laufzeit für yt-dlp-Challenges
- [Electron](https://www.electronjs.org/) – Framework für Desktop-Anwendungen

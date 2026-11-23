<p align="center">
  <img src="../build/icon.svg" alt="Icona dell’app di download video" width="128">
</p>

# VidButler

[English](../README.md)

VidButler è un assistente multimediale multipiattaforma basato su Electron che usa **yt-dlp** e **FFmpeg**. Scarica video e audio da YouTube, X (Twitter), Instagram e centinaia di altri siti. Puoi scegliere il formato, estrarre i sottotitoli, ricodificare i video e imprimervi i sottotitoli. La modalità IA può anche riassumere i video usando i sottotitoli disponibili e scaricare clip da fonti online indicando l’inizio e la fine.

Puoi passare da un’interfaccia all’altra in qualsiasi momento:

- **Modalità classica**. Un modulo per inserire l’URL, scegliere l’azione e configurare cookie e proxy.
- **Modalità IA**. Descrivi quello che vuoi fare in linguaggio naturale, per esempio *«Scarica questo video e imprimi i sottotitoli in inglese»*. L’app traduce la richiesta in comandi sicuri di `yt-dlp` o `FFmpeg` e li esegue.

<!--
![Interfaccia classica di VidButler](../public/YT-Downloader-UI.png)
*Interfaccia classica*
-->

![VidButler in modalità IA](../public/VidButler-UI.png)
*Interfaccia della modalità IA*

Fai clic sull’icona di VidButler per aprire **Informazioni su VidButler**. Dal menu **Lingua** puoi scegliere inglese, tedesco, francese, spagnolo, italiano, polacco, neerlandese, portoghese, cinese semplificato, cinese tradizionale, giapponese, russo o ucraino. **Lingua di sistema** segue le preferenze del sistema operativo e usa l’inglese se non trova corrispondenze. VidButler conserva la scelta anche dopo il riavvio.

## Funzionalità

- **Due interfacce**. Passa in qualsiasi momento dal modulo classico alla chat con l’IA.
- **Numerose piattaforme**. Scarica contenuti con `yt-dlp` da YouTube, X, Instagram, TikTok e altri siti.
- **Qualità e formato**. Scegli la risoluzione e il contenitore o estrai direttamente l’audio (M4A, MP3, Opus, FLAC, WAV).
- **Miniature incorporate**. L’app incorpora le miniature nei video scaricati compatibili. Puoi anche salvare solo la miniatura.
- **Sottotitoli**. Scarica i sottotitoli per lingua o imprimili in alto o in basso nel video.
- **Ricodifica MP4**. Converti i video con FFmpeg in file MP4 H.264/AAC ampiamente compatibili.
- **Accelerazione hardware**. Usa VideoToolbox su macOS per imprimere i sottotitoli e creare clip MP4 compatibili.
- **Cookie del browser**. Usa i cookie di Chrome, Firefox, Brave o Safari per scaricare video soggetti a limiti di età o riservati agli iscritti.
- **Proxy HTTP e SOCKS5**. Instrada download e richieste tramite un proxy locale o remoto. Attiva **Proxy**, seleziona il tipo e inserisci host e porta.
- **Annullamento**. Interrompi un download o una codifica in corso. I download interrotti possono lasciare file parziali nella cartella dei download.

## Installazione

I pacchetti distribuiti includono yt-dlp, FFmpeg e Deno. Scegli `arm64` per Apple Silicon, Windows su Arm o Linux ARM64. Scegli `x64` per Mac con Intel e per la maggior parte dei PC Windows e Linux con processori Intel o AMD.

### Metodo 1 – Homebrew (macOS)

Installa e aggiorna con Homebrew:

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Metodo 2 – Download diretto

1. Scarica l’ultima versione dalla pagina delle [versioni](https://github.com/Shawshank01/Vidbutler/releases).
2. Avvia il programma di installazione per il tuo sistema operativo:
   - **macOS:** `.dmg`
   - **Windows:** programma di installazione `.exe`
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> L’app per macOS ha una firma ad hoc e non è autenticata da Apple tramite notarizzazione. macOS potrebbe bloccare l’installazione diretta da DMG. Si consiglia di usare Homebrew. Se scarichi direttamente l’app, potrebbe essere necessario scegliere **Apri comunque** in **Impostazioni di Sistema > Privacy e sicurezza** o, in alternativa, eseguire `xattr -cr /Applications/VidButler.app`.

### Metodo 3 – Dal codice sorgente

I flussi di integrazione continua usano Node.js 26 e pnpm 12. Per eseguire `pnpm start`, installa yt-dlp e FFmpeg. Su macOS esegui `brew install yt-dlp ffmpeg`. Su Ubuntu o Debian esegui `sudo apt install yt-dlp ffmpeg`. Su Windows aggiungi gli strumenti a `PATH`. Per imprimere i sottotitoli serve una build di FFmpeg con il filtro `subtitles`, per esempio `ffmpeg-full` di Homebrew. Installa Deno per il [supporto completo di YouTube](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Clona il repository:

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Installa le dipendenze:

   ```bash
   pnpm install
   ```

3. Avvia l’applicazione:

   ```bash
   pnpm start
   ```

   *(Su macOS puoi anche fare doppio clic su `start.command` nella radice del progetto per installare le dipendenze e avviare l’app.)*

#### Creare i pacchetti di distribuzione

Per creare un programma di installazione per la tua piattaforma:

```bash
pnpm run build
```

I programmi di installazione e gli eseguibili vengono salvati nella cartella `dist/`.

Le build di rilascio per macOS usano una firma ad hoc e non richiedono credenziali dell’Apple Developer Program. Dopo un aggiornamento, macOS potrebbe chiedere di nuovo l’accesso al browser. I pacchetti Windows vengono firmati se sono configurati i segreti facoltativi `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD`.

## Disinstallazione

Per rimuovere la versione Homebrew e i suoi dati locali, chiudi VidButler ed esegui `brew uninstall --cask --zap Shawshank01/tap/vidbutler`. Se hai installato l’app manualmente, usa **Informazioni su VidButler → Elimina dati locali** prima di rimuoverla. Verranno cancellati le impostazioni, le chiavi API salvate e le cache gestite dall’app. I download saranno conservati. Su macOS le versioni di sviluppo e distribuzione condividono questi dati. La pulizia non comprende le voci del portachiavi di macOS né le cache di strumenti autonomi o di versioni precedenti di VidButler.

## Uso della modalità IA

Fai clic su **IA** nell’angolo in alto a destra per aprire la chat. Puoi chiedere in linguaggio naturale di scaricare, convertire o esaminare contenuti multimediali, oppure di gestire file.

### Esempi di richieste

- *«Scarica questo video: https://…»*
- *«Scarica questo video in 720p: https://…»*
- *«Scarica il segmento da 0:45 a 2:10: https://…»*
- *«Scarica l’audio da 1:15 a 2:30: https://…»*
- *«Estrai l’audio di questo video in formato M4A»*
- *«Riassumi questo video: https://…»*
- *«In quali lingue sono disponibili i sottotitoli di questo video?»*, seguito da *«Imprimi quelli in inglese in alto»*
- *«Scaricalo e poi ricodificalo in un MP4 compatibile»*
- *«Mostrami il contenuto della cartella dei download»* / *«Elimina i file dei sottotitoli rimasti»*

Puoi scaricare clip da fonti online. La funzione richiede FFmpeg. Per usare un proxy, seleziona **HTTP** e inserisci l’indirizzo di un proxy HTTP che supporti CONNECT. Se il proxy offre solo SOCKS5, usa un bridge locale da HTTP a SOCKS5. I riepiloghi usano i sottotitoli disponibili e possono citare i riferimenti temporali. Le trascrizioni lunghe possono richiedere più richieste al fornitore di IA.

### Configurare un fornitore

1. Fai clic su **IA** in alto a destra e apri **Impostazioni IA**.
2. Seleziona il fornitore e controlla il modello. Se il fornitore usa una chiave API, incollala e fai clic su **Salva chiave**. Per Ollama o un server compatibile con OpenAI, controlla l’indirizzo del server.
3. Fai clic su **Prova connessione**, poi su **Salva**.
4. Scegli la cartella dei download e inizia a chattare.

| Fornitore | Requisiti | Note |
| --- | --- | --- |
| **Cohere** (predefinito, modello `command-a-plus-05-2026`) | Chiave API dalla [dashboard Cohere](https://dashboard.cohere.com/api-keys) | L’opzione più consigliata. Il piano gratuito è sufficiente per l’uso quotidiano. |
| **Google Gemini** (modello `gemini-3.5-flash-lite`) | Chiave API da [Google AI Studio](https://aistudio.google.com/apikey) | Questo modello offre un [piano gratuito](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). I messaggi vengono inviati a Google. |
| **xAI Grok** (modello `grok-4.3`) | Chiave API dalla [console xAI](https://console.x.ai) | Usalo per mostrare il tuo sostegno ai Rockets. |
| **Ollama (locale)** | [Ollama](https://ollama.com) in esecuzione con un modello che supporta le chiamate agli strumenti, per esempio `lfm3:1.7b`. | Con modello e server locali, l’app invia i dati della chat a Ollama sul tuo computer. |
| **Compatibile con OpenAI** | URL del server, nome del modello e, di solito, chiave API | Funziona con llama.cpp, OpenAI, OpenRouter, Groq, LM Studio e servizi simili. |

Per scaricare ed elaborare contenuti multimediali, scegli un modello che supporti le chiamate agli strumenti.

Altre impostazioni:

- **Sforzo di ragionamento**. Gemini e xAI offrono impostazioni specifiche. **Nessuno** disattiva il ragionamento su Grok 4.3 e usa l’impostazione predefinita per gli altri modelli xAI.
- **Livello di conferma**. Scegli quando chiedere l’approvazione: *Solo azioni rischiose* (predefinito), *Ogni azione* o *Mai*.

Se una richiesta al modello restituisce HTTP 503, di solito l’app riprova una volta. Per HTTP 429, riprova se il fornitore indica un intervallo `Retry-After` valido fino a 60 secondi. In caso di problemi di autenticazione, controlla la chiave in **Impostazioni IA** e fai clic su **Prova connessione**.

### Privacy e sicurezza

- **Dati inviati al fornitore**. L’app invia il contenuto della chat, le definizioni degli strumenti e i loro risultati al fornitore selezionato. I risultati possono includere titoli dei video, sottotitoli, nomi dei file e il percorso della cartella dei download.
- **Conservazione delle chiavi API**. Il modulo delle impostazioni passa la chiave al processo principale. Le chiavi salvate sono cifrate localmente tramite `safeStorage` di Electron. Se l’archiviazione sicura non è disponibile, le chiavi restano in memoria per la sessione corrente.
- **Cronologia della chat**. VidButler conserva la cronologia in memoria fino all’apertura di una nuova chat o alla chiusura dell’app. I fornitori ospitati applicano ai dati ricevuti le proprie politiche di conservazione.
- **Operazioni sui file**. L’assistente lavora sui contenuti multimediali nella cartella dei download scelta. Con le impostazioni predefinite, l’eliminazione dei file richiede conferma.

## Uso della modalità classica

La modalità classica funziona senza una chiave API di IA.

1. Incolla l’URL del video e scegli la cartella di destinazione.
2. Scegli un’azione:
   - **Scarica video (qualità migliore)**. Scarica il flusso della migliore qualità disponibile.
   - **Elenca formati**. Mostra tutti i flussi disponibili e il codice del rispettivo formato.
   - **Scarica (formato personalizzato)**. Inserisci il codice del formato. Usa prima **Elenca formati** per vedere le opzioni disponibili. Un codice di solo audio scarica soltanto l’audio.
   - **Scarica miniatura**. Salva solo l’immagine della miniatura.
   - **Scarica sottotitoli**. Mostra le tracce di sottotitoli disponibili e consente di scegliere quali salvare.
   - **Scarica e ricodifica in MP4 di alta qualità (H.264/AAC)**. Ricodifica con H.264/AAC per la massima compatibilità di riproduzione.
   - **Scarica e imprimi i sottotitoli**. Imprime i sottotitoli direttamente nel video, in alto o in basso.
3. Se necessario, scegli un **Browser per i cookie**, utile per i link privati o soggetti a limiti di età, oppure configura il **Proxy**.
4. Fai clic su **Esegui**.

Per interrompere un’attività in corso, fai clic su **Annulla azione**. VidButler elimina i file incompleti di FFmpeg se annulli una ricodifica o l’inserimento dei sottotitoli. I download interrotti possono lasciare file parziali.

## Aggiornamenti

I pacchetti macOS e Windows e le AppImage Linux verificano le versioni su GitHub all’avvio.

1. In **Windows e con AppImage su Linux**, scegli **Scarica e riavvia**. L’app verifica la somma di controllo, installa l’aggiornamento e avvia automaticamente la nuova versione.
2. Su **macOS**, scegli **Copia comando Homebrew** e incolla il comando nel Terminale per aggiornare il tap e installare la nuova versione.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   Se hai installato VidButler direttamente da un DMG, scegli **Apri versione su GitHub**.
3. Per verificare manualmente, fai clic sull’icona di VidButler e scegli **Cerca aggiornamenti**.

> [!NOTE]
> Se esegui l’app dal codice sorgente o da un pacchetto Linux estratto, **Cerca aggiornamenti** propone di aprire l’[ultima versione](https://github.com/Shawshank01/Vidbutler/releases/latest).

## Crediti

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Motore principale per il download di contenuti multimediali
- [FFmpeg](https://ffmpeg.org/) — Elaborazione, transcodifica di audio e video e inserimento dei sottotitoli
- [Deno](https://deno.com/) — Runtime JavaScript leggero per risolvere le sfide di yt-dlp
- [Electron](https://www.electronjs.org/) — Framework per applicazioni desktop

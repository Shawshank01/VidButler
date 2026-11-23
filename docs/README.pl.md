<p align="center">
  <img src="../build/icon.svg" alt="Ikona aplikacji do pobierania filmów" width="128">
</p>

# VidButler

[English](../README.md)

VidButler to wieloplatformowy asystent multimedialny oparty na Electronie, który korzysta z **yt-dlp** i **FFmpeg**. Pobieraj filmy i dźwięk z YouTube, X (Twittera), Instagrama i setek innych serwisów. Wybieraj formaty, wyodrębniaj napisy, przekodowuj filmy i wtapiaj w nie napisy. Tryb AI potrafi też streszczać filmy na podstawie dostępnych napisów i pobierać fragmenty ze źródeł internetowych według podanego czasu początkowego i końcowego.

Aplikacja ma dwa interfejsy, między którymi można w każdej chwili przełączać:

- **Tryb klasyczny** – formularz do wpisania adresu URL, wyboru czynności i ustawienia plików cookie oraz serwera proxy.
- **Tryb AI** – opisz własnymi słowami, co chcesz zrobić, np. *„Pobierz ten film z wtopionymi angielskimi napisami”*. Aplikacja zamienia polecenie na bezpieczne komendy `yt-dlp` lub `FFmpeg` i je wykonuje.

<!--
![Klasyczny interfejs VidButler](../public/YT-Downloader-UI.png)
*Klasyczny interfejs*
-->

![VidButler w trybie AI](../public/VidButler-UI.png)
*Interfejs trybu AI*

Kliknij ikonę VidButler, aby otworzyć okno **O aplikacji VidButler**. Z listy **Język** możesz wybrać angielski, niemiecki, francuski, hiszpański, włoski, polski, niderlandzki, portugalski, chiński uproszczony, chiński tradycyjny, japoński, rosyjski lub ukraiński. Opcja **Język systemu** używa preferencji systemu operacyjnego, a w razie braku obsługiwanego języka wybiera angielski. VidButler zapamiętuje wybór po ponownym uruchomieniu.

## Funkcje

- **Dwa interfejsy** – przełączaj się między klasycznym formularzem a rozmową z AI.
- **Obsługa wielu platform** – pobieraj multimedia przy użyciu `yt-dlp` z YouTube, X, Instagrama, TikToka i innych serwisów.
- **Jakość i format** – wybierz rozdzielczość i kontener lub wyodrębnij sam dźwięk (M4A, MP3, Opus, FLAC, WAV).
- **Osadzanie miniatur** – aplikacja osadza miniaturę w pobranym filmie, jeśli format na to pozwala. Możesz też zapisać samą miniaturę.
- **Napisy** – pobieraj napisy w wybranym języku lub wtapiaj je u góry albo u dołu obrazu.
- **Przekodowanie do MP4** – konwertuj filmy za pomocą FFmpeg do szeroko obsługiwanych plików MP4 z H.264/AAC.
- **Przyspieszenie sprzętowe** – na macOS aplikacja używa VideoToolbox do wtapiania napisów i tworzenia obsługiwanych fragmentów MP4.
- **Pliki cookie** – używaj plików cookie z Chrome, Firefoksa, Brave lub Safari do pobierania filmów z ograniczeniami wiekowymi lub dostępnych tylko dla członków.
- **Serwery proxy HTTP i SOCKS5** – kieruj pobieranie i zapytania przez lokalny lub zdalny serwer proxy. Włącz **Serwer proxy**, wybierz typ i wpisz host oraz port.
- **Anulowanie** – zatrzymaj trwające pobieranie lub kodowanie. Przerwane pobieranie może pozostawić niepełne pliki w folderze pobierania.

## Instalacja

Gotowe pakiety zawierają yt-dlp, FFmpeg i Deno. Wybierz `arm64` dla Apple Silicon, Windows na Arm lub Linuksa ARM64. Wybierz `x64` dla Maców z procesorem Intel i większości komputerów z Windows lub Linuksem z procesorem Intel albo AMD.

### Metoda 1 – Homebrew (macOS)

Instalacja i aktualizacja przez Homebrew:

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Metoda 2 – Pobieranie bezpośrednie

1. Pobierz najnowszą wersję ze strony [wydań](https://github.com/Shawshank01/Vidbutler/releases).
2. Uruchom instalator odpowiedni dla Twojego systemu:
   - **macOS:** `.dmg`
   - **Windows:** instalator `.exe`
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> Aplikacja dla macOS jest podpisana ad hoc i nie ma notaryzacji Apple. macOS może zablokować bezpośrednią instalację z pliku DMG. Zalecana jest instalacja przez Homebrew. Przy pobieraniu bezpośrednim może być konieczne wybranie **Otwórz mimo to** w **Ustawienia systemowe > Prywatność i ochrona** lub uruchomienie `xattr -cr /Applications/VidButler.app`.

### Metoda 3 – Z kodu źródłowego

Zadania CI używają Node.js 26 i pnpm 12. Przed uruchomieniem `pnpm start` zainstaluj yt-dlp i FFmpeg. Na macOS użyj `brew install yt-dlp ffmpeg`. Na Ubuntu lub Debianie użyj `sudo apt install yt-dlp ffmpeg`. Na Windows dodaj narzędzia do `PATH`. Wtapianie napisów wymaga kompilacji FFmpeg z filtrem `subtitles`, np. `ffmpeg-full` z Homebrew. Zainstaluj Deno, aby uzyskać [pełną obsługę YouTube](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Sklonuj repozytorium:

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Zainstaluj zależności:

   ```bash
   pnpm install
   ```

3. Uruchom aplikację:

   ```bash
   pnpm start
   ```

   *(Na macOS możesz też kliknąć dwukrotnie `start.command` w głównym katalogu projektu, aby zainstalować zależności i uruchomić aplikację.)*

#### Tworzenie pakietów instalacyjnych

Aby utworzyć instalator dla bieżącej platformy:

```bash
pnpm run build
```

Instalatory i pliki wykonywalne trafiają do katalogu `dist/`.

Wydania macOS mają podpis ad hoc i nie wymagają danych dostępowych do Apple Developer Program. Po aktualizacji macOS może ponownie poprosić o dostęp do przeglądarki. Kompilacje Windows są podpisywane, jeśli skonfigurowano opcjonalne sekrety `WIN_CSC_LINK` i `WIN_CSC_KEY_PASSWORD`.

## Odinstalowanie

Aby usunąć wydanie Homebrew i jego dane lokalne, zamknij VidButler i uruchom `brew uninstall --cask --zap Shawshank01/tap/vidbutler`. Przy instalacji ręcznej wybierz **O aplikacji VidButler → Usuń dane lokalne** przed usunięciem aplikacji. Spowoduje to usunięcie ustawień, zapisanych kluczy API i pamięci podręcznej zarządzanej przez aplikację. Pobrane pliki zostaną zachowane. Na macOS kompilacje deweloperskie i wydania współdzielą te dane. Czyszczenie nie obejmuje pęku kluczy macOS ani pamięci podręcznej samodzielnych narzędzi i starszych wydań VidButler.

## Korzystanie z trybu AI

Kliknij **AI** w prawym górnym rogu, aby otworzyć czat. Własnymi słowami poproś o pobranie, konwersję lub zbadanie multimediów albo o wykonanie operacji na plikach.

### Przykładowe polecenia

- *„Pobierz ten film: https://…”*
- *„Pobierz ten film w rozdzielczości 720p: https://…”*
- *„Pobierz fragment od 0:45 do 2:10: https://…”*
- *„Pobierz dźwięk od 1:15 do 2:30: https://…”*
- *„Pobierz dźwięk z tego filmu w formacie M4A”*
- *„Streść ten film: https://…”*
- *„W jakich językach są dostępne napisy do tego filmu?”*, a następnie *„Wtop angielskie napisy u góry”*
- *„Pobierz film, a potem przekoduj go do zgodnego formatu MP4”*
- *„Pokaż zawartość mojego folderu pobierania”* / *„Usuń pozostałe pliki z napisami”*

Pobieranie fragmentów działa ze źródłami internetowymi i wymaga FFmpeg. Aby użyć serwera proxy, wybierz **HTTP** i wpisz adres serwera proxy HTTP obsługującego metodę CONNECT. Jeśli serwer proxy obsługuje tylko SOCKS5, użyj lokalnego mostu HTTP–SOCKS5. Streszczenia filmów korzystają z dostępnych napisów i mogą odwoływać się do znaczników czasu. Długie transkrypcje mogą wymagać kilku zapytań do dostawcy AI.

### Konfiguracja dostawcy

1. Kliknij **AI** w prawym górnym rogu i otwórz **Ustawienia AI**.
2. Wybierz dostawcę i sprawdź model. Jeśli dostawca używa klucza API, wklej go i kliknij **Zapisz klucz**. W przypadku Ollama lub serwera zgodnego z OpenAI sprawdź adres serwera.
3. Kliknij **Sprawdź połączenie**, a potem **Zapisz**.
4. Wybierz folder pobierania i rozpocznij rozmowę.

| Dostawca | Wymagania | Uwagi |
| --- | --- | --- |
| **Cohere** (domyślny, model `command-a-plus-05-2026`) | Klucz API z [panelu Cohere](https://dashboard.cohere.com/api-keys) | Najbardziej polecana opcja. Bezpłatny pakiet wystarcza do codziennego użytku. |
| **Google Gemini** (model `gemini-3.5-flash-lite`) | Klucz API z [Google AI Studio](https://aistudio.google.com/apikey) | Ten model ma [bezpłatny pakiet](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). Wiadomości są wysyłane do Google. |
| **xAI Grok** (model `grok-4.3`) | Klucz API z [konsoli xAI](https://console.x.ai) | Użyj go, by okazać wsparcie drużynie Rockets. |
| **Ollama (lokalny)** | Uruchomiona [Ollama](https://ollama.com) z modelem obsługującym wywołania narzędzi, np. `lfm3:1.7b`. | Przy lokalnym modelu i serwerze aplikacja wysyła dane rozmowy do Ollama na Twoim komputerze. |
| **Zgodny z OpenAI** | Adres URL serwera, nazwa modelu i zazwyczaj klucz API | Działa z llama.cpp, OpenAI, OpenRouter, Groq, LM Studio i podobnymi usługami. |

Do pobierania i obróbki multimediów wybierz model obsługujący wywołania narzędzi.

Dodatkowe ustawienia:

- **Poziom rozumowania** – Gemini i xAI udostępniają ustawienia charakterystyczne dla dostawcy. Opcja **Brak** wyłącza rozumowanie w Grok 4.3 i zachowuje domyślny poziom w innych modelach xAI.
- **Poziom potwierdzania** – wybierz, kiedy aplikacja ma pytać o zgodę: *Tylko ryzykowne czynności* (domyślnie), *Każda czynność* lub *Nigdy*.

Po błędzie HTTP 503 aplikacja z reguły ponawia zapytanie do modelu raz. Po błędzie HTTP 429 ponawia je, jeśli dostawca poda poprawny czas oczekiwania w `Retry-After`, nieprzekraczający 60 sekund. W razie błędu uwierzytelniania sprawdź klucz w **Ustawieniach AI** i kliknij **Sprawdź połączenie**.

### Prywatność i bezpieczeństwo

- **Dane wysyłane do dostawcy** – aplikacja przekazuje treść rozmowy oraz definicje i wyniki wywołań narzędzi wybranemu dostawcy. Wyniki mogą zawierać tytuły filmów, napisy, nazwy plików i ścieżkę do folderu pobierania.
- **Przechowywanie kluczy API** – formularz ustawień przekazuje klucz do głównego procesu. Zapisane klucze są lokalnie szyfrowane przy użyciu `safeStorage` z Electrona. Jeśli nie ma bezpiecznego magazynu, pozostają w pamięci przez bieżącą sesję aplikacji.
- **Historia rozmów** – VidButler przechowuje historię w pamięci do rozpoczęcia nowej rozmowy lub zamknięcia aplikacji. Dostawcy usług hostowanych stosują własne zasady przechowywania otrzymanych danych.
- **Operacje na plikach** – asystent pracuje na multimediach w wybranym folderze pobierania. Domyślnie usunięcie pliku wymaga potwierdzenia.

## Korzystanie z trybu klasycznego

Tryb klasyczny działa bez klucza API do usługi AI.

1. Wklej adres URL filmu i wybierz folder docelowy.
2. Wybierz czynność:
   - **Pobierz film (najlepsza jakość)** – pobiera najlepszy dostępny strumień.
   - **Wyświetl formaty** – pokazuje wszystkie dostępne strumienie i ich kody formatów.
   - **Pobierz (wybrany format)** – wpisz kod formatu. Najpierw wybierz **Wyświetl formaty**, aby zobaczyć opcje. Kod formatu audio pozwala pobrać sam dźwięk.
   - **Pobierz miniaturę** – zapisuje wyłącznie miniaturę.
   - **Pobierz napisy** – wyświetla dostępne ścieżki napisów i pozwala wybrać, które zapisać.
   - **Pobierz i przekoduj do MP4 w wysokiej jakości (H.264/AAC)** – przekodowuje z użyciem H.264/AAC, aby zmaksymalizować zgodność odtwarzania.
   - **Pobierz i wtop napisy** – trwale wstawia napisy u góry albo u dołu obrazu.
3. W razie potrzeby ustaw **Przeglądarkę źródłową plików cookie**, przydatną przy prywatnych filmach lub ograniczeniach wiekowych, albo skonfiguruj **Serwer proxy**.
4. Kliknij **Uruchom**.

Aby zatrzymać trwającą operację, kliknij **Anuluj czynność**. Po anulowaniu przekodowywania lub wtapiania napisów VidButler usuwa niepełne pliki wyjściowe FFmpeg. Przerwane pobieranie może pozostawić niepełne pliki.

## Aktualizowanie

Gotowe pakiety dla macOS i Windows oraz AppImage dla Linuksa sprawdzają wydania GitHub przy uruchomieniu.

1. W **Windows lub Linux AppImage** wybierz **Pobierz i uruchom ponownie**. Aplikacja sprawdza sumę kontrolną, instaluje aktualizację i automatycznie uruchamia nową wersję.
2. Na **macOS** wybierz **Kopiuj polecenie Homebrew**, a następnie wklej je w Terminalu, aby odświeżyć repozytorium Homebrew i zaktualizować aplikację.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   Jeżeli zainstalowano VidButler bezpośrednio z pliku DMG, wybierz **Otwórz wydanie w GitHubie**.
3. Aby sprawdzić ręcznie, kliknij ikonę VidButler i wybierz **Sprawdź aktualizacje**.

> [!NOTE]
> Przy uruchomieniu z kodu źródłowego lub rozpakowanej kompilacji dla Linuksa opcja **Sprawdź aktualizacje** umożliwia otwarcie strony [najnowszego wydania](https://github.com/Shawshank01/Vidbutler/releases/latest).

## Wykorzystane projekty

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) – główny mechanizm pobierania multimediów
- [FFmpeg](https://ffmpeg.org/) – przetwarzanie i przekodowywanie dźwięku oraz obrazu, a także wtapianie napisów
- [Deno](https://deno.com/) – lekkie środowisko JavaScript do rozwiązywania zadań dla yt-dlp
- [Electron](https://www.electronjs.org/) – framework do tworzenia aplikacji komputerowych

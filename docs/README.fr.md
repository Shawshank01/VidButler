<p align="center">
  <img src="../build/icon.svg" alt="Icône de l’application de téléchargement vidéo" width="128">
</p>

# VidButler

[English](../README.md)

VidButler est un assistant multimédia multiplateforme conçu avec Electron et propulsé par **yt-dlp** et **FFmpeg**. Téléchargez de la vidéo et de l’audio depuis YouTube, X (Twitter), Instagram et des centaines d’autres sites. Vous pouvez choisir le format, extraire les sous-titres, réencoder la vidéo et y incruster des sous-titres. Le mode IA peut également résumer les vidéos à partir des sous-titres disponibles et télécharger des extraits de sources en ligne en précisant les temps de début et de fin.

L’application propose deux interfaces entre lesquelles vous pouvez basculer à tout moment :

- **Mode classique** — Un formulaire pour l’URL, l’action à effectuer et les réglages des cookies et du proxy.
- **Mode IA** — Décrivez votre demande en langage courant, par exemple *« Télécharge cette vidéo et incruste les sous-titres anglais »*. L’application la traduit en commandes `yt-dlp` ou `FFmpeg` sûres et les exécute.

<!--
![Interface classique de VidButler](../public/YT-Downloader-UI.png)
*Interface classique*
-->

![VidButler en mode IA](../public/VidButler-UI.png)
*Interface en mode IA*

Cliquez sur l’icône de VidButler pour ouvrir **À propos de VidButler**, puis utilisez le sélecteur **Langue** pour choisir l’anglais, l’allemand, le français, l’espagnol, l’italien, le polonais, le néerlandais, le portugais, le chinois simplifié, le chinois traditionnel, le japonais, le russe ou l’ukrainien. L’option **Langue du système** suit les préférences du système d’exploitation et utilise l’anglais par défaut si aucune langue ne correspond. VidButler conserve votre choix après redémarrage.

## Fonctionnalités

- **Deux interfaces** — Passez à tout moment du formulaire classique à la conversation avec l’IA.
- **De nombreuses plateformes** — Téléchargez des médias avec `yt-dlp` depuis YouTube, X, Instagram, TikTok et d’autres sites.
- **Qualité et format** — Choisissez une résolution et un conteneur, ou extrayez directement l’audio (M4A, MP3, Opus, FLAC, WAV).
- **Miniatures intégrées** — L’application intègre les miniatures aux téléchargements vidéo compatibles. Vous pouvez aussi enregistrer la miniature seule.
- **Sous-titres** — Téléchargez les sous-titres par langue ou incrustez-les en haut ou en bas de la vidéo.
- **Réencodage MP4** — Convertissez vos vidéos en MP4 H.264/AAC, un format largement compatible, avec FFmpeg.
- **Accélération matérielle** — Utilise VideoToolbox sous macOS pour l’incrustation de sous-titres et les extraits MP4 compatibles.
- **Cookies du navigateur** — Utilisez les cookies de Chrome, Firefox, Brave ou Safari pour télécharger les vidéos soumises à une limite d’âge ou réservées aux membres.
- **Proxys HTTP et SOCKS5** — Faites passer les téléchargements et requêtes par un proxy local ou distant. Activez **Proxy**, choisissez le type et saisissez l’hôte et le port.
- **Annulation** — Arrêtez un téléchargement ou un encodage en cours. Un téléchargement interrompu peut laisser des fichiers partiels dans le dossier de téléchargement.

## Installation

Les versions distribuées incluent yt-dlp, FFmpeg et Deno. Choisissez `arm64` pour Apple Silicon, Windows sur Arm ou Linux ARM64. Choisissez `x64` pour les Mac Intel et la plupart des PC Windows et Linux équipés d’un processeur Intel ou AMD.

### Méthode 1 — Homebrew (macOS)

Installez et mettez à jour l’application avec Homebrew :

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Méthode 2 — Téléchargement direct

1. Téléchargez la dernière version depuis la page [Versions](https://github.com/Shawshank01/Vidbutler/releases).
2. Lancez le programme d’installation correspondant à votre système :
   - **macOS:** `.dmg`
   - **Windows :** programme d’installation `.exe`
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> L’application macOS est signée ad hoc et n’a pas été notariée par Apple. macOS peut bloquer l’installation directe depuis un DMG. L’installation via Homebrew est recommandée. En cas de téléchargement direct, utilisez si nécessaire **Ouvrir quand même** dans **Réglages Système > Confidentialité et sécurité**, ou exécutez `xattr -cr /Applications/VidButler.app` en dernier recours.

### Méthode 3 — Depuis le code source

Les workflows d’intégration continue utilisent Node.js 26 et pnpm 12. Pour lancer `pnpm start`, installez yt-dlp et FFmpeg sur votre système. Sous macOS, exécutez `brew install yt-dlp ffmpeg`. Sous Ubuntu ou Debian, exécutez `sudo apt install yt-dlp ffmpeg`. Sous Windows, ajoutez les outils à votre `PATH`. L’incrustation de sous-titres nécessite une version de FFmpeg dotée du filtre `subtitles`, par exemple `ffmpeg-full` dans Homebrew. Installez Deno pour une [prise en charge complète de YouTube](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Clonez le dépôt :

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Installez les dépendances :

   ```bash
   pnpm install
   ```

3. Lancez l’application :

   ```bash
   pnpm start
   ```

   *(Sous macOS, vous pouvez aussi double-cliquer sur `start.command` à la racine du projet pour installer les dépendances et lancer l’application.)*

#### Générer les paquets de distribution

Pour créer un programme d’installation pour votre plateforme :

```bash
pnpm run build
```

Les programmes d’installation et les exécutables sont placés dans le dossier `dist/`.

Les versions macOS sont signées ad hoc et ne nécessitent pas d’identifiants Apple Developer Program. Après une mise à jour, macOS peut vous redemander l’accès au navigateur. Les exécutables Windows sont signés si les secrets facultatifs `WIN_CSC_LINK` et `WIN_CSC_KEY_PASSWORD` sont configurés.

## Désinstallation

Pour supprimer la version Homebrew et ses données locales, quittez VidButler et exécutez `brew uninstall --cask --zap Shawshank01/tap/vidbutler`. Pour une installation manuelle, utilisez **À propos de VidButler → Supprimer les données locales** avant de retirer l’application. Cela efface les réglages, les clés API enregistrées et les caches gérés par l’application. Vos téléchargements sont conservés. Sous macOS, les versions de développement et de production partagent ces données. Le nettoyage ne couvre ni les entrées du trousseau macOS ni les caches d’outils autonomes ou d’anciennes versions de VidButler.

## Utilisation du mode IA

Cliquez sur **IA** en haut à droite pour ouvrir la conversation. Vous pouvez demander en langage courant de télécharger, convertir ou analyser des médias, ou de gérer des fichiers.

### Exemples de demandes

- *« Télécharge cette vidéo : https://… »*
- *« Télécharge cette vidéo en 720p : https://… »*
- *« Télécharge l’extrait de 0:45 à 2:10 : https://… »*
- *« Télécharge l’audio de 1:15 à 2:30 : https://… »*
- *« Récupère l’audio de cette vidéo au format M4A »*
- *« Résume cette vidéo : https://… »*
- *« Dans quelles langues les sous-titres de cette vidéo sont-ils disponibles ? »*, puis *« Incruste les sous-titres anglais en haut »*
- *« Télécharge la vidéo, puis réencode-la en MP4 compatible »*
- *« Montre le contenu de mon dossier de téléchargement »* / *« Supprime les fichiers de sous-titres restants »*

Le téléchargement d’extraits fonctionne avec des sources en ligne et nécessite FFmpeg. Avec un proxy, sélectionnez **HTTP** et saisissez l’adresse d’un proxy HTTP qui prend en charge CONNECT. Si votre proxy propose uniquement SOCKS5, utilisez une passerelle locale HTTP vers SOCKS5. Les résumés s’appuient sur les sous-titres disponibles et peuvent citer des repères temporels. Les longues transcriptions peuvent nécessiter plusieurs requêtes auprès du fournisseur IA.

### Configurer un fournisseur

1. Cliquez sur **IA** en haut à droite, puis ouvrez les **Paramètres de l’IA**.
2. Choisissez votre fournisseur et vérifiez le modèle. Si une clé API est nécessaire, collez-la et cliquez sur **Enregistrer la clé**. Pour Ollama ou un serveur compatible OpenAI, vérifiez l’adresse du serveur.
3. Cliquez sur **Tester la connexion**, puis sur **Enregistrer**.
4. Choisissez votre dossier de téléchargement et commencez à discuter.

| Fournisseur | Prérequis | Remarques |
| --- | --- | --- |
| **Cohere** (modèle `command-a-plus-05-2026`) | Clé API du [tableau de bord Cohere](https://dashboard.cohere.com/api-keys) | Option la plus recommandée. L’offre gratuite suffit pour un usage quotidien. |
| **Google Gemini** (par défaut, modèle `gemini-3.5-flash-lite`) | Clé API de [Google AI Studio](https://aistudio.google.com/apikey) | Le modèle par défaut propose une [offre gratuite](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). Vos messages sont envoyés à Google. |
| **xAI Grok** (modèle `grok-4.3`) | Clé API de la [console xAI](https://console.x.ai) | Utilisez-le pour montrer votre soutien aux Rockets. |
| **Ollama (local)** | [Ollama](https://ollama.com) doit être lancé avec un modèle qui prend en charge les appels d’outils, par exemple `lfm3:1.7b`. | Avec un modèle et un serveur locaux, l’application envoie les données du chat à Ollama sur votre ordinateur. |
| **Compatible OpenAI** | URL du serveur, nom du modèle et généralement une clé API | Fonctionne avec llama.cpp, OpenAI, OpenRouter, Groq, LM Studio et des services similaires. |

Pour télécharger et traiter des médias, choisissez un modèle qui prend en charge les appels d’outils.

Autres réglages :

- **Effort de raisonnement** — Gemini et xAI proposent des réglages propres à chaque fournisseur. **Aucun** désactive le raisonnement sur Grok 4.3 et conserve l’effort par défaut sur les autres modèles xAI.
- **Niveau de confirmation** — Choisissez quand demander votre accord : *Actions risquées uniquement* (par défaut), *Chaque action* ou *Jamais*.

Après une erreur HTTP 503 lors d’une requête au modèle, l’application réessaie généralement une fois. Après une erreur HTTP 429, elle réessaie si le fournisseur indique un délai `Retry-After` valide de 60 secondes au plus. En cas d’erreur d’authentification, vérifiez la clé dans les **Paramètres de l’IA**, puis cliquez sur **Tester la connexion**.

### Confidentialité et sécurité

- **Données envoyées au fournisseur** — L’application transmet le contenu du chat ainsi que les définitions et les résultats des outils au fournisseur choisi. Les résultats peuvent contenir des titres de vidéos, des sous-titres, des noms de fichiers et le chemin du dossier de téléchargement.
- **Stockage des clés API** — Le formulaire transmet la clé au processus principal. Les clés enregistrées sont chiffrées localement avec `safeStorage` d’Electron. Si le stockage sécurisé est indisponible, elles restent en mémoire pendant la session en cours.
- **Historique du chat** — VidButler garde l’historique en mémoire jusqu’à l’ouverture d’une nouvelle conversation ou la fermeture de l’application. Les fournisseurs hébergés appliquent leurs propres règles de conservation aux données transmises.
- **Opérations sur les fichiers** — L’assistant traite les médias du dossier de téléchargement choisi. Les réglages par défaut exigent une confirmation pour supprimer des fichiers.

## Utilisation du mode classique

Le mode classique fonctionne sans clé API d’IA.

1. Collez l’URL de la vidéo et choisissez le dossier de destination.
2. Choisissez une action :
   - **Télécharger la vidéo (qualité optimale)** — Télécharge le meilleur flux disponible.
   - **Lister les formats** — Affiche tous les flux disponibles et leur code de format.
   - **Télécharger (format personnalisé)** — Saisissez un code de format. Utilisez **Lister les formats** pour voir les options disponibles. Un code de format audio seul télécharge uniquement l’audio.
   - **Télécharger la miniature** — Enregistre uniquement la miniature.
   - **Télécharger les sous-titres** — Affiche les pistes de sous-titres disponibles et vous permet de choisir celles à sauvegarder.
   - **Télécharger et réencoder en MP4 haute qualité (H.264/AAC)** — Réencode en H.264/AAC pour assurer une compatibilité de lecture maximale.
   - **Télécharger et incruster les sous-titres** — Incruste les sous-titres en haut ou en bas de la vidéo.
3. Au besoin, choisissez un **Navigateur pour les cookies**, par exemple pour les liens privés ou soumis à une limite d’âge, ou configurez le **Proxy**.
4. Cliquez sur **Exécuter**.

Pour arrêter une tâche en cours, cliquez sur **Annuler l’action**. VidButler supprime les fichiers FFmpeg incomplets si vous annulez un réencodage ou une incrustation. Un téléchargement interrompu peut laisser des fichiers partiels.

## Mise à jour

Les versions distribuées pour macOS et Windows et les AppImage Linux vérifient les versions publiées sur GitHub au démarrage.

1. Sous **Windows et avec une AppImage Linux**, choisissez **Télécharger et redémarrer**. La somme de contrôle est vérifiée, la mise à jour est installée et la nouvelle version se lance automatiquement.
2. Sous **macOS**, choisissez **Copier la commande Homebrew**, puis collez-la dans Terminal pour actualiser le tap et installer la nouvelle version.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   Si VidButler a été installé directement depuis un DMG, choisissez **Ouvrir la version sur GitHub**.
3. Pour vérifier manuellement, cliquez sur l’icône de VidButler et choisissez **Rechercher des mises à jour**.

> [!NOTE]
> Pour une exécution depuis les sources ou un paquet Linux extrait, **Rechercher des mises à jour** propose d’ouvrir la [dernière version](https://github.com/Shawshank01/Vidbutler/releases/latest).

## Crédits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Moteur principal de téléchargement des médias
- [FFmpeg](https://ffmpeg.org/) — Traitement, transcodage audio et vidéo et incrustation de sous-titres
- [Deno](https://deno.com/) — Environnement JavaScript léger pour résoudre les défis de yt-dlp
- [Electron](https://www.electronjs.org/) — Framework pour applications de bureau

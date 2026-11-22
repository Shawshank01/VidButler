<p align="center">
  <img src="../build/icon.svg" alt="Ícone da aplicação de transferência de vídeos" width="128">
</p>

# VidButler

[English](../README.md)

VidButler é uma aplicação de ambiente de trabalho baseada no Electron que descarrega e processa conteúdos multimédia com **yt-dlp** e **FFmpeg**. Descarregue vídeo e áudio do YouTube, X (Twitter), Instagram e centenas de outros sites. Pode escolher o formato, extrair legendas, recodificar vídeos e incorporar legendas na imagem.

Pode alternar entre duas interfaces a qualquer momento:

- **Modo clássico**. Um formulário para introduzir o URL, escolher a ação e configurar cookies e proxies.
- **Modo IA**. Descreva o que pretende em linguagem natural, por exemplo, *«Descarrega este vídeo e incorpora as legendas em inglês»*. A aplicação converte o pedido em comandos seguros de `yt-dlp` ou `FFmpeg` e executa-os.

<!--
![Interface clássica do VidButler](../public/YT-Downloader-UI.png)
*Interface clássica*
-->

![VidButler no modo IA](../public/VidButler-UI.png)
*Interface do modo IA*

Clique no ícone do VidButler para abrir **Sobre o VidButler** e use o seletor **Idioma** para escolher inglês, alemão, francês, espanhol, italiano, polaco, neerlandês, português, chinês simplificado, chinês tradicional, japonês, russo ou ucraniano. **Idioma do sistema** segue as preferências do sistema operativo e usa o inglês quando não existe correspondência. O VidButler mantém a escolha após reiniciar.

## Funcionalidades

- **Duas interfaces**. Alterne entre o formulário clássico e a conversa com a IA a qualquer momento.
- **Várias plataformas**. Descarregue conteúdos com `yt-dlp` do YouTube, X, Instagram, TikTok e de outros sites.
- **Qualidade e formato**. Escolha a resolução e o contentor ou extraia diretamente o áudio (M4A, MP3, Opus, FLAC, WAV).
- **Miniaturas incorporadas**. A aplicação incorpora miniaturas nos vídeos descarregados compatíveis. Também pode guardar apenas a miniatura.
- **Legendas**. Descarregue legendas por idioma ou incorpore-as na imagem, em cima ou em baixo.
- **Recodificação para MP4**. Converta vídeos em ficheiros MP4 H.264/AAC amplamente compatíveis com o FFmpeg.
- **Aceleração por hardware**. Utiliza o VideoToolbox do macOS para incorporar legendas e criar excertos MP4 compatíveis.
- **Cookies do navegador**. Utilize cookies do Chrome, Firefox, Brave ou Safari para descarregar vídeos com restrições de idade ou reservados a membros.
- **Proxies HTTP e SOCKS5**. Encaminhe transferências e pedidos através de um proxy local ou remoto. Ative **Proxy**, selecione o tipo e introduza o servidor e a porta.
- **Cancelamento**. Pare uma transferência ou codificação em curso. Uma transferência interrompida pode deixar ficheiros incompletos na pasta de transferências.

## Instalação

As versões empacotadas incluem yt-dlp, FFmpeg e Deno. Escolha `arm64` para Apple Silicon, Windows em Arm ou Linux ARM64. Escolha `x64` para Mac com Intel e para a maioria dos computadores Windows e Linux com processador Intel ou AMD.

### Método 1 – Homebrew (macOS)

Instale e atualize com o Homebrew:

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Método 2 – Transferência direta

1. Descarregue a versão mais recente da página de [versões](https://github.com/Shawshank01/Vidbutler/releases).
2. Execute o instalador para o seu sistema operativo:
   - **macOS:** `.dmg`
   - **Windows:** instalador `.exe`
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> A aplicação para macOS tem uma assinatura ad hoc e não foi notarizada pela Apple. O macOS pode bloquear a instalação direta a partir de um DMG. Recomenda-se a instalação pelo Homebrew. Se descarregar diretamente a aplicação, poderá ter de escolher **Abrir mesmo assim** em **Definições do Sistema > Privacidade e segurança**, ou executar `xattr -cr /Applications/VidButler.app` em alternativa.

### Método 3 – A partir do código-fonte

Os fluxos de integração contínua utilizam Node.js 26 e pnpm 12. Para executar `pnpm start`, instale yt-dlp e FFmpeg. No macOS, execute `brew install yt-dlp ffmpeg`. No Ubuntu ou Debian, execute `sudo apt install yt-dlp ffmpeg`. No Windows, adicione as ferramentas ao `PATH`. A incorporação de legendas requer uma compilação do FFmpeg com o filtro `subtitles`, como `ffmpeg-full` do Homebrew. Instale o Deno para obter [suporte completo para o YouTube](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Clone o repositório:

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Instale as dependências:

   ```bash
   pnpm install
   ```

3. Inicie a aplicação:

   ```bash
   pnpm start
   ```

   *(No macOS, também pode fazer duplo clique em `start.command` na raiz do projeto para instalar as dependências e iniciar a aplicação.)*

#### Criar pacotes de distribuição

Para criar um instalador para a plataforma atual:

```bash
pnpm run build
```

Os instaladores e executáveis são guardados na pasta `dist/`.

As versões para macOS utilizam uma assinatura ad hoc e não exigem credenciais do Apple Developer Program. Depois de uma atualização, o macOS pode voltar a pedir acesso ao navegador. As compilações para Windows são assinadas quando os segredos opcionais `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD` estão configurados.

## Desinstalação

Para remover a versão Homebrew e os seus dados locais, saia do VidButler e execute `brew uninstall --cask --zap Shawshank01/tap/vidbutler`. Se instalou a aplicação manualmente, use **Sobre o VidButler → Apagar dados locais** antes de a remover. Isto apaga as definições, as chaves de API guardadas e as caches geridas pela aplicação. Os ficheiros descarregados são mantidos. No macOS, as versões de desenvolvimento e distribuição partilham estes dados. A limpeza não abrange entradas do Porta-chaves do macOS nem caches de ferramentas autónomas ou de versões anteriores do VidButler.

## Utilizar o modo IA

Clique em **IA** no canto superior direito para abrir a conversa. Pode pedir em linguagem natural para descarregar, converter ou analisar conteúdos multimédia ou para gerir ficheiros.

### Exemplos de pedidos

- *«Descarrega este vídeo: https://…»*
- *«Descarrega este vídeo em 720p: https://…»*
- *«Descarrega o excerto de 0:45 a 2:10: https://…»*
- *«Descarrega o áudio de 1:15 a 2:30: https://…»*
- *«Extrai o áudio deste vídeo em M4A»*
- *«Resume este vídeo: https://…»*
- *«Em que idiomas há legendas para este vídeo?»*, seguido de *«Incorpora as legendas em inglês no topo»*
- *«Descarrega o vídeo e recodifica-o para um MP4 compatível»*
- *«Mostra o conteúdo da minha pasta de transferências»* / *«Apaga os ficheiros de legendas que sobraram»*

A transferência de excertos funciona com fontes online e requer o FFmpeg. Para usar um proxy, selecione **HTTP** e introduza o endereço de um proxy HTTP que suporte CONNECT. Se o proxy só disponibilizar SOCKS5, use uma ponte local de HTTP para SOCKS5. Os resumos baseiam-se nas legendas disponíveis e podem citar marcas de tempo. Transcrições longas podem exigir vários pedidos ao fornecedor de IA.

### Configurar um fornecedor

1. Clique em **IA** no canto superior direito e abra as **Definições de IA**.
2. Escolha o fornecedor e confirme o modelo. Se o fornecedor utilizar uma chave de API, cole-a e clique em **Guardar chave**. Para o Ollama ou um servidor compatível com OpenAI, verifique o endereço do servidor.
3. Clique em **Testar ligação** e depois em **Guardar**.
4. Escolha a pasta de transferências e inicie a conversa.

| Fornecedor | Requisitos | Notas |
| --- | --- | --- |
| **Google Gemini** (predefinição, modelo `gemini-3.5-flash-lite`) | Chave de API do [Google AI Studio](https://aistudio.google.com/apikey) | O modelo predefinido tem um [nível gratuito](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). As suas mensagens são enviadas para a Google. |
| **xAI Grok** (modelo `grok-4.3`) | Chave de API da [consola da xAI](https://console.x.ai) | Utiliza a API Responses da xAI em `https://api.x.ai/v1/responses`. As suas mensagens são enviadas para a xAI. |
| **Cohere** (modelo `command-a-plus-05-2026`) | Chave de API do [painel da Cohere](https://dashboard.cohere.com/api-keys) | Transmite respostas através da [API Chat da Cohere](https://docs.cohere.com/docs/streaming). As suas mensagens são enviadas para a Cohere. |
| **Ollama (local)** | [Ollama](https://ollama.com) em execução com um modelo que suporta chamadas a ferramentas, como `lfm3:1.7b`. | Com o modelo e o servidor locais, a aplicação envia os dados da conversa para o Ollama no seu computador. |
| **Compatível com OpenAI** | URL do servidor, nome do modelo e, normalmente, uma chave de API | Funciona com llama.cpp, OpenAI, OpenRouter, Groq, LM Studio e serviços semelhantes. |

Para descarregar e processar conteúdos multimédia, escolha um modelo que suporte chamadas a ferramentas.

Definições adicionais:

- **Esforço de raciocínio**. O Gemini e a xAI têm definições específicas. **Nenhum** desativa o raciocínio no Grok 4.3 e usa o esforço predefinido nos restantes modelos da xAI.
- **Nível de confirmação**. Escolha quando pedir autorização: *Apenas ações de risco* (predefinição), *Todas as ações* ou *Nunca*.

Se um pedido ao modelo falhar com HTTP 503, a aplicação costuma tentar novamente uma vez. Em caso de HTTP 429, volta a tentar se o fornecedor indicar um intervalo `Retry-After` válido de até 60 segundos. Em caso de erro de autenticação, verifique a chave nas **Definições de IA** e clique em **Testar ligação**.

### Privacidade e segurança

- **Dados enviados ao fornecedor**. A aplicação envia o conteúdo da conversa, as definições das ferramentas e os seus resultados ao fornecedor selecionado. Os resultados podem incluir títulos de vídeos, legendas, nomes de ficheiros e o caminho da pasta de transferências.
- **Armazenamento de chaves de API**. O formulário de definições envia a chave ao processo principal. As chaves guardadas são cifradas localmente com `safeStorage` do Electron. Se não houver armazenamento seguro, as chaves ficam na memória durante a sessão atual.
- **Histórico da conversa**. O VidButler mantém o histórico na memória até iniciar uma nova conversa ou sair da aplicação. Os fornecedores alojados tratam os dados recebidos de acordo com as suas próprias políticas de conservação.
- **Operações sobre ficheiros**. O assistente trabalha com os conteúdos multimédia da pasta de transferências selecionada. As definições predefinidas exigem confirmação para apagar ficheiros.

## Utilizar o modo clássico

O modo clássico funciona sem uma chave de API de IA.

1. Cole o URL do vídeo e escolha a pasta de destino.
2. Escolha uma ação:
   - **Descarregar vídeo (melhor qualidade)**. Descarrega o fluxo com a melhor qualidade disponível.
   - **Listar formatos**. Mostra todos os fluxos disponíveis e os respetivos códigos de formato.
   - **Descarregar (formato personalizado)**. Introduza um código de formato. Use primeiro **Listar formatos** para consultar as opções. Escolha um código de áudio para descarregar apenas o áudio.
   - **Descarregar miniatura**. Guarda apenas a imagem da miniatura.
   - **Descarregar legendas**. Mostra as faixas de legendas disponíveis e permite escolher quais guardar.
   - **Descarregar e recodificar em MP4 de alta qualidade (H.264/AAC)**. Recodifica com H.264/AAC para maximizar a compatibilidade de reprodução.
   - **Descarregar e incorporar legendas**. Incorpora as legendas diretamente na imagem do vídeo, em cima ou em baixo.
3. Se necessário, escolha um **Navegador para cookies**, útil para ligações privadas ou com restrições de idade, ou configure o **Proxy**.
4. Clique em **Executar**.

Para parar uma tarefa em curso, clique em **Cancelar ação**. O VidButler remove os ficheiros incompletos do FFmpeg ao cancelar uma recodificação ou incorporação de legendas. Uma transferência interrompida pode deixar ficheiros parciais.

## Atualizar

Os pacotes para macOS e Windows e os AppImage para Linux consultam as versões do GitHub ao iniciar.

1. Em **Windows e Linux AppImage**, escolha **Descarregar e reiniciar**. A soma de verificação é validada, a atualização é instalada e a nova versão inicia automaticamente.
2. No **macOS**, escolha **Copiar comando do Homebrew** e cole o comando no Terminal para atualizar o tap e instalar a nova versão.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   Se instalou o VidButler diretamente a partir de um DMG, escolha **Abrir versão no GitHub**.
3. Para verificar manualmente, clique no ícone do VidButler e escolha **Procurar atualizações**.

> [!NOTE]
> Ao executar a partir do código-fonte ou de uma compilação Linux extraída, **Procurar atualizações** permite abrir a [versão mais recente](https://github.com/Shawshank01/Vidbutler/releases/latest).

## Créditos

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Motor principal de transferência de conteúdos multimédia
- [FFmpeg](https://ffmpeg.org/) — Processamento e transcodificação de áudio e vídeo e incorporação de legendas
- [Deno](https://deno.com/) — Runtime JavaScript leve para resolver os desafios do yt-dlp
- [Electron](https://www.electronjs.org/) — Framework para aplicações de ambiente de trabalho

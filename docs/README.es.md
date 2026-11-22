<p align="center">
  <img src="../build/icon.svg" alt="Icono de la aplicación de descarga de vídeos" width="128">
</p>

# VidButler

[English](../README.md)

VidButler es un asistente multimedia multiplataforma creado con Electron y basado en **yt-dlp** y **FFmpeg**. Descarga vídeo y audio de YouTube, X (Twitter), Instagram y cientos de sitios más. Puedes elegir el formato, extraer subtítulos, recodificar vídeos e incrustar subtítulos en la imagen. El modo IA también puede resumir vídeos a partir de los subtítulos disponibles y descargar fragmentos de fuentes en línea indicando la hora de inicio y de fin.

Puedes cambiar de interfaz en cualquier momento:

- **Modo clásico**. Formulario para introducir la URL, elegir la acción y configurar las cookies y el proxy.
- **Modo IA**. Describe lo que quieres hacer en lenguaje natural, por ejemplo, *«Descarga este vídeo e incrusta los subtítulos en inglés»*. La aplicación convierte tu petición en comandos seguros de `yt-dlp` o `FFmpeg` y los ejecuta.

<!--
![Interfaz clásica de VidButler](../public/YT-Downloader-UI.png)
*Interfaz clásica*
-->

![VidButler en modo IA](../public/VidButler-UI.png)
*Interfaz del modo IA*

Haz clic en el icono de VidButler para abrir **Acerca de VidButler** y usa el selector **Idioma** para elegir inglés, alemán, francés, español, italiano, polaco, neerlandés, portugués, chino simplificado, chino tradicional, japonés, ruso o ucraniano. **Idioma del sistema** sigue las preferencias del sistema operativo y usa el inglés si no hay coincidencias. VidButler recuerda tu elección al reiniciar.

## Funciones

- **Dos interfaces**. Alterna en cualquier momento entre el formulario clásico y el chat con IA.
- **Numerosas plataformas**. Descarga contenido con `yt-dlp` desde YouTube, X, Instagram, TikTok y otros sitios.
- **Calidad y formato**. Elige la resolución y el contenedor o extrae directamente el audio (M4A, MP3, Opus, FLAC, WAV).
- **Miniaturas integradas**. La aplicación añade las miniaturas a las descargas compatibles. También puedes guardar solo la miniatura.
- **Subtítulos**. Descarga subtítulos por idioma o incrústalos arriba o abajo en la imagen del vídeo.
- **Recodificación a MP4**. Convierte vídeos a archivos MP4 con H.264/AAC de amplia compatibilidad mediante FFmpeg.
- **Aceleración por hardware**. Usa VideoToolbox de macOS para incrustar subtítulos y generar clips MP4 compatibles.
- **Cookies del navegador**. Usa las cookies de Chrome, Firefox, Brave o Safari para descargar vídeos con restricciones de edad o reservados para miembros.
- **Proxies HTTP y SOCKS5**. Envía las descargas y consultas a través de un proxy local o remoto. Activa **Proxy**, elige el tipo e introduce el servidor y el puerto.
- **Cancelación**. Detén una descarga o codificación en curso. Las descargas interrumpidas pueden dejar archivos parciales en la carpeta de descargas.

## Instalación

Las versiones empaquetadas incluyen yt-dlp, FFmpeg y Deno. Elige `arm64` para Apple Silicon, Windows en Arm o Linux ARM64. Elige `x64` para los Mac con Intel y la mayoría de los PC Windows y Linux con Intel o AMD.

### Método 1. Homebrew (macOS)

Instala y actualiza con Homebrew:

```bash
brew install --cask Shawshank01/tap/vidbutler
```

### Método 2. Descarga directa

1. Descarga la última versión desde la página de [versiones](https://github.com/Shawshank01/Vidbutler/releases).
2. Ejecuta el instalador de tu sistema operativo:
   - **macOS:** `.dmg`
   - **Windows:** instalador `.exe`
   - **Linux:** `.AppImage`

> [!IMPORTANT]
> La aplicación para macOS tiene una firma ad hoc y carece de certificación notarial de Apple. macOS puede bloquear la instalación directa desde un DMG. Se recomienda usar Homebrew. Si descargas la aplicación directamente, quizá debas elegir **Abrir igualmente** en **Ajustes del Sistema > Privacidad y seguridad** o, como alternativa, ejecutar `xattr -cr /Applications/VidButler.app`.

### Método 3. Desde el código fuente

Los flujos de integración continua usan Node.js 26 y pnpm 12. Para ejecutar `pnpm start`, instala yt-dlp y FFmpeg en tu sistema. En macOS, ejecuta `brew install yt-dlp ffmpeg`. En Ubuntu o Debian, ejecuta `sudo apt install yt-dlp ffmpeg`. En Windows, añade las herramientas a `PATH`. Para incrustar subtítulos se necesita una compilación de FFmpeg con el filtro `subtitles`, como `ffmpeg-full` de Homebrew. Instala Deno para disponer de [compatibilidad completa con YouTube](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

1. Clona el repositorio:

   ```bash
   git clone https://github.com/Shawshank01/Vidbutler.git
   cd Vidbutler
   ```

2. Instala las dependencias:

   ```bash
   pnpm install
   ```

3. Inicia la aplicación:

   ```bash
   pnpm start
   ```

   *(En macOS también puedes hacer doble clic en `start.command`, en la raíz del proyecto, para instalar las dependencias e iniciar la aplicación.)*

#### Generar paquetes de distribución

Para generar un instalador para tu plataforma:

```bash
pnpm run build
```

Los instaladores y ejecutables se guardan en el directorio `dist/`.

Las versiones de macOS usan una firma ad hoc y no requieren credenciales del Apple Developer Program. Tras una actualización, macOS puede volver a pedir permiso para acceder al navegador. Los ejecutables de Windows se firman si están configurados los secretos opcionales `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD`.

## Desinstalación

Para borrar la versión instalada con Homebrew y sus datos locales, cierra VidButler y ejecuta `brew uninstall --cask --zap Shawshank01/tap/vidbutler`. Si instalaste la aplicación manualmente, usa **Acerca de VidButler → Eliminar datos locales** antes de quitarla. Se borran los ajustes, las claves de API guardadas y las cachés gestionadas por la aplicación. Se conservan tus descargas. En macOS, la versión de desarrollo y la de distribución comparten estos datos. La limpieza no abarca las entradas del llavero de macOS ni las cachés de herramientas independientes o de versiones anteriores de VidButler.

## Uso del modo IA

Haz clic en **IA** en la esquina superior derecha para abrir el chat. Puedes pedir en lenguaje natural que descargue, convierta o inspeccione contenido multimedia, o que gestione archivos.

### Ejemplos de peticiones

- *«Descarga este vídeo: https://…»*
- *«Descarga este vídeo en 720p: https://…»*
- *«Descarga el fragmento de 0:45 a 2:10: https://…»*
- *«Descarga el audio de 1:15 a 2:30: https://…»*
- *«Extrae el audio de este vídeo en M4A»*
- *«Resume este vídeo: https://…»*
- *«¿En qué idiomas hay subtítulos para este vídeo?»*, seguido de *«Incrusta los subtítulos en inglés en la parte superior»*
- *«Descárgalo y luego recodifícalo a un MP4 compatible»*
- *«Enséñame qué hay en mi carpeta de descargas»* / *«Elimina los archivos de subtítulos que quedaron»*

Puedes descargar clips de fuentes en línea. Esta función requiere FFmpeg. Para usar un proxy, selecciona **HTTP** e introduce la dirección de un proxy HTTP compatible con CONNECT. Si tu proxy solo ofrece SOCKS5, usa un puente local de HTTP a SOCKS5. Los resúmenes de vídeo se basan en los subtítulos disponibles y pueden citar marcas de tiempo. Las transcripciones largas pueden requerir varias peticiones al proveedor de IA.

### Configurar un proveedor

1. Haz clic en **IA** en la esquina superior derecha y abre **Ajustes de IA**.
2. Selecciona un proveedor y comprueba el modelo. Si el proveedor usa una clave de API, pégala y pulsa **Guardar clave**. Para Ollama o un servidor compatible con OpenAI, comprueba la dirección del servidor.
3. Pulsa **Probar conexión** y después **Guardar**.
4. Elige la carpeta de descargas y empieza a conversar.

| Proveedor | Requisitos | Notas |
| --- | --- | --- |
| **Google Gemini** (predeterminado, modelo `gemini-3.5-flash-lite`) | Clave de API de [Google AI Studio](https://aistudio.google.com/apikey) | El modelo predeterminado tiene un [nivel gratuito](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). Tus mensajes se envían a Google. |
| **xAI Grok** (modelo `grok-4.3`) | Clave de API de la [consola de xAI](https://console.x.ai) | Usa la API Responses de xAI en `https://api.x.ai/v1/responses`. Tus mensajes se envían a xAI. |
| **Cohere** (modelo `command-a-plus-05-2026`) | Clave de API del [panel de Cohere](https://dashboard.cohere.com/api-keys) | Transmite las respuestas mediante la [API Chat de Cohere](https://docs.cohere.com/docs/streaming). Tus mensajes se envían a Cohere. |
| **Ollama (local)** | [Ollama](https://ollama.com) en ejecución con un modelo que admita llamadas a herramientas, como `lfm3:1.7b`. | Si el modelo y el servidor son locales, la aplicación envía los datos del chat a Ollama en tu equipo. |
| **Compatible con OpenAI** | URL del servidor, nombre del modelo y, normalmente, una clave de API | Funciona con llama.cpp, OpenAI, OpenRouter, Groq, LM Studio y servicios similares. |

Para descargar y procesar contenido multimedia, elige un modelo que admita llamadas a herramientas.

Ajustes adicionales:

- **Esfuerzo de razonamiento**. Gemini y xAI ofrecen sus propios ajustes. **Ninguno** desactiva el razonamiento en Grok 4.3 y usa el esfuerzo predeterminado del modelo en otros modelos de xAI.
- **Nivel de confirmación**. Elige cuándo pedir aprobación: *Solo acciones de riesgo* (predeterminado), *Cada acción* o *Nunca*.

Cuando una petición al modelo falla con HTTP 503, la aplicación suele reintentarla una vez. Para HTTP 429, reintenta si el proveedor indica un tiempo de espera `Retry-After` válido de hasta 60 segundos. Si hay un error de autenticación, comprueba la clave en **Ajustes de IA** y pulsa **Probar conexión**.

### Privacidad y seguridad

- **Datos enviados al proveedor**. La aplicación envía el contenido del chat y las definiciones y resultados de las herramientas al proveedor seleccionado. Los resultados pueden incluir títulos de vídeos, subtítulos, nombres de archivo y la ruta de la carpeta de descargas.
- **Almacenamiento de claves de API**. El formulario de ajustes envía la clave al proceso principal. Las claves guardadas se cifran localmente con `safeStorage` de Electron. Si no hay almacenamiento seguro, las claves se conservan en memoria durante la sesión actual.
- **Historial del chat**. VidButler conserva el historial en memoria hasta que inicias un nuevo chat o cierras la aplicación. Los proveedores en la nube aplican sus propias políticas de conservación a los datos recibidos.
- **Operaciones con archivos**. El asistente trabaja con los archivos multimedia de la carpeta de descargas elegida. Los ajustes predeterminados exigen confirmación para eliminar archivos.

## Uso del modo clásico

El modo clásico funciona sin clave de API de IA.

1. Pega la URL del vídeo y selecciona la carpeta de destino.
2. Elige una acción:
   - **Descargar vídeo (máxima calidad)**. Descarga el flujo de mayor calidad disponible.
   - **Listar formatos**. Muestra todos los flujos disponibles y el código de formato de cada uno.
   - **Descargar (formato personalizado)**. Introduce un código de formato. Usa **Listar formatos** para consultar las opciones. Elige un código de solo audio para descargar únicamente el audio.
   - **Descargar miniatura**. Guarda solo la imagen de la miniatura.
   - **Descargar subtítulos**. Muestra las pistas de subtítulos disponibles y permite elegir cuáles guardar.
   - **Descargar y recodificar en MP4 de alta calidad (H.264/AAC)**. Recodifica con H.264/AAC para maximizar la compatibilidad de reproducción.
   - **Descargar e incrustar subtítulos**. Incrusta los subtítulos en la parte superior o inferior de la imagen.
3. Si lo necesitas, elige un **Navegador para las cookies**, útil para enlaces privados o con restricciones de edad, o configura **Proxy**.
4. Pulsa **Ejecutar**.

Para detener una tarea en curso, pulsa **Cancelar acción**. Si cancelas una recodificación o incrustación de subtítulos, VidButler elimina los archivos incompletos de FFmpeg. Las descargas interrumpidas pueden dejar archivos parciales.

## Actualizaciones

Las versiones empaquetadas para macOS y Windows, y las AppImage para Linux, consultan las versiones de GitHub al iniciarse.

1. En **Windows y Linux AppImage**, selecciona **Descargar y reiniciar**. Se comprueba la suma de verificación, se instala la actualización y la nueva versión se inicia automáticamente.
2. En **macOS**, selecciona **Copiar comando de Homebrew**. Pégalo en Terminal para actualizar el tap e instalar la nueva versión.

   ```bash
   brew update --force && brew upgrade --cask Shawshank01/tap/vidbutler
   ```

   Si instalaste VidButler directamente desde un DMG, elige **Abrir versión en GitHub**.
3. Para buscar actualizaciones manualmente, haz clic en el icono de VidButler y elige **Buscar actualizaciones**.

> [!NOTE]
> Al ejecutar desde el código fuente o desde una compilación de Linux extraída, **Buscar actualizaciones** ofrece abrir la [última versión](https://github.com/Shawshank01/Vidbutler/releases/latest).

## Créditos

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Motor principal de descarga multimedia
- [FFmpeg](https://ffmpeg.org/) — Procesamiento y transcodificación de audio y vídeo, e incrustación de subtítulos
- [Deno](https://deno.com/) — Entorno ligero de JavaScript para resolver los desafíos de yt-dlp
- [Electron](https://www.electronjs.org/) — Framework para aplicaciones de escritorio

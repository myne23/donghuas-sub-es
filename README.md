# Donghuas Sub ES

Plugin de [Kino](https://kinotvapp.github.io/kino-plugins/) con donghuas (animación china) subtitulados al español, de dos páginas:

- **SeriesDonghua** (seriesdonghua.com)
- **MundoDonghua** (mundodonghua.com)

En el Inicio aparecen cuatro filas: últimos episodios y catálogo completo de cada página. En los últimos episodios de MundoDonghua, los "Episodios Limitados" salen primero (se pueden ver igual). También hay búsqueda en ambas páginas.

No pide cuenta ni ajustes. El plugin intenta resolver directamente Dailymotion, OK.ru, VOE y Odysee; si no consigue extraer la fuente, usa el navegador oculto de Kino como respaldo (necesita Kino 0.9.50 o más nuevo). Los demás servidores de cada episodio quedan en el menú "Servidor".

Pruebas sin conexión: `node --test test/plugin.test.mjs`. Validar: `node sdk/validate.mjs .`.

El código de `sdk/`, `contract.json` y `kino.d.ts` viene de las plantillas de Kino (Apache 2.0, ver LICENSE y NOTICE).


### Resolución directa y HTTP-first (0.1.13)

- **OK.ru:** lee las opciones y metadatos del reproductor, prioriza manifiestos con extensión real `.mpd`/`.m3u8`, y registra host, extensión y nombres de parámetros sin imprimir firmas ni tokens. La versión 0.1.9 priorizaba HLS cuando OK.ru ofrece HLS y DASH a la vez, y exponía el otro manifiesto como alternativa. La 0.1.10 añade un User-Agent de navegador junto con Referer y Origin a la fuente OK.ru, porque el reproductor recibía HTTP 400 con los encabezados anteriores; todavía requiere una prueba en Kino para confirmar la reproducción.
- **Rumble:** consulta `embedJS` con `ver=2` y busca las fuentes HLS/MP4/WebM en la estructura de respuesta; si no aparecen, conserva la captura del navegador como respaldo.
- Si el resolver directo no obtiene una fuente compatible, se conserva el mecanismo de captura de Kino como respaldo.


La versión 0.1.11 acorta a 8 segundos la captura de los reproductores `bysekoze.com` que envuelven Filemoon, para no bloquear tanto el inicio cuando no exponen video. Si un servidor no está admitido, ahora el log muestra también su host y ruta para poder incorporar el reproductor correcto sin adivinar el dominio. Los demás servidores conservan el límite de captura de 20 segundos.


La versión 0.1.12 intenta resolver Filemoon/Byse (`bysekoze.com`) y `strp2p.com` mediante HTTP directo: analiza HTML y scripts empaquetados buscando manifiestos HLS o archivos MP4, sin iniciar la captura oculta del navegador para esos dos hosts. Si la página no expone una URL directa, se omite esa fuente y se continúa con las demás. VidHidePro y Embedwish todavía conservan la captura del navegador como respaldo; sus URLs se extraerán directamente en una etapa posterior.


La versión 0.1.13 también intenta extraer URLs de medios por HTTP directo en VidHidePro y Embedwish antes de recurrir a la captura del navegador. Si el HTML no contiene una URL reconocible, esos dos servidores conservan la captura como respaldo. Byse/Filemoon y sp2p siguen siendo HTTP-only y no abren captura si falla la extracción directa. `strp2p.com` también está declarado entre los hosts permitidos del plugin.

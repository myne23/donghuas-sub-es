# Donghuas Sub ES

Plugin de [Kino](https://kinotvapp.github.io/kino-plugins/) con donghuas (animación china) subtitulados al español, de dos páginas:

- **SeriesDonghua** (seriesdonghua.com)
- **MundoDonghua** (mundodonghua.com)

En el Inicio aparecen cuatro filas: últimos episodios y catálogo completo de cada página. En los últimos episodios de MundoDonghua, los "Episodios Limitados" salen primero (se pueden ver igual). También hay búsqueda en ambas páginas.

No pide cuenta ni ajustes. El plugin intenta resolver directamente Dailymotion, OK.ru, VOE y Odysee; si no consigue extraer la fuente, usa el navegador oculto de Kino como respaldo (necesita Kino 0.9.50 o más nuevo). Los demás servidores de cada episodio quedan en el menú "Servidor".

Pruebas sin conexión: `node --test test/plugin.test.mjs`. Validar: `node sdk/validate.mjs .`.

El código de `sdk/`, `contract.json` y `kino.d.ts` viene de las plantillas de Kino (Apache 2.0, ver LICENSE y NOTICE).


### Resolución directa de servidores (0.1.6)

- **OK.ru:** lee las opciones y metadatos del reproductor, detecta si el manifiesto es DASH (`.mpd`) o HLS (`.m3u8`) y lo entrega a Kino con el tipo MIME correspondiente; solo usa MP4/WebM cuando la URL de video es reconocible y envía el `Referer` del embed y conserva `Origin`.
- **Rumble:** consulta `embedJS` con `ver=2` y busca las fuentes HLS/MP4/WebM en la estructura de respuesta; si no aparecen, conserva la captura del navegador como respaldo.
- Si el resolver directo no obtiene una fuente compatible, se conserva el mecanismo de captura de Kino como respaldo.

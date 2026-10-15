# Donghuas Sub ES

Plugin de [Kino](https://kinotvapp.github.io/kino-plugins/) con donghuas (animación china) subtitulados al español, de dos páginas:

- **SeriesDonghua** (seriesdonghua.com)
- **MundoDonghua** (mundodonghua.com)

En el Inicio aparecen cuatro filas: últimos episodios y catálogo completo de cada página. En los últimos episodios de MundoDonghua, los "Episodios Limitados" salen primero (se pueden ver igual). También hay búsqueda en ambas páginas.

No pide cuenta ni ajustes. El video se abre con el navegador oculto de Kino (necesita Kino 0.9.50 o más nuevo) y los demás servidores de cada episodio quedan en el menú "Servidor".

Pruebas sin conexión: `node --test test/plugin.test.mjs`. Validar: `node sdk/validate.mjs .`.

El código de `sdk/`, `contract.json` y `kino.d.ts` viene de las plantillas de Kino (Apache 2.0, ver LICENSE y NOTICE).

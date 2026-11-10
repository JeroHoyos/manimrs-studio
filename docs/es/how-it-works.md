# Cómo funciona

[English](../how-it-works.md) | **Español**

## Las partes de la app

| Parte | Archivo | Qué hace |
| --- | --- | --- |
| Ventana | `frontend/apps/studio/` | TypeScript. `npm run build` en `frontend/` la deja en `dist/`. La app muestra Markdown con `marked` y lo limpia con `DOMPurify`. El reproductor tiene un video por pausa en una sola línea de tiempo. |
| Claude | `crates/lib/studio_agent/` | Corre `claude -p` con stream-json de entrada y de salida. Es la interfaz del Agent SDK y de las extensiones de los editores. La ventana recibe cada evento y responde las peticiones de permiso, las preguntas y los planes. |
| MCP | `crates/desktop/manimrs_studio/src/mcp.rs` | Un servidor MCP por HTTP en `127.0.0.1:8766/mcp`. Si ese puerto está ocupado, la app usa otro. |
| Servidor | `crates/desktop/manimrs_studio/src/server.rs` | También le manda a la ventana los videos y las miniaturas. |
| Trabajos | `crates/lib/studio_engine/src/jobs.rs` | Una cola de renders y exportaciones. Corre un trabajo a la vez, y se puede cancelar. |
| Puente al motor | `crates/lib/studio_engine/` | Llama a `engine/studio.py`. Busca la carpeta de cada charla en `talks.json`. Guarda el estado de una charla hasta que cambia un archivo suyo. |
| Sistema | `crates/lib/studio_shell/` | Abre enlaces, carpetas y archivos de ajustes con el sistema. El selector de carpetas es el de Windows, a través de `rfd`. |

La app llama al motor como un comando. Los comandos que usa la app, y su salida JSON, son un
contrato. No los cambies sin cambiar también `crates/`.

## El render de una diapositiva

Manim Slides renderiza una charla como una sola escena. `engine/scene.py` hace una subclase de la
escena de `main.py` y corre todo `construct()`. Cada diapositiva recibe uno de tres tratamientos:

| Diapositiva | Tratamiento |
| --- | --- |
| Una que pediste | Manim la construye y la dibuja. |
| La anterior a una que pediste | Manim la construye pero no la dibuja. Su último estado es el inicio de la transición. |
| Todas las demás | Solo corre el paso de inicio, que mantiene bien los contadores y el fotograma. |

El motor le pasa a `scene.py` las diapositivas pedidas en la variable de entorno `STUDIO_TARGETS`.
Cuando una diapositiva pedida termina, `scene.py` guarda sus pausas en `diapos/<nombre>.json` e
imprime `STUDIO: saved <nombre>`. Entonces el motor la anota en `_renders.json` y hace su
miniatura. La app muestra cada diapositiva mientras se renderizan las demás.

Si `main.py` cambia durante un render, `scene.py` se detiene con un error. Renderiza otra vez
después del cambio.

## Cuándo hay que renderizar de nuevo una diapositiva

El motor guarda tres huellas por render en `_renders.json`:

| Huella | De dónde sale | Estado cuando cambia |
| --- | --- | --- |
| `hash` | El archivo `.py` de la diapositiva. | changed |
| `previous_hash` | El archivo `.py` de la diapositiva anterior. | previous slide changed |
| `shared_hash` | Todos los demás archivos `.py` de la charla, sin `main.py` ni el registro. | shared code changed |

El motor también compara la resolución del render con la de la diapositiva. Una diapositiva sin
resolución propia usa la de la charla.

## Varios procesos a la vez

La app, el panel web, los comandos y Claude pueden trabajar en la misma charla al mismo tiempo.

- Solo un proceso a la vez cambia `_renders.json`, `_reviews.json` y `_resolutions.json`. El
  candado es `diapos/_data.lock`. El sistema lo suelta si el proceso se detiene.
- Solo corre un render a la vez por charla. Un segundo render espera al primero. El candado es
  `diapos/_render.lock`. El sistema lo suelta cuando el render se detiene, también si otro proceso
  lo mata.
- El motor escribe cada archivo JSON primero en un archivo temporal y después reemplaza el viejo.
- Si el motor no puede leer un archivo JSON, se detiene y no cambia nada. No arranca desde un
  archivo vacío.

## El presentador

`engine/present.py` es el presentador de Manim Slides con estos cambios:

- F cambia entre pantalla completa y ventana. Esc también sale de la pantalla completa.
- La ventana abre en el centro, al 80 % de la pantalla o menos. El presentador de Manim Slides
  hace la ventana del tamaño del render, y una ventana de 1080p no cabe en una pantalla de 1080p.
- Cuando sales de la pantalla completa, la ventana vuelve a su último estado.
- En Windows 11, el presentador quita el borde de 1 píxel alrededor de la ventana.

## Pruebas y complejidad

Las pruebas de `tests/` crean una charla en una carpeta temporal. No necesitan Manim: hacen los
archivos de un render sin él. La herramienta complexipy mantiene la complejidad cognitiva de cada
función de Python en 10 o menos. Para los comandos, mira el
[README](../../README.es.md#contribuir).

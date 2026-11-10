# ManimRS Studio

[English](../index.md) | **Español**

ManimRS Studio hace las diapositivas de una charla de
[Manim Slides](https://github.com/jeertmans/manim-slides) una por una, con Claude. Es una app de
escritorio para Windows y Linux, un panel web y un conjunto de comandos. Los tres usan el mismo
motor y los mismos archivos.

![La app: las diapositivas a la izquierda, el video y la revisión en el centro, el chat de Claude a la derecha](../images/window.png)

Si es tu primera vez, haz el [tutorial](tutorial.md).

La interfaz de la app está en inglés, así que los botones aparecen aquí con su nombre en inglés.

## Contenido

| Página | Qué trae |
| --- | --- |
| [Instalación](installation.md) | Requisitos, carpetas, compilar y actualizar. |
| [Tutorial](tutorial.md) | Tu primera charla, paso a paso, con imágenes. |
| [Guía de uso](usage-guide.md) | La app: revisar, cambiar diapositivas, resolución, presentar y exportar. |
| [Charlas](talks.md) | Charlas en cualquier carpeta, el archivo `talk.manimrs` y el formato de una charla. |
| [Chat de Claude](claude-chat.md) | El chat, sus opciones y las herramientas MCP de la app. |
| [Otros agentes](other-agents.md) | OpenCode, Codex (ChatGPT), Gemini CLI, Cursor y VS Code. |
| [Panel web](web-panel.md) | El panel del navegador. |
| [Referencia de comandos](cli-reference.md) | Todos los comandos del motor. |
| [Cómo funciona](how-it-works.md) | Las partes de la app y el render de una diapositiva. |
| [Problemas y soluciones](problems.md) | Los mensajes de la app, sus causas y sus soluciones. |
| [Documentation style](../writing-style.md) | Las reglas ASD-STE100 de la documentación en inglés. |

## Términos

Cada término de esta documentación tiene una sola definición.

| Término | Definición |
| --- | --- |
| Charla | Una presentación de Manim Slides: una carpeta con un `main.py` que tiene un método `construct()`. |
| Diapositiva | Una llamada `self.slide_<nombre>()` en `construct()`. Una diapositiva puede tener una o más pausas. |
| Pausa | Una parada dentro de una diapositiva, hecha con `next_slide()`. El presentador espera en cada pausa. |
| Render | Hacer los videos de una diapositiva con Manim. Como sustantivo, los videos que deja un render. |
| Carpeta de charlas | La carpeta que contiene la carpeta `manimrs-studio`. |
| Motor | El programa de Python `engine/studio.py`. |
| App | La app de escritorio de `crates/` (Rust) y `frontend/` (TypeScript). |

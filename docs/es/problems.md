# Problemas y soluciones

[English](../problems.md) | **Español**

Cada sección trae un mensaje o un síntoma, su causa y la solución. Los mensajes de la app están en
inglés y aparecen aquí tal como los muestra.

## La app no abre

| Mensaje | Causa | Solución |
| --- | --- | --- |
| *The app needs the Microsoft Edge WebView2 Runtime* | La ventana de la app es un WebView2. Windows 11 lo trae. Algunos equipos con Windows 10 no. | Instala el [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) y abre la app otra vez. |
| *Can't find the talks folder* | La app no encontró `manimrs-studio\engine\studio.py`. El `.exe` no está dentro del repositorio, o el repositorio se movió. | Abre la app desde `manimrs-studio\target\release`. Si el `.exe` está en otro lugar, pon en la variable `STUDIO_ROOT` la carpeta de charlas. |

## La ventana dice «uv is not installed»

La app lee y renderiza las charlas con uv.

1. Haz clic en *Get uv* e instala uv.
2. Cierra la app.
3. Abre la app otra vez.

La app busca uv en el `PATH` y en `.local\bin` de tu carpeta de usuario.

## El chat dice «Claude Code is not installed»

1. Instala [Claude Code](https://claude.com/claude-code).
2. Corre `claude` en una terminal e inicia sesión.
3. Cierra la app y ábrela otra vez.

La lista de diapositivas, el render y la revisión funcionan sin Claude Code.

## Un mensaje dice «FFmpeg is not installed»

Sin FFmpeg, la app renderiza y presenta las charlas. Pero las diapositivas no tienen miniatura,
Claude no puede mirar las imágenes de una diapositiva y la exportación a PDF no funciona.

1. Instala [FFmpeg](https://ffmpeg.org/download.html).
2. Comprueba que el comando `ffmpeg` funciona en una terminal nueva.
3. Cierra la app y ábrela otra vez.

## Un render va lento o se detiene

| Síntoma | Causa | Solución |
| --- | --- | --- |
| El primer render de una charla toma unos minutos. | La charla instala Manim y Manim Slides en su propio entorno de Python. | Espera. Los renders siguientes son rápidos. |
| *Another render of this talk is running* | El panel web, un comando o Claude está renderizando la misma charla. | Espera ese render, o haz clic en *Cancel*. |
| *The render failed* | Un error en el código de una diapositiva, o un programa que Manim no encuentra, por ejemplo LaTeX. | Haz clic en *Log*, abajo. Las últimas líneas muestran el error de Manim. |
| *main.py changed during the render* | `main.py` cambió mientras corría el render. | Renderiza otra vez. |
| *Could not find uv* | El motor no puede correr uv. | Instala uv. Después cierra la app y ábrela otra vez. |

Para mandarle el error a Claude, copia las últimas líneas del registro en el chat.

## Una charla no está en la lista

La lista muestra solo las charlas cuya carpeta encuentra el motor. Si moviste la carpeta de una
charla, o si su disco no está conectado, la charla no aparece.

- Si el disco no está conectado, conéctalo. La charla vuelve.
- Si moviste la carpeta, elige *Open a talk…* y selecciona la carpeta nueva.

## La compilación no puede reemplazar el archivo .exe

La app está abierta. Ciérrala y compila otra vez.

## El panel web no abre

| Mensaje | Causa | Solución |
| --- | --- | --- |
| *The panel is already open* | Otra terminal tiene el panel web en el puerto 8765. | Usa la página del navegador que ya está abierta, o detén la otra terminal con Ctrl+C. |
| El navegador muestra el error 403. | La dirección no es `127.0.0.1:8765` ni `localhost:8765`. | Abre http://127.0.0.1:8765. El panel no responde a otras direcciones. |

## Linux

| Mensaje o síntoma | Causa | Solución |
| --- | --- | --- |
| *To choose a folder, install zenity or kdialog* | La app no encontró un programa de diálogos. | Instala `zenity` o `kdialog`. |
| *No terminal program was found* | La app no encontró una terminal que conozca. | Instala `xterm`, o corre `claude` en tu terminal. |
| El video de una diapositiva no se reproduce. | No están instalados los códecs de GStreamer. | Instala `gstreamer1.0-libav` y `gstreamer1.0-plugins-good`. |
| *its file could not go to the recycle bin* | No está instalado el programa `gio`. | Borra el archivo de la diapositiva en su carpeta. |

## Reportar un problema

Si el problema sigue, abre un issue. Incluye el mensaje, las últimas líneas del registro y las
versiones de Windows, la app, uv y Claude Code.

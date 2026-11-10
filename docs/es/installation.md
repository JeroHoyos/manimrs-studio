# Instalación

[English](../installation.md) | **Español**

## Requisitos

| Qué | Para qué |
| --- | --- |
| Windows 10 o Windows 11 | La app es sobre todo una app de Windows. Para Linux, mira [Linux](#linux). |
| Microsoft Edge WebView2 | La ventana de la app. Windows 11 lo trae. En Windows 10, instala el [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). |
| [uv](https://docs.astral.sh/uv/) | El motor y las charlas corren Python con uv. uv también instala Python. |
| [Claude Code](https://claude.com/claude-code) | El chat de la app corre Claude Code. Inicia sesión antes de abrir la app. |
| [FFmpeg](https://ffmpeg.org/) en el `PATH` | Las miniaturas de las diapositivas, los fotogramas para Claude y la exportación a PDF. |
| [Rust](https://rustup.rs/) | Solo para compilar la app. |
| Visual Studio Build Tools, carga de trabajo de C++ | Solo para compilar la app. |

Hace falta [Node.js](https://nodejs.org/) 20 o posterior para compilar la ventana de la app.

Cada charla instala Manim y Manim Slides en su propio entorno de Python, con uv. Algunas
diapositivas usan más programas, por ejemplo LaTeX para las fórmulas. Mira la
[guía de instalación de Manim](https://docs.manim.community/en/stable/installation.html).

## Carpetas

El motor encuentra las charlas a partir de su propia carpeta. La carpeta que contiene
`manimrs-studio` es la carpeta de charlas. La primera vez, la app y el motor buscan charlas ahí:

```text
charlas/                    la carpeta de charlas
├── manimrs-studio/         este repositorio
│   ├── crates/             la app (Rust)
│   ├── frontend/           la ventana (TypeScript)
│   ├── engine/             el motor (Python)
│   ├── talks.json          la lista de charlas (la hace el motor)
│   └── studio.cmd
├── charla-git/             una charla
└── charla-claude/          una charla
```

Una charla también puede estar en otra carpeta. Mira [Charlas](talks.md).

## Instalar la app

Abre una terminal en la carpeta de charlas. Si no tienes charlas, usa una carpeta vacía.

```powershell
git clone https://github.com/JeroHoyos/manimrs-studio.git
cd manimrs-studio\frontend
npm ci
npm run build
cd ..
cargo build --release
.\target\release\manimrs-studio.exe
```

La primera compilación toma unos minutos. Si falta un programa, la app te dice cuál. Mira
[Problemas y soluciones](problems.md). Después haz tu primera charla con el
[tutorial](tutorial.md).

## Linux

El soporte de Linux es experimental. El CI compila la app y corre las pruebas del motor en Ubuntu.
Nadie del proyecto ha usado la app en un escritorio Linux. Reporta los problemas que encuentres.

1. Instala los paquetes que usa Tauri. En Ubuntu o Debian:

   ```bash
   sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential
   ```

2. Instala uv, FFmpeg, Rust y Claude Code.
3. Clona el repositorio en la carpeta de charlas y compila la app:

   ```bash
   git clone https://github.com/JeroHoyos/manimrs-studio.git
   cd manimrs-studio/frontend && npm ci && npm run build && cd ..
   cargo build --release
   ./target/release/manimrs-studio
   ```

| Función | En Linux |
| --- | --- |
| Selector de carpetas | La app usa `zenity` o `kdialog`. Instala uno de los dos. |
| Papelera | El motor usa `gio trash`. Sin `gio`, el archivo de una diapositiva borrada se queda en su carpeta. |
| Terminal | La app abre la primera que encuentre: `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` o `xterm`. |
| Panel web y comandos | Corre `sh studio.sh` en la carpeta `manimrs-studio`. |
| Fuentes | Una charla nueva usa la fuente `Segoe UI`. Cambia `FONT` en el `style.py` de la charla por una fuente que tengas. |

## Actualizar la app

Cierra la app, corre `git pull` y repite los comandos de compilación. Si la app está abierta, la
compilación no puede reemplazar el archivo `.exe`.

Para desarrollo, corre `cargo run` en la carpeta del repositorio. Esa compilación es más rápida, y
una ventana de consola muestra los errores.

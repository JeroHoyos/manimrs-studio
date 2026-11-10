# Installation

## Requirements

| Item | Why it is necessary |
| --- | --- |
| Windows 10 or Windows 11 | The app is primarily a Windows app. For Linux, refer to [Linux](#linux). |
| Microsoft Edge WebView2 | The window of the app. Windows 11 has it. For Windows 10, get the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). |
| [uv](https://docs.astral.sh/uv/) | The engine and the talks run Python with uv. uv also installs Python. |
| [Claude Code](https://claude.com/claude-code) | The chat of the app runs Claude Code. Log in before you start the app. |
| [FFmpeg](https://ffmpeg.org/) on the `PATH` | The thumbnails of the slides, the stills for Claude and the PDF export. |
| [Rust](https://rustup.rs/) | Only to build the app. |
| Visual Studio Build Tools, C++ workload | Only to build the app. |

[Node.js](https://nodejs.org/) 20 or later is necessary to build the window of the app.

Each talk installs Manim and Manim Slides in its own Python environment, with uv. Some slides
use more programs, for example LaTeX for math. Refer to the
[Manim installation guide](https://docs.manim.community/en/stable/installation.html).

## Folders

The engine finds the talks from its own folder. The folder that holds `manimrs-studio` is the
talks folder. The app and the engine look for talks there the first time:

```text
talks/                      the talks folder
├── manimrs-studio/         this repository
│   ├── crates/             the app (Rust)
│   ├── frontend/           the window (TypeScript)
│   ├── engine/             the engine (Python)
│   ├── talks.json          the list of talks (the engine makes it)
│   └── studio.cmd
├── charla-git/             a talk
└── charla-claude/          a talk
```

A talk can also be in a different folder. For more information, refer to [Talks](talks.md).

## Install the app

Open a terminal in the talks folder. If you do not have talks, use an empty folder.

```powershell
git clone https://github.com/JeroHoyos/manimrs-studio.git
cd manimrs-studio\frontend
npm ci
npm run build
cd ..
cargo build --release
.\target\release\manimrs-studio.exe
```

The first build takes some minutes. If a program is not installed, the app tells you which one.
Refer to [Problems and solutions](problems.md). Then make your first talk with the
[tutorial](tutorial.md).

## Linux

Linux support is experimental. The CI builds the app and runs the tests of the engine on Ubuntu.
The maintainers did not use the app on a Linux desktop. Report the problems that you find.

1. Install the packages that Tauri uses. On Ubuntu or Debian:

   ```bash
   sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential
   ```

2. Install uv, FFmpeg, Rust and Claude Code.
3. Clone the repository into the talks folder and build the app:

   ```bash
   git clone https://github.com/JeroHoyos/manimrs-studio.git
   cd manimrs-studio/frontend && npm ci && npm run build && cd ..
   cargo build --release
   ./target/release/manimrs-studio
   ```

| Function | On Linux |
| --- | --- |
| Folder dialog | The app uses `zenity` or `kdialog`. Install one of them. |
| Recycle bin | The engine uses `gio trash`. Without `gio`, the file of a deleted slide stays in its folder. |
| Terminal | The app opens the first one that it finds: `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` or `xterm`. |
| Web panel and commands | Run `sh studio.sh` in the `manimrs-studio` folder. |
| Fonts | A new talk uses the font `Segoe UI`. Change `FONT` in the `style.py` file of the talk to a font that you have. |

## Update the app

Close the app, run `git pull`, then do the build commands again. If the app is open, the build
cannot replace the `.exe` file.

For development, run `cargo run` in the folder of the repository. This build is faster to make, and
a console window shows the errors.

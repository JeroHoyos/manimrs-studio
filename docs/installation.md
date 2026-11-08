# Installation

## Requirements

| Item | Why it is necessary |
| --- | --- |
| Windows 10 or Windows 11 | The app is a Windows app. It uses the recycle bin and the folder dialog of Windows. |
| Microsoft Edge WebView2 | The window of the app. Windows 11 has it. |
| [uv](https://docs.astral.sh/uv/) | The engine and the talks run Python with uv. uv also installs Python. |
| [Claude Code](https://claude.com/claude-code) | The chat of the app runs Claude Code. Log in before you start the app. |
| [FFmpeg](https://ffmpeg.org/) on the `PATH` | The thumbnails of the slides, the stills for Claude and the PDF export. |
| [Rust](https://rustup.rs/) | Only to build the app. |
| Visual Studio Build Tools, C++ workload | Only to build the app. |

Node.js is not necessary. The interface of the app has no build step.

Each talk installs Manim and Manim Slides in its own Python environment, with uv. Some slides
use more programs, for example LaTeX for math. Refer to the
[Manim installation guide](https://docs.manim.community/en/stable/installation.html).

## Folders

The engine finds the talks from its own folder. The folder that holds `manimrs-studio` is the
talks folder. The app and the engine look for talks there the first time:

```text
talks/                      the talks folder
├── manimrs-studio/         this repository
│   ├── app/
│   ├── engine/
│   ├── talks.json          the list of talks (the engine makes it)
│   └── studio.cmd
├── charla-git/             a talk
└── charla-claude/          a talk
```

A talk can also be in a different folder. For more information, refer to [Talks](talks.md).

## Install the app

1. Open a terminal in the talks folder. If you do not have talks, use an empty folder.
2. Clone the repository into that folder:

   ```powershell
   git clone https://github.com/JeroHoyos/manimrs-studio.git
   ```

3. Go to the folder of the app:

   ```powershell
   cd manimrs-studio\app
   ```

4. Build the app:

   ```powershell
   cargo build --release
   ```

5. Start `target\release\manimrs-studio.exe`.

The first build takes some minutes. The build puts the interface (`app/ui/`) into the `.exe` file.

To start the app with a double click, make a Windows shortcut to the `.exe` file. You can pin the
shortcut to the taskbar.

## Update the app

1. Close the app.
2. Get the new version of the repository:

   ```powershell
   git pull
   ```

3. Build the app again:

   ```powershell
   cd app
   cargo build --release
   ```

If the app is open, the build cannot replace the `.exe` file. Close the app first, or rename the
`.exe` file that runs.

## Start the app for development

Run `cargo run` in `app/`. This build is faster to make, and a console window shows the errors.

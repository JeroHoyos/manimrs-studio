# ManimRS Studio

Make the slides of a [Manim Slides](https://github.com/jeertmans/manim-slides) talk one slide at a
time, with Claude.

[Installation](#installation) | [Quick start](#quick-start) | [Features](#features) |
[Documentation](docs/index.md) | [Changelog](CHANGELOG.md) | [Contribute](CONTRIBUTING.md)

ManimRS Studio is a desktop app for Windows. It shows the slides of a talk, renders only the slides
that you select and keeps the other slides as they are. A Claude chat in the app can change a slide,
render it and examine the result.

## Why

Manim Slides renders a talk as one scene. When you render only some slides, Manim Slides writes a
presentation file that has only those slides. When you render all the slides, it renders each slide
again, also the slides that did not change.

ManimRS Studio keeps each slide in a file of its own, with its videos. When you render one slide,
the other slides do not change. Each slide still starts with the transition from the slide before
it, as in the full talk.

## Features

- **One slide at a time.** The engine renders only the slides that you select. It does not delete
  the other slides and it does not render them again.
- **A status for each slide.** The app shows the slides that are up to date and the slides that
  changed. It also shows when the slide before changed, when the shared code changed and when the
  resolution is different.
- **Review.** Write a note for a slide and send it to Claude. Approve the slide when it is correct.
- **Claude chat.** The chat has the options of the Claude Code extension for VS Code. Through a
  local MCP server, Claude can render a slide, get the image of each pause and show the slide to you.
- **Changes to the talk.** Add, move, rename and delete slides. The app changes `main.py` and the
  registry of the slides. When you rename a slide, the app also renames its videos.
- **Talks in any folder.** Make a new talk, or open a talk from any folder.
- **Present and export.** Present in full screen. Export an HTML package for another device, or a
  PDF with the last frame of each pause.
- **A web panel and commands.** The same engine works from a browser panel and from a terminal.

## Requirements

- Windows 10 or Windows 11, with Microsoft Edge WebView2. Windows 11 has WebView2.
- [uv](https://docs.astral.sh/uv/). The engine and each talk use uv to run Python.
- [Claude Code](https://claude.com/claude-code), for the chat. Log in to Claude Code before you
  start the app.
- [FFmpeg](https://ffmpeg.org/) on the `PATH`, for the thumbnails, the stills and the PDF.
- To build the app: [Rust](https://rustup.rs/) and the Visual Studio Build Tools with the C++
  workload. Node.js is not necessary.

## Installation

The engine finds the talks from its own folder. Put this repository in the folder that holds
your talks.

1. Open a terminal in the folder that holds your talks. If you do not have talks, use an empty
   folder.
2. Clone the repository into that folder:

   ```powershell
   git clone https://github.com/JeroHoyos/manimrs-studio.git
   ```

3. Build the app:

   ```powershell
   cd manimrs-studio\app
   cargo build --release
   ```

4. Start `manimrs-studio\app\target\release\manimrs-studio.exe`.

The first build takes some minutes. To start the app with a double click, make a shortcut to the
`.exe` file. For more information, refer to [Installation](docs/installation.md).

## Quick start

1. Start the app.
2. Select a talk in the list at the top. To make a new talk, select *+ New talk* at the end of the
   list.
3. Click *Render pending*. The first time, the talk installs its Python packages. This takes some
   minutes.
4. Select a slide in the list on the left. The center shows the video of the slide.
5. Type a request in the chat on the right. For example:
   `/slides git: a new slide after git_diff that explains git stash`.
6. Write what to change in *Review*, then click *Send to Claude*.
7. When the slide is correct, click *Approve*.

## The parts

| Part | Path | What it does |
| --- | --- | --- |
| The app | `app/` | The desktop app, in Rust and Tauri: the list of slides, the video player, the review and the Claude chat. |
| The engine | `engine/studio.py` | Reads, changes, renders, presents and exports the talks. The app, the web panel and the commands use it. |
| The render scene | `engine/scene.py` | Renders only the slides that the engine asks for. |
| The presenter | `engine/present.py` | The presenter of Manim Slides, with a full screen mode that fits the screen. |
| The web panel | `engine/panel.html` | The list of slides and the review in a browser. |
| The commands | `studio.cmd` | The engine from a terminal. A double click opens the web panel. |

## Documentation

| Page | Contents |
| --- | --- |
| [Installation](docs/installation.md) | Requirements, folders, build and update. |
| [Usage guide](docs/usage-guide.md) | The app: review, slide changes, resolution, present and export. |
| [Talks](docs/talks.md) | Talks in any folder, the `talk.manimrs` file and the format of a talk. |
| [Claude chat](docs/claude-chat.md) | The chat, its options and the MCP tools of the app. |
| [Web panel](docs/web-panel.md) | The browser panel. |
| [Command reference](docs/cli-reference.md) | All the commands of the engine. |
| [How it works](docs/how-it-works.md) | The parts of the app and the render of one slide. |
| [Documentation style](docs/writing-style.md) | The ASD-STE100 rules of this documentation. |

## Contribute

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you start. All
participants must obey the [code of conduct](CODE_OF_CONDUCT.md).

## Security

The app runs Claude and Python on your computer. [SECURITY.md](SECURITY.md) gives the security
model and tells you how to report a vulnerability.

## License

ManimRS Studio is free software under the [MIT License](LICENSE). The app includes code and fonts
from other projects, each with its own license:

| Component | Path | License |
| --- | --- | --- |
| marked | `app/ui/vendor/marked.min.js` | MIT |
| DOMPurify | `app/ui/vendor/purify.min.js` | Apache-2.0 or MPL-2.0 |
| Space Grotesk | `app/ui/fonts/space-grotesk.woff2` | SIL Open Font License 1.1 |
| IBM Plex Mono | `app/ui/fonts/ibm-plex-mono-*.woff2` | SIL Open Font License 1.1 |

---

ManimRS Studio is not a part of the Manim Community project, Manim Slides or Anthropic. Claude is a
trademark of Anthropic.

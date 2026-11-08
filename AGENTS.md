# AGENTS.md

ManimRS Studio makes the slides of Manim Slides talks one slide at a time, with Claude. It has a
desktop app for Windows (Rust and Tauri), an engine in Python and a web panel.

## Code standard

- When you write code, obey the `ponytail` skill (`.claude/skills/ponytail/SKILL.md`). Make the
  smallest change that solves all of the problem, without code for the future.
- When you review code, obey the `ponytail-review` skill (`.claude/skills/ponytail-review/SKILL.md`).
- The cognitive complexity of each Python function must be 10 or less. Run `uv run complexipy .`.
  If a function gets more than 10, divide it by task, not by line count.

## Language

- Code, comments, interface text, commands and documentation are in English.
- Write the documentation in ASD-STE100 Simplified Technical English. The rules are in
  `docs/writing-style.md`.
- The content of the talks can be in any language. The folder names of the talk format are in
  Spanish: `presentacion`, `diapositivas`, `diapos`. Do not change them. The renders that are
  there keep these names in their paths.

## Where each part is

| Path | Contents |
| --- | --- |
| `engine/studio.py` | The engine and its commands. Only the Python standard library. |
| `engine/scene.py` | The Manim scene that renders only the selected slides. It runs in the environment of the talk. |
| `engine/present.py` | The presenter of Manim Slides, with a correct full screen mode. |
| `engine/panel.html` | The web panel. |
| `app/src/` | The app in Rust: `claude.rs` (the chat), `mcp.rs` (the MCP tools), `engine.rs` (calls to the engine), `jobs.rs`, `server.rs`, `shell.rs`, `main.rs`. |
| `app/ui/` | The interface: HTML, CSS and JavaScript without a build step. |
| `tests/test_studio.py` | The tests of the engine. |
| `docs/` | The documentation. |

## Run and examine

```powershell
uv sync                            # pytest and complexipy
uv run pytest                      # the tests of the engine, without Manim
uv run complexipy .                # 10 or less for each function
cd app; cargo build --release      # the app, also after a change to app/ui/
```

- `python` is not on the `PATH`. Use `uv run`.
- Test a change to a talk on a copy in a temporary folder, never on a real talk. Copy the
  `manimrs-studio/engine/` folder next to the copy, two levels above the talk folder.
- If the app is open, the build cannot replace the `.exe` file. Close the app first.

## Rules that are easy to break

**The contract between the app and the engine**

- The app calls the engine as a command. Do not change these commands or their JSON output without
  a change to `app/src/`:
  - `talks --json`, `open --json -- <path>`, `new-talk --json … -- <title>`
  - `<talk> info --json`, `<talk> forget`, `<talk> status`, `<talk> list`, `<talk> notes`
  - `<talk> stills --width=1280 -- <slide>`, `<talk> place`, `<talk> render`
  - the commands that change a talk: `new`, `move`, `rename`, `restore`, `delete`, `resolution`
- `test_command_line_contract_of_the_app` in `tests/test_studio.py` keeps part of this contract.

**Tests of the window**

- Never send keys or mouse clicks to the desktop of the user. They can go to a different window.
- Start the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`. Use
  `Runtime.evaluate` to act and `Page.captureScreenshot` to see the window.
- If you start the app from a Claude Code session, remove the `CLAUDE*` environment variables first.

**Interface**

- Use the light mode of the GRADIENT brand, without its logo. Background Hueso `#f6f6f3`. Cards and
  bars white with thin lines. Text and main actions Grafito `#0e1116`. Secondary text Acero
  `#5b616b`. Lines Niebla `#d9dbdf`.
- Use Azul Gradiente `#2b59ff` only as a signal: focus, progress, timeline, links and selection.
  Its tint is Hielo `#dce4ff`.
- Use Space Grotesk for text, titles and numbers. Use IBM Plex Mono only for capital labels and code.
- The design is flat, without shadows.
- Do not use "//" before labels. Do not use the asterisk icon of Claude.
- Do not use "·" as a separator. Use space, small tags or the layout.
- Do not put a period at the end of interface text. Use "…" only for work that continues.
- Give resolutions as 480p, 720p and 1080p, never as low, medium and high.
- Do not show code references in the interface: no paths, no method names, no file names of code.
- Prefer fewer options.

**Libraries in app/ui/vendor**

- Get them only from the official npm package. Make sure that the file agrees with the `integrity`
  hash. Use a version that has been on npm for two weeks or more.

**Parallel sessions**

- Other sessions can change this folder at the same time. Before a large change, look at the files
  that changed recently and tell the other sessions what you will change.

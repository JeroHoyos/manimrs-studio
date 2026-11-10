# How it works

## The parts of the app

| Part | File | What it does |
| --- | --- | --- |
| Window | `frontend/apps/studio/` | TypeScript. `npm run build` in `frontend/` puts it in `dist/`. The app shows Markdown with `marked` and cleans it with `DOMPurify`. The player keeps one video for each pause on one timeline. |
| Claude | `crates/lib/studio_agent/` | Runs `claude -p` with stream-json for input and output. This is the interface of the Agent SDK and of the editor extensions. The window gets each event and answers permission requests, questions and plans. |
| MCP | `crates/desktop/manimrs_studio/src/mcp.rs` | An MCP server over HTTP at `127.0.0.1:8766/mcp`. If that port is not free, the app uses a different port. |
| Server | `crates/desktop/manimrs_studio/src/server.rs` | Also sends the videos and the thumbnails to the window. |
| Jobs | `crates/lib/studio_engine/src/jobs.rs` | A queue of renders and exports. It runs one job at a time, and you can cancel a job. |
| Engine bridge | `crates/lib/studio_engine/` | Calls `engine/studio.py`. It finds the folder of each talk in `talks.json`. It keeps the status of a talk until a file of the talk changes. |
| Shell | `crates/lib/studio_shell/` | Opens links, folders and settings files with the Windows shell. The folder dialog comes from Windows, through `rfd`. |

The app calls the engine as a command. The commands that the app uses, and their JSON output, are a
contract. Do not change them without a change to `crates/`.

## The render of one slide

Manim Slides renders a talk as one scene. `engine/scene.py` makes a subclass of the scene in
`main.py` and runs all of `construct()`. Each slide gets one of three treatments:

| Slide | Treatment |
| --- | --- |
| A slide that you selected | Manim builds it and draws it. |
| The slide before a selected slide | Manim builds it but does not draw it. Its last state is the start of the transition. |
| All other slides | Only the start hook runs. The hook keeps the counters and the frame correct. |

The engine sends the selected slides to `scene.py` in the `STUDIO_TARGETS` environment variable.
When a selected slide ends, `scene.py` saves its pauses in `diapos/<name>.json` and prints
`STUDIO: saved <name>`. The engine then records the slide in `_renders.json` and makes its thumbnail.
The app shows each slide while the other slides render.

If `main.py` changes during a render, `scene.py` stops with an error. Render again after the change.

## When a slide must be rendered again

The engine keeps three hashes for each render in `_renders.json`:

| Hash | Source | Status when it changes |
| --- | --- | --- |
| `hash` | The `.py` file of the slide. | changed |
| `previous_hash` | The `.py` file of the slide before it. | previous slide changed |
| `shared_hash` | All other `.py` files of the talk, without `main.py` and the registry. | shared code changed |

The engine also compares the resolution of the render with the resolution of the slide. A slide
without its own resolution uses the resolution of the talk.

## Many processes at the same time

The app, the web panel, the commands and Claude can work on the same talk at the same time.

- Only one process at a time changes `_renders.json`, `_reviews.json` and `_resolutions.json`. The
  lock is `diapos/_data.lock`. Windows releases the lock if the process stops.
- Only one render at a time runs for each talk. A second render waits for the first. The lock is
  `diapos/_render.lock`. The system releases it when the render stops, also when a process kills
  the render.
- The engine writes each JSON file to a temporary file first, then replaces the old file.
- If the engine cannot read a JSON file, it stops and changes nothing. It does not start from an
  empty file.

## The presenter

`engine/present.py` is the presenter of Manim Slides with these changes:

- F changes between full screen and a window. Esc also leaves full screen.
- The window opens in the center, at 80% of the screen or less. The presenter of Manim Slides makes
  the window as large as the render. A 1080p window is too large for a 1080p screen.
- When you leave full screen, the window goes back to its last state.
- On Windows 11, the presenter removes the 1-pixel border around the window.

## Tests and complexity

The tests in `tests/` make a talk in a temporary folder. Manim is not necessary for the tests. They
make the files of a render without Manim. The complexipy tool keeps the cognitive complexity of each Python
function at 10 or less. For the commands, refer to the [README](../README.md#contribution).

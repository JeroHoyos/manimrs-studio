# Changelog

This file records the changes to ManimRS Studio that are important to users. The format comes from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The files of an open-source project: license, contribution guide, code of conduct, security
  policy, issue templates and a pull request template.
- The documentation in `docs/`, in ASD-STE100 Simplified Technical English.
- Tests of the engine in `tests/`. Manim is not necessary for them.
- A complexity check with complexipy. Each Python function has a cognitive complexity of 10 or less.
- A CI workflow that runs the tests and complexipy, and builds the app.
- The PDF export (`export --pdf`). Each pause of a slide is a page with the last frame of the pause.
  A loop after a pause gets no page, because it ends on the page of that pause.
- Images in the review note. Attach, paste or drop them. They go to Claude with the note.

### Changed

- The functions of the engine are smaller. The commands and their output did not change.
- If `main.py` has no `construct()` method, the engine tells you the cause.
- A slide without its own resolution is up to date only at the resolution of the talk. Before, a
  render at a different resolution was also up to date.
- The app shows each slide as soon as its render ends. Before, all the slides of a render came at
  the end.
- The job bar shows the number of the slide that renders and the progress, for example
  "Slide 41, 3 of 93".
- The empty chat is shorter: one line and three requests to try.
- The chat puts what Claude thinks, its tool calls and the notes between them in one row. The row
  shows a summary and the images that Claude examined. Click it to see each step.
- The chat always works in Auto mode. The app does not show the mode button, and Shift+Tab does
  not change the mode.

### Removed

- The `subtitle` and `event` fields of `talk.manimrs`.
- The PowerPoint export and the `--pptx` option. The PDF export replaces it.

### Fixed

- The app does not become slow while a video plays. Each frame of the player asked for two new
  frames, so the work and the memory increased on each frame.
- A render that stops before its end does not lock the talk. Before, the next render of the talk
  sometimes waited forever, because Windows gave the process id in the lock file to a new process.

## [0.5.0] - 2026-11-08

The first version in this repository.

### Added

- The desktop app: the list of slides, the video player and the review.
- A Claude chat in the app, with the options of the Claude Code extension for VS Code.
- A local MCP server: Claude can render a slide, get its images and show it in the app.
- The engine: render one slide at a time, review, present and export.
- Changes to a talk: add, move, rename, delete and put back slides.
- Talks in any folder, with a `talk.manimrs` file for each talk.
- The web panel and the commands.

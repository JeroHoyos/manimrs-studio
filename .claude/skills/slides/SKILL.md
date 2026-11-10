---
name: slides
description: Creates, changes and reviews the slides of the manim talks (charla-claude, charla-git, charla-redes-neuronales, charla-langchain and any other the Studio lists, in any folder) one at a time with the Studio, without rendering again or deleting the others. Use it when asked to make, edit, render, review, present or export slides, when a request copied from the panel is pasted (“/slides <talk> …”), or when /slides is invoked.
---

# Slides, one at a time

With the Studio (`manimrs-studio/engine/studio.py`, in the talks folder) each slide is rendered into
its own file, `diapos/<name>.json` inside the talk. Rendering one never touches the others. The user
reviews them in the panel (the ManimRS Studio app, or http://127.0.0.1:8765) and leaves notes there
with the changes they want.

## Where each talk is

A talk can live in any folder. `talks` (the MCP tool, or the command) gives the name, title and
folder of each one, and `list` repeats the folder at the top. The folder is the one with the talk's
`main.py`: `presentacion/` in the older talks (`charla-git/presentacion`), the talk's own folder in
the ones made from the app. The slide files `list` gives are relative to it.

Next to `main.py` is `talk.manimrs`, a JSON file with what the talk is: `title`, `about`
(who it is for and what it covers), `author`, `language` of the slides and `resolution`
(the talk's, used when a render doesn't say). Read it before making slides, and write the slides in
its language. Change it with `info --about "…"` (or by editing it) only if the user asks.

## Inside the app

If you have the `mcp__studio__*` tools, you are in the chat of the “ManimRS Studio” app and the user
sees the panel next to you. Use them instead of the commands:

- `slides` and `notes` instead of `list` and `notes`;
- `render`, which also shows the progress and the video in the app;
- `view`, which gives you the images directly (no need to read PNGs);
- `place` to add the call in `main.py`;
- `show` when each slide is done, so the user reviews it.

Outside the app, use the commands below.

## Commands

From the folder that holds the talks and `manimrs-studio`:

```bash
uv run --no-project manimrs-studio/engine/studio.py <talk> list               # order, status and file of each one
uv run --no-project manimrs-studio/engine/studio.py <talk> notes              # changes requested from the panel
uv run --no-project manimrs-studio/engine/studio.py <talk> render <slide>...  # only those (name or number)
uv run --no-project manimrs-studio/engine/studio.py <talk> stills <slide>     # PNG of the end of each pause
uv run --no-project manimrs-studio/engine/studio.py <talk> new "git stash" --after <slide>  # file + registry + place
uv run --no-project manimrs-studio/engine/studio.py <talk> move <slide> --after <slide>     # or --first
uv run --no-project manimrs-studio/engine/studio.py <talk> rename <slide> "new name"        # moves its renders too
uv run --no-project manimrs-studio/engine/studio.py <talk> delete <slide>     # its file goes to the recycle bin
uv run --no-project manimrs-studio/engine/studio.py <talk> resolution <slide> 1080p         # or default
uv run --no-project manimrs-studio/engine/studio.py <talk> note <slide> --clear
uv run --no-project manimrs-studio/engine/studio.py talks                     # name, title and folder of each talk
uv run --no-project manimrs-studio/engine/studio.py <talk> info              # its talk.manimrs
uv run --no-project manimrs-studio/engine/studio.py open "C:/path/to/talk"   # adds a talk from any folder
uv run --no-project manimrs-studio/engine/studio.py new-talk "Title" --about "…" [--in "C:/folder"] [--folder name]
```

`<talk>` goes in full or without “charla-”: `claude`, `git`, `redes-neuronales`, `langchain`, or any
other that `talks` lists. A slide repeated in `main.py` (the practice one) is called `practica`,
`practica-2`, …

A new talk (`studio new-talk "Title"`, or *+ New talk* in the app) keeps everything in its one
folder and has no AGENTS.md: what it is about is in its `talk.manimrs`, its style in `style.py`
(colors, `FONT`, sizes), and each slide is a `build(scene)` that ends with `scene.next_slide()`. If
the request brings a topic, propose the list of slides and wait for the user's approval before
creating them.

## Flow

1. Read the AGENTS.md, CLAUDE.md or README of that talk before touching anything. Its rules are
   there: audience, style, pauses and how to register a slide.
2. Find the slide with `list`, which gives its file. If the request comes from the panel without
   detail (“apply the changes requested in the panel”), run `notes` and handle each one.
3. Make the smallest change that fulfils the request. For a new slide, create it with `new` (it
   leaves the file from the talk's template, registers it and places it) and then write its content
   following the talk's “add a slide” section. If the request says the slide “is already created
   and placed”, don't create it again: only make its content.
4. Render **only** the ones you touched: `render <slide>...`. The default quality is the talk's resolution (its `talk.manimrs`); use
   `--quality 480p` if the user asks for speed. If you changed shared code (style, components), say
   which other slides change instead of rendering all of them without asking.
5. Look at the result with `stills <slide>` and read the PNGs (or `view` in the app). Check that the
   request is met and the talk's rules hold: no text overflowing or overlapping, and the right
   pauses.
6. If the request came from a note, don't clear it: when rendered again, the panel turns it into
   “to review” so the user approves it. Clear it only if asked.
7. Close with one line per slide saying what changed. In the app, call `show`; outside it, leave the
   panel link: `http://127.0.0.1:8765/?talk=<talk>&slide=<name>`.

## Don't

- Don't use `manim_slides render main.py ...` or comment out slides in `main.py` to render a few:
  that redoes the whole talk in `slides/`.
- Don't delete a talk's `diapos/` folder: the user's renders are there.
- Don't run `render --all` or `render --pending` unless asked: they can take a long time.
- If the render says “waiting for it to finish”, it is another render of the same talk (the panel
  or another session). Wait; don't start another one.

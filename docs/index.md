# ManimRS Studio

ManimRS Studio makes the slides of a [Manim Slides](https://github.com/jeertmans/manim-slides) talk
one slide at a time, with Claude. It is a desktop app for Windows, a web panel and a set of
commands. All three use the same engine and the same files.

## Contents

| Page | Contents |
| --- | --- |
| [Installation](installation.md) | Requirements, folders, build and update. |
| [Usage guide](usage-guide.md) | The app: review, slide changes, resolution, present and export. |
| [Talks](talks.md) | Talks in any folder, the `talk.manimrs` file and the format of a talk. |
| [Claude chat](claude-chat.md) | The chat, its options and the MCP tools of the app. |
| [Web panel](web-panel.md) | The browser panel. |
| [Command reference](cli-reference.md) | All the commands of the engine. |
| [How it works](how-it-works.md) | The parts of the app and the render of one slide. |
| [Documentation style](writing-style.md) | The ASD-STE100 rules of this documentation. |

## Terms

Each term in this documentation has only one definition.

| Term | Definition |
| --- | --- |
| Talk | A Manim Slides presentation: one folder with a `main.py` that has a `construct()` method. |
| Slide | One `self.slide_<name>()` call in `construct()`. A slide can have one or more pauses. |
| Pause | A stop in a slide, made by `next_slide()`. The presenter waits at each pause. |
| Render | To make the videos of a slide with Manim. As a noun, the videos that a render makes. |
| Talks folder | The folder that holds the `manimrs-studio` folder. |
| Engine | The Python program `engine/studio.py`. |
| App | The desktop app in `app/`. |

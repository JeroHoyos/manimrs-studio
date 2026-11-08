# Engine

The engine reads, changes, renders, presents and exports the talks one slide at a time. The app, the
web panel and the commands use it.

| File | What it does | Documentation |
| --- | --- | --- |
| `studio.py` | The engine and its commands. | [Command reference](../docs/cli-reference.md) |
| `scene.py` | Renders only the slides that the engine asks for. | [How it works](../docs/how-it-works.md) |
| `present.py` | The presenter of Manim Slides, with a full screen mode that fits the screen. | [How it works](../docs/how-it-works.md#the-presenter) |
| `panel.html` | The web panel. | [Web panel](../docs/web-panel.md) |

The engine uses only the Python standard library. `scene.py` and `present.py` run in the Python
environment of each talk, with Manim and Manim Slides.

"""Scene that renders only some slides of a talk and saves each one on its own.

It is not used by hand: studio.py launches it from a talk's `presentacion/` folder with

    uv run python -m manim_slides render <path>/scene.py Slides

and the variable STUDIO_TARGETS = {"<index>": {"method": "slide_x", "name": "x"}, ...}.

How it works: it runs the talk's original `construct`, but each slide is treated according to
what is needed from it:

- target: it is built and drawn;
- the one before a target: it is built without drawing, because the target starts by fading it
  out; it is drawn only from its last pause;
- any other: only its start hook runs (`start_slide()`, or `iniciar_slide()` in the older
  talks), which keeps counters and frame up to date, and it is not built.

As soon as a target ends, it is saved in its own `diapos/<name>.json` and `STUDIO: saved <name>`
is printed, so the studio shows it while the others render. The other slides that are already
rendered are not touched.
"""

import json
import os
import sys
from pathlib import Path

from manim import config
from manim.utils.exceptions import EndSceneEarlyException
from manim_slides.slide import Slide

sys.path.insert(0, os.environ.get("STUDIO_TALK", os.getcwd()))
import main  # noqa: E402  (the talk's main.py)

OUTPUT = Path("diapos")
TARGETS = {int(i): v for i, v in json.loads(os.environ["STUDIO_TARGETS"]).items()}
LAST = max(TARGETS)
START_HOOKS = ("start_slide", "iniciar_slide")

Base = next(
    c for c in vars(main).values()
    if isinstance(c, type) and issubclass(c, Slide) and c.__module__ == main.__name__
)


class Slides(Base):
    def setup(self):
        super().setup()
        self._output_folder = OUTPUT
        self._s_i = -1          # index of the slide being built
        self._s_depth = 0       # so a slide_* called inside another one is not counted
        self._s_owners = []     # which slide each entry of self._slides belongs to
        self._s_name = None
        self._s_saved = set()   # the targets already saved
        self._s_skip(0 not in TARGETS)

    def _s_skip(self, skip):
        self.renderer._original_skipping_status = skip

    def play(self, *args, **kwargs):
        skipped = self.renderer._original_skipping_status
        super().play(*args, **kwargs)
        if skipped:
            # manim-slides counts animations as indexes in the list of partial videos; the
            # skipped ones leave no video, so they must not count.
            self._current_animation -= 1

    def next_slide(self, *args, **kwargs):
        before = len(self._slides)
        super().next_slide(*args, **kwargs)
        self._s_owners += [self._s_i] * (len(self._slides) - before)
        # It is drawn if this slide is a target, or if the next one is (its transition starts at
        # the last pause of this one).
        i = self._s_i
        self._s_skip(i not in TARGETS and i + 1 not in TARGETS)

    def _s_save(self, i):
        """Saves target i in its own diapos/<name>.json as soon as it is drawn, so the user sees
        each slide while the others still render."""
        info = TARGETS[i]
        self._s_saved.add(i)
        group = [s for s, o in zip(self._slides, self._s_owners) if o == i]
        if not group:
            print(f"STUDIO: the slide {info['name']} produced nothing", flush=True)
            return
        everything, current = self._slides, self._current_animation
        self._slides, self._s_name = group, info["name"]
        # So _add_last_slide doesn't add what was left after the last pause.
        self._current_animation = group[-1].end_animation
        try:
            # The same options that manim-slides gives _save_slides at the end of the render.
            super()._save_slides(use_cache=not (config["disable_caching"] or self.disable_caching),
                                 flush_cache=config["flush_cache"] or self.flush_cache,
                                 skip_reversing=self.skip_reversing)
        finally:
            self._slides, self._current_animation, self._s_name = everything, current, None
        print(f"STUDIO: saved {info['name']}", flush=True)

    def _save_slides(self, *args, **kwargs):
        # The end of the render: each target was saved when it ended, except one that did not end.
        for i in sorted(set(TARGETS) - self._s_saved):
            self._s_save(i)

    def __str__(self):
        return getattr(self, "_s_name", None) or super().__str__()


def _start_hook(scene):
    return next((getattr(scene, h) for h in START_HOOKS if hasattr(scene, h)), None)


def _announce(i, name):
    """Stops if main.py changed during the render, and says which target is being drawn."""
    if i not in TARGETS:
        return
    if TARGETS[i]["method"] != name:
        raise RuntimeError(
            f"main.py changed during the render: at position {i} I expected "
            f"{TARGETS[i]['method']} and found {name}. Try again."
        )
    done = sum(1 for j in TARGETS if j < i)
    print(f"STUDIO: drawing {TARGETS[i]['name']} ({done + 1}/{len(TARGETS)})", flush=True)


def _run_slide(scene, name, original, args, kwargs):
    """A slide_* method of the talk, treated as the module docstring says."""
    if scene._s_depth:
        return original(scene, *args, **kwargs)
    scene._s_i += 1
    i = scene._s_i
    _announce(i, name)
    scene._s_skip(i not in TARGETS)
    scene._s_depth += 1
    try:
        hook = _start_hook(scene)
        if i in TARGETS or i + 1 in TARGETS or hook is None:
            original(scene, *args, **kwargs)
        else:
            hook()
    finally:
        scene._s_depth -= 1
    if i in TARGETS:
        scene._s_save(i)
    if i >= LAST:
        raise EndSceneEarlyException()


def _wrap(name, original):
    def method(self, *args, **kwargs):
        return _run_slide(self, name, original, args, kwargs)

    method.__name__ = name
    return method


for _name in dir(Base):
    if _name.startswith("slide_") and callable(getattr(Base, _name)):
        setattr(Slides, _name, _wrap(_name, getattr(Base, _name)))

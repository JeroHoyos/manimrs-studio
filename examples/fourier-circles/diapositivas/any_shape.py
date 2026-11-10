import numpy as np
from manim import (BOLD, DOWN, DR, TAU, UL, UP, FadeIn, FadeOut, Text, ValueTracker, VGroup,
                   VMobject, linear)

from epicycles import Epicycles, coefficients, release
from style import ACCENT, FONT, SECONDARY, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "Enough circles draw any shape"
CENTER = DOWN * 0.35
STAGES = [(2, "2 circles", 5), (6, "6 circles", 6), (40, "40 circles", 10)]


def heart(samples: int = 600) -> np.ndarray:
    """A heart, as complex numbers."""
    t = np.linspace(0, TAU, samples, endpoint=False)
    x = 16 * np.sin(t) ** 3
    y = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
    z = 0.155 * (x + 1j * y)
    return z - z.mean()


def target() -> VMobject:
    """The shape to draw, faint, so each stage shows how near it gets."""
    z = heart()
    points = np.column_stack([z.real, z.imag, np.zeros(len(z))]) + CENTER
    shape = VMobject(color=SECONDARY, stroke_width=2, stroke_opacity=0.3)
    shape.set_points_as_corners([*points, points[0]])
    return shape


def stage(scene, count: int, label: str, seconds: float, before: VGroup | None) -> VGroup:
    turn = ValueTracker(0)
    machine = Epicycles(coefficients(heart(), count), turn, CENTER)
    curve = machine.curve()
    drawing = VMobject(color=ACCENT, stroke_width=5)
    drawing.add_updater(lambda m: m.set_points_as_corners(
        curve[:max(2, int(turn.get_value() * len(curve)))]))
    text = Text(label, font=FONT, font_size=TEXT_SIZE + 6, color=ACCENT, weight=BOLD)
    text.to_corner(DR, buff=0.8)

    if before is not None:
        scene.play(FadeOut(before), run_time=0.4)
    scene.add(machine, drawing)
    scene.play(FadeIn(text, shift=UP * 0.15), run_time=0.4)
    scene.play(turn.animate.set_value(1), run_time=seconds, rate_func=linear)
    release(machine, drawing)
    scene.next_slide()
    return VGroup(machine, drawing, text)


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.7)
    scene.play(FadeIn(title, shift=DOWN * 0.2), FadeIn(target()), run_time=0.8)

    before = None
    for count, label, seconds in STAGES:
        before = stage(scene, count, label, seconds, before)

    machine, drawing, _ = before
    scene.play(FadeOut(machine), drawing.animate.set_stroke(width=8), run_time=1)
    scene.next_slide()

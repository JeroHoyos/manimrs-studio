import numpy as np
from manim import (BOLD, DOWN, LEFT, RIGHT, TAU, UL, UP, Create, DashedLine, FadeIn, Line, Text,
                   ValueTracker, VMobject, always_redraw, linear)

from epicycles import Epicycles
from style import ACCENT, BLUE, FONT, SECONDARY, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "One circle makes one wave"
RADIUS = 1.4
CENTER = LEFT * 4.3 + DOWN * 0.3
WAVE_START = LEFT * 1.7 + DOWN * 0.3
WAVE_LENGTH = 7.4
TURNS = 2


def wave_points(turn: float) -> np.ndarray:
    """The height of the point of the circle, from the start to now."""
    t = np.linspace(0, max(turn, 0.001), 200)
    x = WAVE_START[0] + WAVE_LENGTH * t / TURNS
    y = WAVE_START[1] + RADIUS * np.sin(TAU * t)
    return np.column_stack([x, y, np.zeros_like(t)])


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.7)
    turn = ValueTracker(0)
    circle = Epicycles([(1, RADIUS + 0j)], turn, CENTER)
    axis = Line(WAVE_START, WAVE_START + RIGHT * WAVE_LENGTH, color=SECONDARY, stroke_width=1.5,
                stroke_opacity=0.5)

    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)
    scene.play(FadeIn(circle), run_time=0.8)
    scene.next_slide()

    link = always_redraw(lambda: DashedLine(
        circle.tip(), wave_points(turn.get_value())[-1], color=SECONDARY, stroke_width=2,
        stroke_opacity=0.7))
    wave = VMobject(color=BLUE, stroke_width=5)
    wave.add_updater(lambda m: m.set_points_as_corners(wave_points(turn.get_value())))
    caption = Text("The height of the point, as time goes", font=FONT, font_size=TEXT_SIZE,
                   color=ACCENT)
    caption.next_to(axis, DOWN, buff=1.9)

    scene.play(Create(axis), run_time=0.5)
    scene.add(link, wave)
    scene.play(turn.animate.set_value(TURNS), run_time=7, rate_func=linear)
    scene.play(FadeIn(caption, shift=UP * 0.15), run_time=0.6)
    scene.next_slide()

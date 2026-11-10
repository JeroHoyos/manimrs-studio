import numpy as np
from manim import (BOLD, DOWN, LEFT, RIGHT, UL, UP, DashedLine, FadeIn, FadeOut, Line, Text,
                   ValueTracker, VGroup, VMobject, always_redraw, linear)

from epicycles import Epicycles, release
from style import ACCENT, BLUE, FONT, SECONDARY, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "Add circles, and the wave gets corners"
SIZE = 1.25
CENTER = LEFT * 4.3 + DOWN * 0.3
WAVE_START = LEFT * 1.4 + DOWN * 0.3
WAVE_LENGTH = 7.2
TURNS = 2
STAGES = [(1, "1 circle"), (2, "2 circles"), (4, "4 circles"), (16, "16 circles")]


def square_wave(count: int) -> list[tuple[int, complex]]:
    """The circles of a square wave: each one turns 1, 3, 5… times, and is that many times smaller."""
    return [(k, complex(SIZE * 4 / np.pi / k)) for k in range(1, 2 * count, 2)]


def wave_points(machine: Epicycles, turn: float) -> np.ndarray:
    t = np.linspace(0, max(turn, 0.001), 400)
    x = WAVE_START[0] + WAVE_LENGTH * t / TURNS
    y = WAVE_START[1] + machine.tip_at(t).imag
    return np.column_stack([x, y, np.zeros_like(t)])


def stage(scene, count: int, label: str, before: VGroup | None) -> VGroup:
    """One machine with `count` circles draws its wave. The stage before it goes away."""
    turn = ValueTracker(0)
    machine = Epicycles(square_wave(count), turn, CENTER)
    link = always_redraw(lambda: DashedLine(
        machine.tip(), wave_points(machine, turn.get_value())[-1], color=SECONDARY,
        stroke_width=2, stroke_opacity=0.7))
    wave = VMobject(color=BLUE, stroke_width=5)
    wave.add_updater(lambda m: m.set_points_as_corners(wave_points(machine, turn.get_value())))
    text = Text(label, font=FONT, font_size=TEXT_SIZE + 6, color=ACCENT, weight=BOLD)
    text.move_to(CENTER + DOWN * 2.7)

    if before is not None:
        scene.play(FadeOut(before), run_time=0.4)
    scene.add(machine, link, wave)
    scene.play(FadeIn(text, shift=UP * 0.15), run_time=0.4)
    scene.play(turn.animate.set_value(TURNS), run_time=6, rate_func=linear)
    release(machine, link, wave)
    scene.next_slide()
    return VGroup(machine, link, wave, text)


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.7)
    axis = Line(WAVE_START, WAVE_START + RIGHT * WAVE_LENGTH, color=SECONDARY, stroke_width=1.5,
                stroke_opacity=0.5)
    scene.play(FadeIn(title, shift=DOWN * 0.2), FadeIn(axis), run_time=0.7)

    before = None
    for count, label in STAGES:
        before = stage(scene, count, label, before)

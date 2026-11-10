import numpy as np
from manim import (BOLD, DOWN, LEFT, RIGHT, UL, UP, Dot, FadeIn, Line, Text, ValueTracker, VGroup,
                   VMobject, linear)

from lorenz import project, trajectory
from style import ACCENT, BLUE, FONT, SECONDARY, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "Two starts, almost the same"
STEPS = 5200
FIRST = trajectory((1.0, 1.0, 1.0), STEPS)
SECOND = trajectory((1.0, 1.0, 1.001), STEPS)
GAP = np.linalg.norm(FIRST - SECOND, axis=1)
TAIL = 520
ANGLE = -0.6
CENTER = (2.9, 0.1)
GRAPH_LEFT, GRAPH_WIDTH, GRAPH_BASE, GRAPH_HEIGHT = -6.2, 4.6, -2.1, 2.2
TOGETHER = 0.42  # until here, the eye sees one path


def count_at(progress: ValueTracker) -> int:
    return max(2, int(progress.get_value() * STEPS))


def trail(points: np.ndarray, color: str, progress: ValueTracker) -> VGroup:
    """The last part of a path and its point."""
    def shown():
        return project(points[:count_at(progress)], ANGLE, scale=0.105, center=CENTER)

    line = VMobject(color=color, stroke_width=3.5)
    line.add_updater(lambda m: m.set_points_as_corners(shown()[-TAIL:]))
    dot = Dot(color=color, radius=0.08)
    dot.add_updater(lambda m: m.move_to(shown()[-1]))
    return VGroup(line, dot)


def gap_points(progress: ValueTracker) -> np.ndarray:
    """The distance between the two points, from the start to now."""
    count = count_at(progress)
    x = GRAPH_LEFT + GRAPH_WIDTH * np.arange(count) / STEPS
    y = GRAPH_BASE + GRAPH_HEIGHT * GAP[:count] / GAP.max()
    return np.column_stack([x, y, np.zeros(count)])


def starts() -> VGroup:
    one = Text("z starts at 1.000", font=FONT, font_size=TEXT_SIZE, color=BLUE)
    two = Text("z starts at 1.001", font=FONT, font_size=TEXT_SIZE, color=ACCENT)
    return VGroup(one, two).arrange(DOWN, aligned_edge=LEFT, buff=0.25)


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.7)
    labels = starts().next_to(title, DOWN, buff=0.6, aligned_edge=LEFT)
    progress = ValueTracker(0)
    base = Line(RIGHT * GRAPH_LEFT + UP * GRAPH_BASE,
                RIGHT * (GRAPH_LEFT + GRAPH_WIDTH) + UP * GRAPH_BASE,
                color=SECONDARY, stroke_width=1.5, stroke_opacity=0.6)
    graph = VMobject(color=TEXT, stroke_width=3)
    graph.add_updater(lambda m: m.set_points_as_corners(gap_points(progress)))
    graph_label = Text("Distance between them", font=FONT, font_size=TEXT_SIZE - 4,
                       color=SECONDARY).next_to(base, DOWN, buff=0.25)
    ending = Text("A change of 0.001 gives a different future", font=FONT,
                  font_size=TEXT_SIZE + 2, color=ACCENT, weight=BOLD).to_edge(DOWN, buff=0.4)

    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)
    scene.play(FadeIn(labels, shift=RIGHT * 0.2), run_time=0.6)
    scene.next_slide()

    scene.play(FadeIn(base), FadeIn(graph_label), run_time=0.4)
    ghost = VMobject(color=SECONDARY, stroke_width=1, stroke_opacity=0.35)
    ghost.set_points_as_corners(project(FIRST, ANGLE, scale=0.105, center=CENTER))
    scene.play(FadeIn(ghost), run_time=0.5)
    scene.add(trail(FIRST, BLUE, progress), trail(SECOND, ACCENT, progress), graph)
    scene.play(progress.animate.set_value(TOGETHER), run_time=7, rate_func=linear)
    scene.next_slide()

    scene.play(progress.animate.set_value(1), run_time=10, rate_func=linear)
    scene.play(FadeIn(ending, shift=UP * 0.15), run_time=0.6)
    scene.next_slide()

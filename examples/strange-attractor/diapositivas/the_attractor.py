from manim import (BOLD, DOWN, TAU, UL, UP, Dot, FadeIn, Text, ValueTracker, VMobject, linear)

from lorenz import project, trajectory
from style import ACCENT, BLUE, FONT, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "They never settle, and they never repeat"
POINTS = trajectory((1.0, 1.0, 1.0))
TAIL = 220
CENTER = (0.0, -0.35)


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.7)
    progress, angle = ValueTracker(0), ValueTracker(-1.0)

    def shown():
        count = max(2, int(progress.get_value() * len(POINTS)))
        return project(POINTS[:count], angle.get_value(), center=CENTER)

    path = VMobject(color=BLUE, stroke_width=1.6, stroke_opacity=0.6)
    path.add_updater(lambda m: m.set_points_as_corners(shown()))
    tail = VMobject(color=ACCENT, stroke_width=4.5)
    tail.add_updater(lambda m: m.set_points_as_corners(shown()[-TAIL:]))
    head = Dot(color=TEXT, radius=0.07)
    head.add_updater(lambda m: m.move_to(shown()[-1]))
    caption = Text("The Lorenz attractor", font=FONT, font_size=TEXT_SIZE, color=ACCENT)
    caption.to_edge(DOWN, buff=0.45)

    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)
    scene.add(path, tail, head)
    scene.play(progress.animate.set_value(1), angle.animate.set_value(-0.45), run_time=14,
               rate_func=linear)
    scene.play(FadeIn(caption, shift=UP * 0.15), run_time=0.6)
    # While the speaker talks, the attractor turns.
    scene.next_slide(loop=True)
    scene.play(angle.animate.increment_value(TAU), run_time=12, rate_func=linear)
    scene.next_slide()

from manim import BOLD, DOWN, LEFT, RIGHT, UP, FadeIn, GrowFromCenter, Line, Text, VGroup, Write

from style import ACCENT, FONT, SECONDARY, TEXT

TITLE = 'Drawing with circles'
SUBTITLE = "How a sum of turning circles draws any shape"


def build(scene):
    title = Text(TITLE, font=FONT, font_size=60, color=TEXT, weight=BOLD)
    rule = Line(LEFT * 1.2, RIGHT * 1.2, color=ACCENT, stroke_width=6)
    pieces = [title, rule]
    if SUBTITLE:
        pieces.append(Text(SUBTITLE, font=FONT, font_size=30, color=SECONDARY))
    for p in pieces:
        if p.width > 12:
            p.scale_to_fit_width(12)
    VGroup(*pieces).arrange(DOWN, buff=0.45)

    scene.play(Write(title), run_time=1.2)
    scene.play(GrowFromCenter(rule), *[FadeIn(p, shift=UP * 0.15) for p in pieces[2:]],
               run_time=0.8)
    scene.wait(0.3)
    scene.next_slide()

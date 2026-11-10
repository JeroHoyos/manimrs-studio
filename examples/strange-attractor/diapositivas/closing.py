from manim import BOLD, DOWN, UP, FadeIn, Text, VGroup

from style import ACCENT, FONT, TEXT

TITLE = 'Thank you'
SUBTITLE = 'Questions?'


def build(scene):
    title = Text(TITLE, font=FONT, font_size=72, color=TEXT, weight=BOLD)
    question = Text(SUBTITLE, font=FONT, font_size=34, color=ACCENT)
    VGroup(title, question).arrange(DOWN, buff=0.5)

    scene.play(FadeIn(title, scale=0.9), run_time=0.9)
    scene.play(FadeIn(question, shift=UP * 0.15), run_time=0.6)
    scene.wait(0.3)
    scene.next_slide()

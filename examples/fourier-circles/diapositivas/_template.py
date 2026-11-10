from manim import BOLD, DOWN, LEFT, RIGHT, UL, FadeIn, Line, Text, VGroup

from style import ACCENT, FONT, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "Slide title"
POINTS = [
    "First idea",
    "Second idea",
    "Third idea",
]


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.8)
    rows = VGroup()
    for point in POINTS:
        mark = Line(LEFT * 0.15, RIGHT * 0.15, color=ACCENT, stroke_width=5)
        text = Text(point, font=FONT, font_size=TEXT_SIZE, color=TEXT)
        rows.add(VGroup(mark, text).arrange(RIGHT, buff=0.3))
    rows.arrange(DOWN, aligned_edge=LEFT, buff=0.45)
    rows.next_to(title, DOWN, buff=0.8, aligned_edge=LEFT)

    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)
    for row in rows:
        scene.play(FadeIn(row, shift=RIGHT * 0.2), run_time=0.35)
    scene.wait(0.3)
    scene.next_slide()

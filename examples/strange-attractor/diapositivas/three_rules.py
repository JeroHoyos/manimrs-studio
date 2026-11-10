from manim import BOLD, DOWN, LEFT, RIGHT, UL, UP, FadeIn, Text, VGroup

from style import ACCENT, BLUE, FONT, SECONDARY, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "Three numbers, three rules"
RULES = [
    ("x", "changes by  10 (y − x)"),
    ("y", "changes by  x (28 − z) − y"),
    ("z", "changes by  x y − 8/3 z"),
]


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.7)
    rows = VGroup()
    for name, rule in RULES:
        letter = Text(name, font=FONT, font_size=64, color=BLUE, weight=BOLD)
        text = Text(rule, font=FONT, font_size=TEXT_SIZE + 8, color=TEXT)
        rows.add(VGroup(letter, text).arrange(RIGHT, buff=0.6))
    rows.arrange(DOWN, aligned_edge=LEFT, buff=0.6).move_to(UP * 0.1)
    # The rules start at the same place, whatever the width of each letter.
    left = max(row[1].get_left()[0] for row in rows)
    for row in rows:
        row[1].align_to(RIGHT * left, LEFT)
    note = Text("A small model of the air, from 1963", font=FONT, font_size=TEXT_SIZE,
                color=SECONDARY)
    question = Text("No dice. Where do the numbers go?", font=FONT, font_size=TEXT_SIZE + 4,
                    color=ACCENT)
    VGroup(note, question).arrange(DOWN, buff=0.3).next_to(rows, DOWN, buff=0.9)

    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)
    for row in rows:
        scene.play(FadeIn(row, shift=RIGHT * 0.3), run_time=0.5)
    scene.play(FadeIn(note), run_time=0.5)
    scene.next_slide()
    scene.play(FadeIn(question, shift=UP * 0.15), run_time=0.6)
    scene.next_slide()

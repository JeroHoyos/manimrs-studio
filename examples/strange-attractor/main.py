from manim import ManimColor
from manim_slides import Slide

from diapositivas import SlideBase, TalkSlides
from style import BACKGROUND


class presentation(TalkSlides, SlideBase, Slide):
    def construct(self):
        self.camera.background_color = ManimColor(BACKGROUND)

        self.slide_title()
        self.slide_three_rules()
        self.slide_the_attractor()
        self.slide_two_butterflies()
        self.slide_closing()

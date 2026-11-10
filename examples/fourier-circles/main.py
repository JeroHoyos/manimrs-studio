from manim import ManimColor
from manim_slides import Slide

from diapositivas import SlideBase, TalkSlides
from style import BACKGROUND


class presentation(TalkSlides, SlideBase, Slide):
    def construct(self):
        self.camera.background_color = ManimColor(BACKGROUND)

        self.slide_title()
        self.slide_one_circle()
        self.slide_add_circles()
        self.slide_any_shape()
        self.slide_closing()

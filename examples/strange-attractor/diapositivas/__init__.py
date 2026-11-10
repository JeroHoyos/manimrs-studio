from manim import FadeOut

from . import closing, the_attractor, three_rules, title, two_butterflies


class SlideBase:
    def start_slide(self):
        """Before each slide, whatever the previous one left stops and fades out."""
        for m in self.mobjects:
            m.clear_updaters()
        if self.mobjects:
            self.play(*[FadeOut(m) for m in self.mobjects], run_time=0.5)


def _slide(build):
    def method(self):
        self.start_slide()
        build(self)

    return method


class TalkSlides:
    slide_title = _slide(title.build)
    slide_three_rules = _slide(three_rules.build)
    slide_the_attractor = _slide(the_attractor.build)
    slide_two_butterflies = _slide(two_butterflies.build)
    slide_closing = _slide(closing.build)

from manim import FadeOut

from . import add_circles, any_shape, closing, one_circle, title


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
    slide_one_circle = _slide(one_circle.build)
    slide_add_circles = _slide(add_circles.build)
    slide_any_shape = _slide(any_shape.build)
    slide_closing = _slide(closing.build)

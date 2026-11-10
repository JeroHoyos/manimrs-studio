"""Circles that turn on circles: the drawing machine of this talk.

A closed shape is a list of complex numbers. Its Fourier coefficients tell how big each circle is,
how fast it turns and where it starts. The tip of the last circle draws the shape.
"""

import numpy as np
from manim import ORIGIN, RIGHT, Circle, Dot, Line, ValueTracker, VGroup

from style import ACCENT, SECONDARY, TEXT


def coefficients(shape: np.ndarray, count: int) -> list[tuple[int, complex]]:
    """The `count` biggest circles of a shape: (turns for each turn of the drawing, size and start)."""
    c = np.fft.fft(shape - shape.mean()) / len(shape)
    turns = np.fft.fftfreq(len(shape), 1 / len(shape)).astype(int)
    biggest = sorted(range(len(shape)), key=lambda i: -abs(c[i]))[:count]
    return [(int(turns[i]), complex(c[i])) for i in biggest]


def to_point(z: complex, origin=ORIGIN) -> np.ndarray:
    return origin + np.array([z.real, z.imag, 0.0])


class Epicycles(VGroup):
    """The chain of circles. `turn` is the time: 1 is one full drawing."""

    def __init__(self, circles: list[tuple[int, complex]], turn: ValueTracker, origin=ORIGIN):
        self.parts, self.turn, self.origin = circles, turn, origin
        self.rings = VGroup(*[
            Circle(radius=max(abs(c), 0.001), color=SECONDARY, stroke_width=1.5, stroke_opacity=0.45)
            for _, c in circles])
        self.arms = VGroup(*[Line(ORIGIN, RIGHT, color=TEXT, stroke_width=2.5) for _ in circles])
        self.dot = Dot(color=ACCENT, radius=0.07)
        super().__init__(self.rings, self.arms, self.dot)
        self.add_updater(lambda m: m.place())
        self.place()

    def joints(self, t: float) -> list[np.ndarray]:
        """The center of each circle at time `t`, then the tip."""
        z, points = 0j, [to_point(0j, self.origin)]
        for turns, c in self.parts:
            z += c * np.exp(2j * np.pi * turns * t)
            points.append(to_point(z, self.origin))
        return points

    def tip_at(self, times: np.ndarray) -> np.ndarray:
        """The tip at many times, as complex numbers from the origin of the chain."""
        return sum(c * np.exp(2j * np.pi * turns * times) for turns, c in self.parts)

    def tip(self) -> np.ndarray:
        return self.joints(self.turn.get_value())[-1]

    def curve(self, samples: int = 800) -> np.ndarray:
        """The full drawing: the points of the tip for one turn."""
        z = self.tip_at(np.linspace(0, 1, samples))
        return np.column_stack([z.real, z.imag, np.zeros(samples)]) + self.origin

    def place(self):
        points = self.joints(self.turn.get_value())
        for i, (ring, arm) in enumerate(zip(self.rings, self.arms)):
            ring.move_to(points[i])
            arm.set_points_as_corners([points[i], points[i + 1]])
        self.dot.move_to(points[-1])


def release(*mobjects):
    """Stops the motion of these objects, so they can fade out."""
    for m in mobjects:
        m.clear_updaters()

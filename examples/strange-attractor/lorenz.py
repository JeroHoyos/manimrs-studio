"""The Lorenz system: three numbers that change with three rules.

Edward Lorenz found it in 1963 in a small model of the air. The path of the three numbers never
repeats, and two paths that start almost together go apart.
"""

import numpy as np

SIGMA, RHO, BETA = 10.0, 28.0, 8.0 / 3.0
STEP = 0.005


def speed(p: np.ndarray) -> np.ndarray:
    x, y, z = p
    return np.array([SIGMA * (y - x), x * (RHO - z) - y, x * y - BETA * z])


def trajectory(start, steps: int = 4500) -> np.ndarray:
    """The path from `start`: one point for each step of time (Runge-Kutta of order 4)."""
    points = np.empty((steps, 3))
    p = np.array(start, dtype=float)
    for i in range(steps):
        points[i] = p
        a = speed(p)
        b = speed(p + a * STEP / 2)
        c = speed(p + b * STEP / 2)
        d = speed(p + c * STEP)
        p = p + (a + 2 * b + 2 * c + d) * STEP / 6
    return points


def project(points: np.ndarray, angle: float, scale: float = 0.115, center=(0.0, 0.0)) -> np.ndarray:
    """The points as the screen shows them, when you look from the side at this angle."""
    x = points[:, 0] * np.cos(angle) - points[:, 1] * np.sin(angle)
    y = points[:, 2] - 25
    return np.column_stack([x * scale + center[0], y * scale + center[1], np.zeros(len(points))])

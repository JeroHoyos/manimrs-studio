"""The manim-slides presenter with full screen that behaves.

It is not used by hand: studio.py launches it from a talk's `presentacion/` folder with

    uv run python <path>/present.py --full-screen --folder diapos <slide>... [--sacn <n>]

and it takes the same options as `manim-slides present`. What it changes:

- F switches between full screen and a window, and Esc also leaves full screen;
- manim-slides makes the render's resolution the minimum size of the window, so a 1080p render
  opens a window taller than a 1080p screen (title bar under the top edge, bottom under the
  taskbar) that cannot be shrunk, and leaving full screen goes back to it. Here the window can be
  any size and opens centred, at most 80% of the screen;
- leaving full screen returns to the window as it was (maximized or not);
- Windows 11 draws a 1 pixel border around the window even in full screen, so a thin line of
  the desktop shows around the slide. It is removed.
"""

import sys

from manim_slides.present import player as _player
from manim_slides.present import present as _present
from qtpy.QtCore import QSize, Qt
from qtpy.QtWidgets import QStyle

FULL = Qt.WindowState.WindowFullScreen
MAXIMIZED = Qt.WindowState.WindowMaximized
NORMAL = Qt.WindowState.WindowNoState


class Player(_player.Player):
    def __init__(self, *args, full_screen: bool = False, **kwargs):
        super().__init__(*args, full_screen=False, **kwargs)
        self.image_label.setMinimumSize(1, 1)
        self.setMinimumSize(320, 180)
        self.restore_state = NORMAL
        self.fit_on_screen()
        if full_screen:
            self.setWindowState(FULL)

    def fit_on_screen(self) -> None:
        area = self.screen().availableGeometry()
        w, h = self.current_presentation_config.resolution
        scale = min(0.8 * area.width() / w, 0.8 * area.height() / h)
        size = QSize(round(w * scale), round(h * scale))
        self.setGeometry(QStyle.alignedRect(Qt.LayoutDirection.LeftToRight,
                                            Qt.AlignmentFlag.AlignCenter, size, area))

    def show(self, screens) -> None:
        super().show(screens)
        self.drop_border()
        self.raise_()
        self.activateWindow()

    def full_screen(self) -> None:
        if self.isFullScreen():
            self.setWindowState(self.restore_state)
            if self.info.isVisible():
                self.info.setWindowState(NORMAL)
        else:
            self.restore_state = self.windowState() & MAXIMIZED
            self.setWindowState(FULL)
            if self.info.isVisible():
                self.info.setWindowState(FULL)

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Escape and self.isFullScreen():
            self.full_screen()
            event.accept()
            return
        super().keyPressEvent(event)

    def drop_border(self) -> None:
        """Windows 11 draws a 1 pixel border around the window, even in full screen; it goes.
        The setting stays with the window, so once is enough."""
        if sys.platform != "win32":
            return
        import ctypes

        dwmwa_border_color, dwmwa_color_none = 34, ctypes.c_uint(0xFFFFFFFE)
        dwmwa_window_corner_preference, dwmwcp_donotround = 33, ctypes.c_int(1)
        hwnd = ctypes.c_void_p(int(self.winId()))
        dwm = ctypes.windll.dwmapi
        # Older Windows do not know these attributes and just return an error.
        dwm.DwmSetWindowAttribute(hwnd, dwmwa_border_color, ctypes.byref(dwmwa_color_none), 4)
        dwm.DwmSetWindowAttribute(hwnd, dwmwa_window_corner_preference,
                                  ctypes.byref(dwmwcp_donotround), 4)


if __name__ == "__main__":
    _player.Player = Player
    _present.main(args=sys.argv[1:], prog_name="manim-slides present")

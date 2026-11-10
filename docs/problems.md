# Problems and solutions

Each section gives a message or a symptom, its cause and the solution.

## The app does not start

| Message | Cause | Solution |
| --- | --- | --- |
| *The app needs the Microsoft Edge WebView2 Runtime* | The window of the app is a WebView2. Windows 11 has it. Some Windows 10 computers do not have it. | Install the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). Then start the app again. |
| *Can't find the talks folder* | The app did not find `manimrs-studio\engine\studio.py`. The `.exe` file is not in the repository, or the repository moved. | Start the app from `manimrs-studio\target\release`. If the `.exe` file is in a different place, set the `STUDIO_ROOT` variable to the talks folder. |

## The window shows "uv is not installed"

The app reads and renders the talks with uv.

1. Click *Get uv* and install uv.
2. Close the app.
3. Start the app again.

The app finds uv on the `PATH` and in `.local\bin` of your user folder.

## The chat shows "Claude Code is not installed"

1. Install [Claude Code](https://claude.com/claude-code).
2. Run `claude` in a terminal and log in.
3. Close the app and start it again.

The list of slides, the render and the review work without Claude Code.

## A message shows "FFmpeg is not installed"

Without FFmpeg, the app renders and presents the talks. But the slides have no thumbnails, Claude
cannot examine the images of a slide, and the PDF export does not work.

1. Install [FFmpeg](https://ffmpeg.org/download.html).
2. Make sure that the `ffmpeg` command works in a new terminal.
3. Close the app and start it again.

## A render is slow or stops

| Symptom | Cause | Solution |
| --- | --- | --- |
| The first render of a talk takes some minutes. | The talk installs Manim and Manim Slides in its own Python environment. | Wait. The subsequent renders are fast. |
| *Another render of this talk is running* | The web panel, a command or Claude renders the same talk. | Wait for that render, or click *Cancel*. |
| *The render failed* | An error in the code of a slide, or a program that Manim cannot find, for example LaTeX. | Click *Log* at the bottom. The last lines show the error of Manim. |
| *main.py changed during the render* | A change to `main.py` while the render ran. | Render again. |
| *Could not find uv* | The engine cannot run uv. | Install uv. Then close the app and start it again. |

To send the error to Claude, copy the last lines of the log into the chat.

## A talk is not in the list

The list shows only the talks whose folder the engine can find. If you moved the folder of a talk,
or if its drive is not connected, the talk is not in the list.

- If the drive is not connected, connect it. The talk comes back.
- If you moved the folder, select *Open a talk…* and select the new folder.

## The build cannot replace the .exe file

The app is open. Close the app, then build again.

## The web panel does not open

| Message | Cause | Solution |
| --- | --- | --- |
| *The panel is already open* | A different terminal runs the web panel on port 8765. | Use the browser page that is open, or stop the other terminal with Ctrl+C. |
| The browser shows error 403. | The address is not `127.0.0.1:8765` or `localhost:8765`. | Open http://127.0.0.1:8765. The panel does not answer to other addresses. |

## Linux

| Message or symptom | Cause | Solution |
| --- | --- | --- |
| *To choose a folder, install zenity or kdialog* | The app found no dialog program. | Install `zenity` or `kdialog`. |
| *No terminal program was found* | The app found no terminal that it knows. | Install `xterm`, or run `claude` in your terminal. |
| The video of a slide does not play. | The codecs of GStreamer are not installed. | Install `gstreamer1.0-libav` and `gstreamer1.0-plugins-good`. |
| *its file could not go to the recycle bin* | The `gio` program is not installed. | Delete the file of the slide in its folder. |

## Report a problem

If the problem continues, open an issue. Give the message, the last lines of the log and the
versions of Windows, the app, uv and Claude Code.

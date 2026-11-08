# Web panel

The web panel shows the slides and the review in a browser. It uses the same engine and the same
files as the app. You can use the app, the web panel and the commands together.

## Start the web panel

1. Double-click `studio.cmd` in the `manimrs-studio` folder.
2. Wait for the browser. It opens http://127.0.0.1:8765.

To start it from a terminal, type `.\studio` in the `manimrs-studio` folder. To stop it, push
Ctrl+C in the terminal window.

The web panel answers only to its own page. A web site in the browser cannot send it requests.

## The parts of the panel

| Part | Contents |
| --- | --- |
| Left | The slides in the order of `main.py`, each with a status dot. |
| Center | The video of the slide, one pause at a time (‹ ›), with *Render* and *Present from here*. Click the file name to open the code in VS Code. |
| Review | A note for the slide, with *Approve* and *Request changes*. |
| Top | *Render pending* renders the new slides and the slides that changed. *Present* opens the presenter. *Export* makes the package for another device. |

| Dot | Status |
| --- | --- |
| Green | up to date |
| Hollow | not rendered |
| Amber | changed |
| Amber ring | previous slide changed |
| Blue | shared code changed |

## Send changes to Claude

1. Write what to change in *Review*.
2. Click *Request changes*.
3. Do steps 1 and 2 again for each slide that must change.
4. Click *Copy for Claude* at the top.
5. Paste the text in a Claude Code chat.

To send one slide only, click *Copy for Claude* below its note.

Claude changes only those slides and renders them again. It examines their images and gives you a
link to each slide. The panel shows these slides as *to review*.

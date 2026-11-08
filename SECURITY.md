# Security policy

## Supported versions

Only the last version on the `main` branch gets security fixes.

## Report a vulnerability

Do not report a vulnerability in a public issue.

1. Go to the *Security* tab of the repository.
2. Click *Report a vulnerability*.
3. Give the version, the steps that show the problem and the effect of the problem.

The maintainers read each report. They tell you when the fix is ready, before they publish the
vulnerability.

## The security model

The app runs Claude Code and Python on the computer of the user. These rules control what can get
to them.

### The local server

- The server answers only on `127.0.0.1`.
- The server answers only to requests with the host name `127.0.0.1` or `localhost`. A web page
  cannot get to the server through a DNS rebinding attack.
- The server refuses requests that come from a web page.
- The MCP tools answer only to the Claude session that the app started. Each start of the app makes
  a new secret token. Only that Claude session gets the token.

### The answers of Claude

- The app shows the answers of Claude as Markdown. DOMPurify cleans the HTML of each answer.
- The answers cannot have forms, buttons, styles, ids or classes. This prevents answers that look
  like a part of the app.
- The answers cannot show images from the internet. An image address can send data out.
- The window loads only its own scripts. The content security policy is in `app/tauri.conf.json`.

### Links and files

- The app opens a link in the browser only if it is a web link. It never opens a link through `cmd`.
- The app opens a file only if it is a text file in the user folder.
- The app makes only CLAUDE.md files and settings files. It never runs a file.

### Input to Python and Claude Code

- The app examines the names of talks, models, modes and effort levels before it sends them to
  Python or Claude Code.
- The app names a talk only by its short name from `talks.json`: letters, digits, `-` and `_`. It
  never names a talk by a path.
- The folders that you select are full paths. The folder name of a new talk cannot go out of the
  folder that holds it.

### The files of a talk

- Only one process at a time changes `_renders.json`, `_reviews.json` and `_resolutions.json`.
  A render and a review can occur at the same time, and neither one loses a change.
- If the engine cannot read one of these files, it changes nothing.

### The web panel

- The web panel answers only on `127.0.0.1`, and only to its own page.
- It sends only its own page and the files that are in the `diapos` folder of a talk.

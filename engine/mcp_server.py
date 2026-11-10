"""MCP server of ManimRS Studio for any agent: OpenCode, Codex (ChatGPT), Gemini CLI, Cursor…

The agent starts it (the app does not have to be open) and talks to it through its input and
output, one JSON-RPC message per line:

    uv run --no-project manimrs-studio/engine/mcp_server.py

It gives the same tools the app gives its own Claude chat (talks, slides, notes, render, view,
place, export, present), and each one runs a studio.py command, so the app, the web panel and the
commands see what the agent does. Only the Python standard library.
"""

import base64
import json
import re
import subprocess
import sys
from pathlib import Path

STUDIO = Path(__file__).resolve().parent / "studio.py"
ROOT = STUDIO.parent.parent.parent
VERSION = "0.5.0"
QUALITIES = ("480p", "720p", "1080p")
# The same names the app accepts: letters, digits, “-” and “_”, never an option or a path.
TALK = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_-]{0,79}")

INSTRUCTIONS = (
    "Tools of ManimRS Studio. Each slide of a manim talk is rendered on its own: rendering one "
    "never touches the others. Flow to create or change one: edit its .py with your own tools, "
    "register it in diapositivas/__init__.py if it is new, place it in main.py with “place”, "
    "render it with “render” and check it with “view”. A talk can live in any folder: “talks” "
    "gives the folder of each one. Before editing, read its talk.manimrs (title, what it is "
    "about, language, resolution) and its AGENTS.md or README. If the ManimRS Studio app is "
    "open, the user sees there every slide you render."
)

_TALK = {"type": "string", "description": "The talk, as “talks” lists it (works without “charla-”)."}
_SLIDE = {"type": "string", "description": "Name of the slide as “slides” lists it, or its number."}


def _tool(name: str, description: str, properties: dict, required: list, read_only=False) -> dict:
    tool = {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties, "required": required}}
    if read_only:
        tool["annotations"] = {"readOnlyHint": True}
    return tool


TOOLS = [
    _tool("talks", "Lists the talks: name, title and folder of each one.", {}, [], True),
    _tool("slides", "The slides of a talk in the order of main.py: number, name, render status, "
          "the user's review and its .py file.", {"talk": _TALK}, ["talk"], True),
    _tool("notes", "The changes the user requested in the review, with the slide and its file.",
          {"talk": _TALK}, ["talk"], True),
    _tool("render", "Renders only those slides, without touching the others, and waits for them. "
          "About 10 s per slide at 480p and 30 s at 1080p.",
          {"talk": _TALK,
           "slides": {"type": "array", "items": {"type": "string"}, "description": "Names or numbers."},
           "quality": {"type": "string", "enum": list(QUALITIES),
                       "description": "The talk's resolution by default; 480p to test quickly."}},
          ["talk", "slides"]),
    _tool("view", "Images of the end of each pause of an already rendered slide, to check it.",
          {"talk": _TALK, "slide": _SLIDE}, ["talk", "slide"], True),
    _tool("place", "Adds self.<method>() to construct() in main.py, after the given slide (or at "
          "the end). The method must already be registered in diapositivas/__init__.py.",
          {"talk": _TALK, "method": {"type": "string", "description": "Like slide_git_stash."},
           "after": _SLIDE}, ["talk", "method"]),
    _tool("export", "Builds the HTML package (.zip) or a PDF with what is already rendered. Only "
          "if the user asks.", {"talk": _TALK, "format": {"type": "string", "enum": ["html", "pdf"]}},
          ["talk"]),
    _tool("present", "Opens the full-screen presenter. Only if the user asks.",
          {"talk": _TALK, "start": _SLIDE}, ["talk"]),
]


def studio(*args: str) -> str:
    """Runs a studio.py command and returns what it printed; its error, as an exception."""
    done = subprocess.run([sys.executable, "-X", "utf8", str(STUDIO), *args], cwd=ROOT,
                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                          stdin=subprocess.DEVNULL)
    if done.returncode != 0:
        raise RuntimeError((done.stdout + done.stderr).strip() or "The studio gave an error")
    return done.stdout.strip()


def _text(text: str) -> dict:
    return {"type": "text", "text": text}


def _names(value) -> list[str]:
    """The slides of a render: a list of names or numbers, or a single one."""
    items = value if isinstance(value, list) else [value] if value not in (None, "") else []
    return [str(i) for i in items if isinstance(i, (str, int)) and not isinstance(i, bool)]


def _render(talk: str, a: dict) -> list[dict]:
    slides = _names(a.get("slides"))
    if not slides:
        raise RuntimeError("Tell me which slides to render.")
    quality = a.get("quality") or ""
    if quality and quality not in QUALITIES:
        raise RuntimeError("The quality is 480p, 720p or 1080p.")
    option = [f"--quality={quality}"] if quality else []
    # After “--” a slide is always a slide, even if its name starts with a dash.
    return [_text(studio(talk, "render", *option, "--", *slides))]


def _view(talk: str, a: dict) -> list[dict]:
    slide = str(a.get("slide", "")).strip()
    paths = [Path(line.strip()) for line in studio(talk, "stills", "--width=1280", "--", slide).splitlines()
             if line.strip().lower().endswith(".png")]
    if not paths:
        raise RuntimeError("No frames came out, is ffmpeg installed?")
    content = [_text(f"{slide}: {len(paths)} pause(s); each image is the end of a pause.")]
    for i, path in enumerate(paths, 1):
        content += [_text(f"Pause {i} of {len(paths)}"),
                    {"type": "image", "mimeType": "image/png",
                     "data": base64.b64encode(path.read_bytes()).decode("ascii")}]
    return content


def _place(talk: str, a: dict) -> list[dict]:
    after = str(a.get("after", "")).strip()
    option = [f"--after={after}"] if after else []
    return [_text(studio(talk, "place", *option, "--", str(a.get("method", "")).strip()))]


def _present(talk: str, a: dict) -> list[dict]:
    start = str(a.get("start", "")).strip()
    # The presenter is a window the user closes: it is not waited for.
    subprocess.Popen([sys.executable, "-X", "utf8", str(STUDIO), talk, "present",
                      *(["--", start] if start else [])], cwd=ROOT, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return [_text("Opening the presenter.")]


ACTIONS = {
    "slides": lambda talk, a: [_text(studio(talk, "list"))],
    "notes": lambda talk, a: [_text(studio(talk, "notes"))],
    "render": _render,
    "view": _view,
    "place": _place,
    "export": lambda talk, a: [_text(studio(talk, "export", *(["--pdf"] if a.get("format") == "pdf" else [])))],
    "present": _present,
}


def call(name: str, a: dict) -> dict:
    """Runs a tool; a failure is an answer with isError, as MCP wants, not a protocol error."""
    try:
        if name == "talks":
            return {"content": [_text(studio("talks"))], "isError": False}
        if name not in ACTIONS:
            raise RuntimeError(f"Unknown tool “{name}”.")
        talk = str(a.get("talk", "")).strip()
        if not TALK.fullmatch(talk):
            raise RuntimeError("There is no such talk: use one of the talks the “talks” tool lists.")
        return {"content": ACTIONS[name](talk, a), "isError": False}
    except (RuntimeError, OSError) as e:
        return {"content": [_text(str(e))], "isError": True}


def answer(message: dict) -> dict | None:
    """The answer to one JSON-RPC message; notifications (no id) get none."""
    if "id" not in message:
        return None
    method, params = message.get("method", ""), message.get("params") or {}
    if method == "initialize":
        result = {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                  "capabilities": {"tools": {}},
                  "serverInfo": {"name": "studio", "title": "ManimRS Studio", "version": VERSION},
                  "instructions": INSTRUCTIONS}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        arguments = params.get("arguments")
        result = call(str(params.get("name", "")), arguments if isinstance(arguments, dict) else {})
    else:
        return {"jsonrpc": "2.0", "id": message["id"],
                "error": {"code": -32601, "message": f"Method not supported: {method}"}}
    return {"jsonrpc": "2.0", "id": message["id"], "result": result}


def main():
    for stream in (sys.stdin, sys.stdout):
        stream.reconfigure(encoding="utf-8", newline="\n")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            reply = answer(message) if isinstance(message, dict) else None
        except ValueError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if reply is not None:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()

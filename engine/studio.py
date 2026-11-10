"""Slide studio: renders, reviews, presents and exports the talks one slide at a time.

Run it with the `studio.cmd` launcher in `manimrs-studio/` (or, from the talks folder, with
`uv run --no-project manimrs-studio/engine/studio.py ...`):

    studio                                  opens the panel in the browser
    studio talks                            lists the talks, with the folder of each one
    studio open <folder>                    adds a talk from any folder (its own, or its presentacion/)
    studio new-talk "Title" [--about "…"] [--language es|en]
                    [--in <folder>] [--folder <name>]
                                            creates a talk with a title slide and a closing slide,
                                            in <folder>/<name> (next to the others by default)
    studio <talk> info [--title "…"] [--about "…"] [--resolution 720p] …
                                            its talk.manimrs: what the talk is (or changes it)
    studio <talk> forget                    takes it off the list, its folder stays as it is
    studio <talk> list                      its slides and their status
    studio <talk> render <slide>...         renders only those (name or number)
    studio <talk> render --pending          the new ones and the ones that changed
    studio <talk> render --all              the whole talk
    studio <talk> present [<slide>]         presents what is rendered, starting at <slide>
    studio <talk> export [--pdf]            HTML folder + .zip for another device, or a PDF
    studio <talk> stills <slide>            one PNG per pause, to review without the video
    studio <talk> notes                     the changes requested from the panel
    studio <talk> note <slide> "text"       requests a change (or --approve / --clear)
    studio <talk> new "name" [--after <slide>]          creates, registers and places a slide
    studio <talk> place slide_x [--after <slide>]       places an already registered slide
    studio <talk> move <slide> --after <slide>          or --first
    studio <talk> rename <slide> "new name"             its renders are renamed too
    studio <talk> restore <slide>                       uncomments a slide in main.py
    studio <talk> delete <slide>                        its file goes to the recycle bin
    studio <talk> resolution <slide> 480p|720p|1080p|default

Render option: --quality 480p|720p|1080p (the talk's resolution by default).

A talk is the folder with its main.py, wherever it is: `presentacion/` in the older talks, the
talk's own folder in the ones made by the Studio. The Studio remembers which ones it knows in
`manimrs-studio/talks.json`, and each talk keeps what it is (title, what it is about, language,
resolution) in its `talk.manimrs`, next to its main.py.

<talk> is the name `talks` gives it (charla-claude), or that name without the prefix (claude).
Everything it produces lives in `diapos/` of each talk: one .json per slide plus its videos, so
rendering one slide never deletes or redoes the others.
"""

import sys

if sys.version_info < (3, 10):  # before the other imports: an older Python fails on the syntax below
    raise SystemExit("ManimRS Studio needs Python 3.10 or newer, run it with uv: "
                     "uv run --no-project manimrs-studio/engine/studio.py")

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import threading
import time
import unicodedata
from collections import Counter, deque
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

# The app starts this file for every question it asks, so what only the panel and the exports use
# (http.server, mimetypes, webbrowser, zipfile, tempfile) is imported where it is used: together
# they added about 50 ms to every start.

HERE = Path(__file__).resolve().parent
# The talks folder: this file lives in <talks>/manimrs-studio/engine/.
ROOT = HERE.parent.parent
SCENE = HERE / "scene.py"
PANEL = HERE / "panel.html"
# The talks the Studio knows, wherever they are: [{"id": "charla-git", "path": "…"}]. A path inside
# the talks folder is kept relative to it, so the whole folder can be moved.
REGISTRY = HERE.parent / "talks.json"
REGISTRY_LOCK = HERE.parent / ".talks.lock"
# Each talk's own file with what it is. JSON, so the app, the panel and Claude read it alike.
PROJECT_FILE = "talk.manimrs"
PROJECT_FIELDS = {"title": "", "about": "", "author": "", "language": "es", "resolution": "1080p"}
LANGUAGE = re.compile(r"[a-z]{2,3}(-[A-Za-z]{2,4})?")
# Folder names of the talks' own format: every talk keeps its code in presentacion/ and its slide
# modules in presentacion/diapositivas/. The renders folder keeps the name "diapos" because the
# manim-slides files inside it store their video paths with that name.
PRESENTATION = "presentacion"
SLIDES_PACKAGE = "diapositivas"
RENDERS = "diapos"
TALK_PREFIX = "charla-"
PORT = 8765
QUALITIES = {"480p": "l", "720p": "m", "1080p": "h"}
LABELS = {
    "up_to_date": "up to date",
    "new": "not rendered",
    "changed": "changed",
    "transition": "previous slide changed",
    "shared": "shared code changed",
    "resolution": "different resolution",
    "out": "commented out",
}
PENDING = {"new", "changed", "transition", "resolution"}
NOT_SHARED = {".venv", "media", "slides", RENDERS, "__pycache__", ".ruff_cache",
              ".complexipy_cache", ".git"}


# ───────────────────────────── talks and slides ─────────────────────────────

class Talk:
    """A talk: the folder with its main.py (`pres`) and the name the Studio knows it by (`id`)."""

    def __init__(self, pres: Path, id: str):
        self.pres = pres
        self.id = id
        self.renders = pres / RENDERS
        # In the older talks the code is in presentacion/ and the README one level up.
        self.root = pres.parent if pres.name.lower() == PRESENTATION else pres

    @property
    def project(self) -> dict:
        """What its talk.manimrs says (empty if it has none yet)."""
        data = read_json(self.pres / PROJECT_FILE, {})
        return data if isinstance(data, dict) else {}

    @property
    def title(self) -> str:
        title = self.project.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
        return _readme_title(_readme(self)) or self.id

    @property
    def resolution(self) -> str:
        """The talk's resolution: the one of the slides that don't have one of their own."""
        r = self.project.get("resolution")
        return r if r in QUALITIES else "1080p"

    def path(self, name: str) -> Path:
        return self.renders / name


def _readme(talk: Talk) -> list[str]:
    for folder in dict.fromkeys((talk.pres, talk.root)):
        p = folder / "README.md"
        if p.is_file():
            return p.read_text("utf-8", errors="replace").splitlines()
    return []


def _readme_title(lines: list[str]) -> str:
    return next((l[2:].strip() for l in lines if l.startswith("# ")), "")


_NOT_PROSE = ("#", "```", "|", "<", "!", ">", "- ", "* ")


def _readme_about(lines: list[str]) -> str:
    """The first paragraph after the title, without Markdown marks."""
    start = next((i + 1 for i, l in enumerate(lines) if l.startswith("# ")), 0)
    paragraph = []
    for line in lines[start:]:
        if line.strip() and not line.lstrip().startswith(_NOT_PROSE):
            paragraph.append(line.strip())
        elif paragraph:
            break
    text = re.sub(r"\*\*|__|`", "", " ".join(paragraph))
    return re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)[:1000]


# ───────────────────────────── the list of talks ─────────────────────────────

def _located(text: str) -> Path:
    p = Path(text)
    return p if p.is_absolute() else ROOT / p


def _stored(p: Path) -> str:
    try:
        return p.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return str(p.resolve())


def _same(a: Path, b: Path) -> bool:
    return os.path.normcase(str(a.resolve())) == os.path.normcase(str(b.resolve()))


def _slug(text: str) -> str:
    """A name that is safe everywhere the talk is named: “Mi Charla (2026)” → mi-charla-2026."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9_]+", "-", plain.lower()).strip("-_")[:60].strip("-_") or "talk"


def _clashes(name: str, ids) -> bool:
    """Whether `name` could be confused with another talk, also by its short name (without “charla-”)."""
    short = name.removeprefix(TALK_PREFIX)
    return any(name == i or short == i or name == i.removeprefix(TALK_PREFIX) for i in ids)


def _valid(items: list) -> list[dict]:
    return [e for e in items
            if isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("path"), str)]


def _entries() -> list[dict]:
    if not REGISTRY.exists():
        _seed()
    data = read_json(REGISTRY, {})
    return _valid(data.get("talks", []) if isinstance(data, dict) else [])


def _seed():
    """The first time, the Studio knows the talks next to its folder, as it always did."""
    found, ids = [], []
    for main in sorted(ROOT.glob(f"*/{PRESENTATION}/main.py")):
        name, n = _slug(main.parent.parent.name), 2
        while name in ids:
            name, n = f"{_slug(main.parent.parent.name)}-{n}", n + 1
        ids.append(name)
        found.append({"id": name, "path": _stored(main.parent)})
    # If another process made the list meanwhile, that one stays.
    update_json(REGISTRY, lambda data: data.setdefault("talks", found), lock=REGISTRY_LOCK)


def talks() -> list[Talk]:
    """The talks the Studio knows whose folder is there (one on a drive that is not plugged in
    stays on the list and comes back when the drive does)."""
    return [Talk(_located(e["path"]), e["id"]) for e in _entries()
            if (_located(e["path"]) / "main.py").is_file()]


def find_talk(text: str) -> Talk:
    everything = talks()
    talk = (next((t for t in everything if t.id == text), None)
            or next((t for t in everything if t.id.removeprefix(TALK_PREFIX) == text), None))
    if talk is None:
        names = ", ".join(t.id for t in everything) or "none yet"
        raise SystemExit(f"There is no talk called “{text}”, the talks are: {names}")
    migrate(talk)
    ensure_project(talk)
    return talk


def talk_folder_of(p: Path) -> Path:
    """The folder with the main.py of what the user picked: that folder, its presentacion/, or the
    folder of a talk.manimrs."""
    p = p.expanduser()
    if not p.is_absolute():
        raise RuntimeError("Give the whole path of the folder")
    if p.is_file() and p.suffix == Path(PROJECT_FILE).suffix:
        p = p.parent
    if not p.is_dir():
        raise RuntimeError("That folder does not exist")
    for folder in (p, p / PRESENTATION):
        if (folder / "main.py").is_file():
            return folder.resolve()
    raise RuntimeError("There is no talk in that folder, choose the folder of a talk or its "
                       "presentacion folder")


def _free_id(base: str, items: list[dict]) -> str:
    """`base`, or base-2, base-3… if a talk on the list has it. A talk whose folder is gone gives
    its name back."""
    alive = [e["id"] for e in items if (_located(e["path"]) / "main.py").is_file()]
    name, n = base, 2
    while _clashes(name, alive):
        name, n = f"{base}-{n}", n + 1
    return name


def register(pres: Path) -> Talk:
    """Adds the talk in `pres` to the Studio's list, or finds it if it is already there."""
    _entries()  # makes the list the first time
    pres = pres.resolve()
    named = pres.parent.name if pres.name.lower() in (PRESENTATION, "presentation") else pres.name
    chosen = {}

    def change(data):
        items = _valid(data.get("talks", []))
        known = next((e["id"] for e in items if _same(_located(e["path"]), pres)), None)
        if known:
            chosen["id"] = known
            return
        name = _free_id(_slug(named), items)
        data["talks"] = [e for e in items if e["id"] != name] + [{"id": name, "path": _stored(pres)}]
        chosen["id"] = name

    update_json(REGISTRY, change, lock=REGISTRY_LOCK)
    talk = Talk(pres, chosen["id"])
    migrate(talk)
    ensure_project(talk)
    return talk


def open_talk(folder: Path) -> Talk:
    return register(talk_folder_of(folder))


def forget(talk: Talk) -> str:
    """Takes the talk off the list. Its folder, code and videos stay as they are."""
    def change(data):
        data["talks"] = [e for e in data.get("talks", [])
                         if not (isinstance(e, dict) and e.get("id") == talk.id)]
    update_json(REGISTRY, change, lock=REGISTRY_LOCK)
    return f"{talk.title} left the list, its folder stays as it was"


# ───────────────────────────── talk.manimrs ─────────────────────────────

def project_info(talk: Talk) -> dict:
    """The fields of talk.manimrs, with their defaults when the file doesn't say."""
    data = talk.project
    info = {k: data[k].strip() if isinstance(data.get(k), str) else d for k, d in PROJECT_FIELDS.items()}
    info["title"], info["resolution"] = talk.title, talk.resolution
    return info


def _project_change(base: dict, changes: dict):
    def change(data):
        fields = {k: data[k] if isinstance(data.get(k), str) else base[k] for k in PROJECT_FIELDS}
        fields.update(changes)
        # Anything else the user wrote in the file stays, after the known fields.
        extra = {k: v for k, v in data.items() if k not in PROJECT_FIELDS and k != "manimrs"}
        data.clear()
        data.update({"manimrs": 1, **fields, **extra})
    return change


def ensure_project(talk: Talk):
    """Gives a talk its talk.manimrs the first time, from its README and its renders."""
    p = talk.pres / PROJECT_FILE
    if p.exists():
        return
    lines = _readme(talk)
    used = Counter(r.get("quality") for r in read_json(talk.path("_renders.json"), {}).values()
                   if isinstance(r, dict) and r.get("quality") in QUALITIES)
    base = {**PROJECT_FIELDS, "title": _readme_title(lines) or talk.id, "about": _readme_about(lines),
            "resolution": used.most_common(1)[0][0] if used else "1080p"}

    def first_time(data):
        if not data:  # another process may have just made it
            _project_change(base, {})(data)

    try:
        update_json(p, first_time, lock=talk.path("_data.lock"), indent=2)
    except (OSError, RuntimeError):
        pass  # a read-only folder still works, with the defaults


def _clean_field(k: str, v) -> str:
    if k not in PROJECT_FIELDS:
        raise RuntimeError(f"A talk has no “{k}”")
    v = str(v).strip() if k == "about" else " ".join(str(v).split())
    if k == "title" and not v:
        raise RuntimeError("The talk needs a title")
    if k == "resolution" and v not in QUALITIES:
        raise RuntimeError("The resolution is 480p, 720p or 1080p")
    if k == "language" and not LANGUAGE.fullmatch(v):
        raise RuntimeError("The language is a code like es or en")
    return v[:4000]


def save_project(talk: Talk, changes: dict) -> dict:
    clean = {k: _clean_field(k, v) for k, v in changes.items()}
    update_json(talk.pres / PROJECT_FILE, _project_change(project_info(talk), clean),
                lock=talk.path("_data.lock"), indent=2)
    return project_info(talk)


# Earlier versions kept their bookkeeping under Spanish names. It is converted once, the first
# time a talk is used, so existing renders, reviews and resolutions keep working.
_LEGACY_QUALITY = {"baja": "480p", "media": "720p", "alta": "1080p"}
_LEGACY_REVIEW = {"aprobada": "approved", "cambios": "changes", "por_revisar": "to_review"}


_LEGACY_FILES = [
    ("_registro.json", "_renders.json", lambda v: {
        "method": v.get("metodo"), "file": v.get("archivo"), "hash": v.get("hash"),
        "previous": v.get("previa"), "previous_hash": v.get("hash_previa"),
        "shared_hash": v.get("hash_comun"),
        "quality": _LEGACY_QUALITY.get(v.get("calidad"), v.get("calidad")),
        "date": v.get("fecha")}),
    ("_revision.json", "_reviews.json", lambda v: {
        "status": _LEGACY_REVIEW.get(v.get("estado"), v.get("estado")),
        "note": v.get("nota", ""), "hash": v.get("hash"), "date": v.get("fecha")}),
    ("_calidades.json", "_resolutions.json", lambda v: _LEGACY_QUALITY.get(v, v)),
]
_LEGACY_FOLDERS = (("_miniaturas", "_thumbnails"), ("_fotos", "_stills"), ("exportado", "exported"))


def _convert_legacy(source: Path, target: Path, convert):
    data = read_json(source, None) if source.exists() else None
    if data is None:
        return
    if not target.exists():
        write_json(target, {k: convert(v) for k, v in data.items()})
    source.unlink(missing_ok=True)


def migrate(talk: Talk):
    r = talk.renders
    if not r.is_dir():
        return
    for old, new, convert in _LEGACY_FILES:
        _convert_legacy(r / old, r / new, convert)
    for old, new in _LEGACY_FOLDERS:
        source, target = r / old, r / new
        if source.is_dir() and not target.exists():
            with suppress(OSError):
                source.rename(target)


@dataclass
class Slide:
    pos: int | None       # the number the user sees (1, 2, …); None when it is commented out
    index: int | None     # position among the active calls in construct (0, 1, …)
    method: str
    name: str             # the name of its .json in diapos/
    group: str
    file: str             # its .py, relative to presentacion/
    active: bool
    hash: str = ""
    previous: str = ""
    previous_hash: str = ""
    line: int = 0         # its line in main.py (from 0)


CALL = re.compile(r"^\s*(#\s*)?self\.(slide_\w+)\(\)\s*(#.*)?$")
COMMENT = re.compile(r"^\s*#\s*(.*\S)\s*$")


def _first_name(node):
    while isinstance(node, (ast.Attribute, ast.Call)):
        node = node.value if isinstance(node, ast.Attribute) else node.func
    return node.id if isinstance(node, ast.Name) else None


def _module_file(base: Path, name: str) -> Path | None:
    candidates = (base / f"{name}.py", base / name / "__init__.py", base.with_suffix(".py"))
    return next((c for c in candidates if c.exists()), None)


def _relative_imports(tree) -> list[ast.ImportFrom]:
    """The `from .x import …` statements of a module."""
    return [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.level == 1]


def _import_aliases(tree, folder: Path) -> dict[str, Path]:
    aliases = {}
    for node in _relative_imports(tree):
        base = folder.joinpath(*node.module.split(".")) if node.module else folder
        aliases.update({n.asname or n.name: _module_file(base, n.name) for n in node.names})
    return aliases


def _class_body(tree):
    """The statements inside the classes of a module."""
    return (st for cls in tree.body if isinstance(cls, ast.ClassDef) for st in cls.body)


def _alias_of(st: ast.Assign) -> str | None:
    """The module a registration takes its slide from: `slide_x = _slide(x.build)` → x."""
    return _first_name(st.value.args[0]) if isinstance(st.value, ast.Call) and st.value.args else None


def file_map(pres: Path) -> dict[str, Path]:
    """slide_x -> the .py that holds its content, read from diapositivas/__init__.py."""
    init = pres / SLIDES_PACKAGE / "__init__.py"
    if not init.exists():
        return {}
    tree = ast.parse(init.read_text("utf-8"))
    aliases = _import_aliases(tree, init.parent)
    result = {}
    for st in _class_body(tree):
        if isinstance(st, ast.FunctionDef) and st.name.startswith("slide_"):
            result[st.name] = init
        elif isinstance(st, ast.Assign) and isinstance(st.value, ast.Call):
            result.update(dict.fromkeys(_slide_names(st), aliases.get(_alias_of(st)) or init))
    return result


def _slide_names(st) -> list[str]:
    """The slide_x names a class statement assigns."""
    targets = st.targets if isinstance(st, ast.Assign) else []
    return [t.id for t in targets if isinstance(t, ast.Name) and t.id.startswith("slide_")]


def _fingerprint(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()[:12] if p.exists() else ""


def _calls(lines: list[str]):
    """(line number, CALL match, group) of each slide call in construct(); the group is the last
    comment above it."""
    start = next((i for i, l in enumerate(lines) if re.match(r"\s*def construct\(", l)), None)
    if start is None:
        raise RuntimeError("main.py has no construct()")
    indent, group = len(_indent(lines[start])), ""
    for i, line in enumerate(lines[start + 1:], start + 1):
        if line.strip() and len(_indent(line)) <= indent:
            return
        m, c = CALL.match(line), COMMENT.match(line)
        if m:
            yield i, m, group
        elif c:
            group = c.group(1)


def read_plan(talk: Talk) -> list[Slide]:
    """The slides in the order of construct() in main.py, including the commented-out ones."""
    files = file_map(talk.pres)
    slides, seen, n = [], Counter(), 0
    for i, m, group in _calls((talk.pres / "main.py").read_text("utf-8").splitlines()):
        method, active = m.group(2), not m.group(1)
        base = method.removeprefix("slide_")
        file = files.get(method, talk.pres / "main.py")
        rel = file.relative_to(talk.pres).as_posix()
        if not active:
            slides.append(Slide(None, None, method, base, group, rel, False, line=i))
            continue
        # A repeated slide (like the practice one) is numbered with a dash: a Python method can't
        # contain dashes, so the name never collides with another slide.
        seen[method] += 1
        name = base if seen[method] == 1 else f"{base}-{seen[method]}"
        slides.append(Slide(n + 1, n, method, name, group, rel, True, _fingerprint(file), line=i))
        n += 1
    active = [s for s in slides if s.active]
    for before, s in zip(active, active[1:]):
        s.previous, s.previous_hash = before.name, before.hash
    return slides


def _python_files(pres: Path):
    """The .py files of a talk in a fixed order, without the folders that tools make (NOT_SHARED)."""
    for folder, subfolders, files in os.walk(pres):
        subfolders[:] = sorted(s for s in subfolders if s not in NOT_SHARED)
        yield from (Path(folder) / name for name in sorted(files) if name.endswith(".py"))


def shared_fingerprint(talk: Talk, plan: list[Slide]) -> str:
    """Fingerprint of all the shared code: what is neither main.py nor the file of a slide."""
    own = {s.file for s in plan} | {"main.py", f"{SLIDES_PACKAGE}/__init__.py"}
    h = hashlib.sha1()
    for p in _python_files(talk.pres):
        rel = p.relative_to(talk.pres).as_posix()
        if rel not in own:
            h.update(rel.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:12]


# On Windows a file can't be replaced while another process is reading it, nor read while it is
# being replaced: those moments last milliseconds, so reads and writes try again for a while.
_RETRIES, _PAUSE = 40, 0.05


def read_json(p: Path, default):
    for _ in range(_RETRIES):
        try:
            return json.loads(p.read_text("utf-8"))
        except FileNotFoundError:
            return default
        except PermissionError:
            time.sleep(_PAUSE)
        except (OSError, ValueError):
            return default
    return default


def write_json(p: Path, data, indent=1):
    p.parent.mkdir(parents=True, exist_ok=True)
    # A name of its own: the app, the panel and a render can be writing at the same time.
    tmp = p.with_name(f"{p.name}.{os.getpid()}-{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + ("\n" if indent > 1 else ""),
                   "utf-8")
    for attempt in range(_RETRIES):
        try:
            tmp.replace(p)
            return
        except PermissionError:
            if attempt == _RETRIES - 1:
                tmp.unlink(missing_ok=True)
                raise RuntimeError(f"Could not save {p.name}, it is in use, try again") from None
            time.sleep(_PAUSE)


class _DataLock:
    """One process at a time changes the bookkeeping of a talk (`_renders.json`, `_reviews.json`,
    `_resolutions.json`): the app, the web panel and a render that ends can try at the same moment,
    and without this one change would overwrite the other. Windows releases the lock by itself if
    the process dies."""

    def __init__(self, p: Path):
        self.p = p

    def _lock(self, unlock=False):
        if os.name == "nt":
            import msvcrt
            self.f.seek(0)
            msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK if unlock else msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.f, fcntl.LOCK_UN if unlock else fcntl.LOCK_EX | fcntl.LOCK_NB)

    def __enter__(self):
        self.p.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.p, "a+b")  # noqa: SIM115 — closed in __exit__
        deadline = time.monotonic() + 30
        while True:
            try:
                self._lock()
                return self
            except OSError:
                if time.monotonic() > deadline:
                    self.f.close()
                    raise RuntimeError("Another process is changing this talk, try again") from None
                time.sleep(0.03)

    def __exit__(self, *_):
        try:
            self._lock(unlock=True)
        except OSError:
            pass
        finally:
            self.f.close()


_data_lock = threading.Lock()


def update_json(p: Path, change, lock: Path | None = None, indent=1):
    """Reads, changes and saves a JSON file, one process at a time (`lock` is the file that
    says who is changing it; by default `_data.lock` next to it)."""
    with _data_lock, _DataLock(lock or p.parent / "_data.lock"):
        try:
            data = json.loads(p.read_text("utf-8")) if p.exists() else {}
        except (OSError, ValueError):
            # Starting from empty would erase every render or review it holds: better to stop.
            data = read_json(p, None)
            if data is None:
                raise RuntimeError(f"Could not read {p.name}, nothing was changed") from None
        if not isinstance(data, dict):
            raise RuntimeError(f"{p.name} is not what it should be, nothing was changed")
        change(data)
        write_json(p, data, indent)


def parts(talk: Talk, name: str) -> list[dict]:
    """The videos of a rendered slide (one per pause)."""
    data = read_json(talk.path(f"{name}.json"), {})
    return [
        {"video": talk.pres / Path(s["file"].replace("\\", "/")), "loop": s.get("loop", False)}
        for s in data.get("slides", [])
    ]


def _status(talk: Talk, s: Slide, r: dict | None, shared: str, wanted: str) -> str:
    """Why the slide must be rendered again (a key of LABELS), or up_to_date. `r` is its line in
    _renders.json, `wanted` the resolution it must have: its own, or else the talk's."""
    if not s.active:
        return "out"
    if not r or not talk.path(f"{s.name}.json").exists():
        return "new"
    if r["hash"] != s.hash:
        return "changed"
    if (r["previous"], r["previous_hash"]) != (s.previous, s.previous_hash):
        return "transition"
    if r["shared_hash"] != shared:
        return "shared"
    return "up_to_date" if r["quality"] == wanted else "resolution"


def _review(reviews: dict, s: Slide) -> dict:
    """An approval is only valid for the code that was approved."""
    review = reviews.get(s.name, {}) if s.active else {}
    if review.get("status") == "approved" and review.get("hash") != s.hash:
        return {**review, "status": "to_review"}
    return review


def talk_status(talk: Talk) -> dict:
    plan = read_plan(talk)
    renders = read_json(talk.path("_renders.json"), {})
    reviews = read_json(talk.path("_reviews.json"), {})
    preferred = read_json(talk.path("_resolutions.json"), {})
    shared = shared_fingerprint(talk, plan)
    default = talk.resolution
    rows = []
    for s in plan:
        r = renders.get(s.name) if s.active else None
        wanted = preferred.get(s.name) if s.active else None
        status = _status(talk, s, r, shared, wanted or default)
        done = r or {}
        rows.append({**asdict(s), "status": status, "label": LABELS[status],
                     "quality": done.get("quality"), "rendered_at": done.get("date"),
                     "resolution": wanted, "review": _review(reviews, s)})
    project = project_info(talk)
    return {"id": talk.id, "title": project["title"], "path": str(talk.pres), "project": project,
            "resolution": project["resolution"], "slides": rows}


def file_url(talk: Talk, p: Path) -> str:
    try:
        rel = p.relative_to(talk.renders).as_posix()
    except ValueError:  # written another way (a link, “..”): the slow way, through the real paths
        rel = p.resolve().relative_to(talk.renders.resolve()).as_posix()
    return f"/file/{talk.id}/{rel}?v={int(p.stat().st_mtime)}"


def status_with_media(talk: Talk) -> dict:
    """The status plus the addresses of videos and thumbnails, as the panels serve them."""
    data = talk_status(talk)
    for row in data["slides"]:
        row["parts"] = [{"url": file_url(talk, p["video"]), "loop": p["loop"]}
                        for p in (parts(talk, row["name"]) if row["active"] else [])
                        if p["video"].exists()]
        thumb = talk.path(f"_thumbnails/{row['name']}.jpg")
        row["thumbnail"] = file_url(talk, thumb) if row["active"] and thumb.exists() else None
    data["ffmpeg"] = bool(shutil.which("ffmpeg"))
    return data


def _find(plan: list[Slide], t: str) -> Slide | None:
    """An active slide by number or name, else by method (slide_x or x)."""
    s = next((s for s in plan if s.active and (str(s.pos) == t or s.name == t)), None)
    return s or next((s for s in plan if s.active and s.method in (t, f"slide_{t}")), None)


def _not_found(talk: Talk, plan: list[Slide], t: str) -> SystemExit:
    if any(not x.active and x.name == t for x in plan):
        return SystemExit(f"“{t}” is commented out in main.py, restore it first")
    similar = [x.name for x in plan if x.active and t in x.name][:8]
    hint = f", did you mean {', '.join(similar)}?" if similar else ""
    return SystemExit(f"There is no slide “{t}” in {talk.id}{hint}")


def resolve(talk: Talk, plan: list[Slide], texts: list[str]) -> list[Slide]:
    chosen = []
    for t in texts:
        s = _find(plan, t)
        if s is None:
            raise _not_found(talk, plan, t)
        if s not in chosen:
            chosen.append(s)
    return chosen


def targets_of(talk: Talk, plan: list[Slide], what) -> list[Slide]:
    """The slides to render: "all", "pending", or a list of names or numbers."""
    if what == "all":
        return [s for s in plan if s.active]
    if what == "pending":
        statuses = status_by_name(talk)
        return [s for s in plan if s.active and statuses[s.name] in PENDING]
    return resolve(talk, plan, what)


# ───────────────────────────── processes ─────────────────────────────

def _env(**extra) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    env.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1", COLUMNS="160", **extra)
    return env


class RenderLock(_DataLock):
    """One render at a time per talk, even if the panel and Claude ask at the same moment. The
    system holds the lock for the process and frees it when the process ends, also when it is
    killed. (A lock file with a process id stayed after a kill, and Windows gives that id to new
    processes: the next render waited forever.)"""

    def __init__(self, talk: Talk, log):
        super().__init__(talk.path("_render.lock"))
        self.log = log

    def __enter__(self):
        self.p.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.p, "a+b")  # noqa: SIM115 — closed in __exit__
        warned = False
        while True:
            try:
                self._lock()
                return self
            except OSError:
                if not warned:
                    self.log("Another render of this talk is running, waiting for it to finish…")
                    warned = True
                time.sleep(2)


def _start(cmd, **options) -> subprocess.Popen:
    # Under the panel on Linux each job leads a process group, so “Cancel” stops it with its
    # children. Under the app it stays in the group the app gave the engine, which the app stops.
    own_group = os.name != "nt" and JOBS is not None
    try:
        return subprocess.Popen(cmd, start_new_session=own_group, **options)
    except FileNotFoundError:
        raise RuntimeError(f"Could not find {cmd[0]}, install it (or add it to the PATH) and "
                           "try again") from None


def run(cmd, cwd, log, env=None, on_start=None) -> tuple[int, list[str]]:
    proc = _start(cmd, cwd=cwd, env=env or _env(), stdout=subprocess.PIPE,
                  stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    if on_start:
        on_start(proc)
    lines = []
    for line in proc.stdout:
        line = line.rstrip()
        lines.append(line)
        if line.startswith("STUDIO: "):
            log(line.removeprefix("STUDIO: "))
    return proc.wait(), lines


def frame(video: Path, target: Path, width: int | None = None) -> bool:
    ff = shutil.which("ffmpeg")
    if not ff or not video.exists():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    scale = ["-vf", f"scale={width}:-2"] if width else []
    for from_end in (["-sseof", "-0.1"], []):
        subprocess.run([ff, "-v", "error", "-y", *from_end, "-i", str(video),
                        "-frames:v", "1", *scale, str(target)], capture_output=True)
        if target.exists() and target.stat().st_mtime > time.time() - 30:
            return True
    return False


def thumbnail(talk: Talk, name: str):
    videos = parts(talk, name)
    if videos:
        frame(videos[-1]["video"], talk.path(f"_thumbnails/{name}.jpg"), width=480)


# ───────────────────────────── commands ─────────────────────────────

def render(talk: Talk, targets: list[Slide], quality="1080p", log=print, on_start=None) -> list[str]:
    """Each slide comes out in the resolution chosen for it or, if it has none, in `quality`."""
    if not targets:
        log("Nothing to render, everything is up to date")
        return []
    preferred = read_json(talk.path("_resolutions.json"), {})
    groups: dict[str, list[Slide]] = {}
    for s in targets:
        groups.setdefault(preferred.get(s.name, quality), []).append(s)
    saved = []
    for q, group in groups.items():
        saved += _render_at(talk, group, q, log, on_start)
    return saved


def _render_at(talk: Talk, targets: list[Slide], quality: str, log, on_start) -> list[str]:
    plan = read_plan(talk)
    shared = shared_fingerprint(talk, plan)
    current = {s.name: s for s in plan if s.active}
    targets = [current[s.name] for s in targets if s.name in current]
    wanted = {str(s.index): {"method": s.method, "name": s.name} for s in targets}
    cmd = ["uv", "run", "python", "-m", "manim_slides", "render", "--quality",
           QUALITIES[quality], "--progress_bar", "none", str(SCENE), "Slides"]
    env = _env(STUDIO_TARGETS=json.dumps(wanted), STUDIO_TALK=str(talk.pres))
    saved = []

    def progress(text):
        """A slide counts as soon as scene.py saves it, so the app shows it while the others
        render, and it stays even if the render fails later."""
        if text.startswith("saved "):
            s = current[text.removeprefix("saved ")]
            _record(talk, [s], shared, quality)
            thumbnail(talk, s.name)
            saved.append(s.name)
        log(text)

    with RenderLock(talk, log):
        if not (talk.pres / ".venv").exists():
            log("Setting up the talk's Python, the first time takes a few minutes…")
        log(f"Rendering {len(targets)} slide(s) of {talk.id} at {quality}…")
        started = time.time()
        code, lines = run(cmd, talk.pres, progress, env, on_start)
    if code != 0:
        log("The render failed, last lines:")
        _fail(lines, 30, "the render failed", log)
    log(f"Done: {len(saved)} saved in {time.time() - started:.0f} s")
    return saved


def _fail(lines: list[str], last: int, message: str, log):
    """Shows the last lines of a failed process and stops."""
    for line in [l for l in lines if l.strip()][-last:]:
        log("  " + line)
    raise RuntimeError(message)


def _record(talk: Talk, done: list[Slide], shared: str, quality: str):
    now = datetime.now().isoformat(timespec="seconds")

    def record(renders):
        for s in done:
            renders[s.name] = {"method": s.method, "file": s.file, "hash": s.hash,
                               "previous": s.previous, "previous_hash": s.previous_hash,
                               "shared_hash": shared, "quality": quality, "date": now}

    def back_to_review(reviews):
        for s in done:
            r = reviews.get(s.name)
            if r and not (r.get("status") == "approved" and r.get("hash") == s.hash):
                r["status"] = "to_review"

    update_json(talk.path("_renders.json"), record)
    update_json(talk.path("_reviews.json"), back_to_review)


def rendered(talk: Talk) -> tuple[list[str], list[str]]:
    active = [s for s in read_plan(talk) if s.active]
    have = [s.name for s in active if talk.path(f"{s.name}.json").exists()]
    missing = [s.name for s in active if s.name not in have]
    return have, missing


def present(talk: Talk, start: str | None = None, wait=True, log=print):
    have, missing = rendered(talk)
    if not have:
        raise RuntimeError("No slides are rendered yet")
    if missing:
        log(f"Heads up, {len(missing)} are not rendered and get skipped: {', '.join(missing[:10])}"
            + ("…" if len(missing) > 10 else ""))
    # present.py is manim-slides' presenter opening in full screen, with a window that fits the
    # screen when leaving it (manim-slides' own does not fit with 1080p renders).
    cmd = ["uv", "run", "python", str(HERE / "present.py"), "--full-screen",
           "--folder", RENDERS, *have]
    if start in have:
        cmd += ["--sacn", str(have.index(start))]
    log("Presenting in full screen: → next, ← back, F or Esc for a window, Q quit")
    proc = _start(cmd, cwd=talk.pres, env=_env())
    if wait:
        proc.wait()


def export(talk: Talk, fmt="html", log=print, only: str | None = None) -> Path:
    """Exports the talk as HTML, PDF or MP4. With `only`, exports that slide as MP4 or GIF."""
    have, missing = rendered(talk)
    if not have:
        raise RuntimeError("No slides are rendered yet")
    target = talk.path("exported")
    target.mkdir(parents=True, exist_ok=True)
    if only:
        return _export_slide(talk, only, have, fmt, target, log)
    if missing:
        log(f"Heads up, {len(missing)} not rendered are left out of the export")
    if fmt == "gif":
        raise RuntimeError("A GIF is of one slide, tell me which slide")
    if fmt == "mp4":
        return _export_video(talk, have, fmt, target / f"{talk.id}.mp4", log)
    if fmt == "pdf":
        return _export_pdf(talk, have, target / f"{talk.id}.pdf", log)
    base = ["uv", "run", "python", "-m", "manim_slides", "convert", "--folder", RENDERS, *have]
    folder = target / talk.id
    shutil.rmtree(folder, ignore_errors=True)
    html = folder / f"{talk.id}.html"
    _convert(talk, base + [str(html), "--offline"], log)
    # manim-slides writes paths with “\” on Windows; with “/” it also opens on Macs and phones.
    text = html.read_text("utf-8")
    html.write_text(text.replace(f"{talk.id}_assets\\", f"{talk.id}_assets/"), "utf-8")
    import zipfile
    file = target / f"{talk.id}.zip"
    log("Compressing…")
    with zipfile.ZipFile(file, "w", zipfile.ZIP_STORED) as z:
        for p in sorted(folder.rglob("*")):
            z.write(p, p.relative_to(target))
    log(f"Done: {file} ({file.stat().st_size / 1e6:.0f} MB), unzip it on the other device and "
        f"open {talk.id}.html with Chrome, Edge, Firefox or Safari")
    return file


VIDEO_SIZES = {"480p": (854, 480), "720p": (1280, 720), "1080p": (1920, 1080)}
GIF_WIDTH, GIF_FPS = 960, 15


def _export_slide(talk: Talk, name: str, have: list[str], fmt: str, target: Path, log) -> Path:
    if fmt not in ("mp4", "gif"):
        raise RuntimeError("One slide exports as MP4 or GIF")
    if name not in have:
        raise RuntimeError(f"{name} is not rendered")
    return _export_video(talk, [name], fmt, target / f"{name}.{fmt}", log)


def _video_filter(talk: Talk, fmt: str) -> list[str]:
    """What ffmpeg does to the frames. An MP4 has the resolution of the talk: a slide with a
    different resolution gets that size too. A GIF is small and has its own colors."""
    if fmt == "gif":
        return ["-vf", f"fps={GIF_FPS},scale={GIF_WIDTH}:-2:flags=lanczos,split[a][b];"
                       "[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
                "-loop", "0"]
    w, h = VIDEO_SIZES.get(talk.resolution, VIDEO_SIZES["1080p"])
    return ["-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                   f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-an"]


def _video_list(talk: Talk, names: list[str], folder: Path) -> Path:
    """The file that tells ffmpeg which videos to join, in order. A loop plays one time."""
    videos = [p["video"] for name in names for p in parts(talk, name) if p["video"].exists()]
    if not videos:
        raise RuntimeError("Could not find the videos of the slides, render them again")
    listing = folder / "videos.txt"
    quoted = (v.resolve().as_posix().replace("'", "'\\''") for v in videos)
    listing.write_text("".join(f"file '{v}'\n" for v in quoted), "utf-8")
    return listing


def _export_video(talk: Talk, names: list[str], fmt: str, file: Path, log) -> Path:
    """One video with the slides in order (MP4), or a GIF of them."""
    ff = shutil.which("ffmpeg")
    if not ff:
        raise RuntimeError("The video needs ffmpeg, install it and try again")
    import tempfile
    log(f"Joining the videos of {len(names)} slide{'s' if len(names) != 1 else ''}…")
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [ff, "-v", "error", "-y", "-f", "concat", "-safe", "0",
               "-i", str(_video_list(talk, names, Path(tmp))), *_video_filter(talk, fmt), str(file)]
        code, lines = run(cmd, talk.pres, log)
    if code != 0:
        _fail(lines, 20, "the export failed", log)
    log(f"Done: {file} ({file.stat().st_size / 1e6:.1f} MB)")
    return file


def _export_pdf(talk: Talk, names: list[str], file: Path, log) -> Path:
    """One page for each pause: the last frame of its video."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("The PDF needs ffmpeg, install it and try again")
    import tempfile
    log("Taking the last frame of each pause…")
    pages = []
    with tempfile.TemporaryDirectory() as tmp:
        for video in pdf_videos(talk, names):
            png = Path(tmp) / f"{len(pages)}.png"
            if frame(video, png):
                pages.append(png.read_bytes())
    if not pages:
        raise RuntimeError("Could not take any frames from the videos")
    file.write_bytes(pdf_of_pngs(pages))
    log(f"Done: {file} ({len(pages)} pages)")
    return file


def pdf_videos(talk: Talk, names: list[str]) -> list[Path]:
    """The video of each page. A loop ends where it starts, at the end of the pause before it, so
    it has no page of its own, unless it is the first pause of its slide."""
    return [p["video"] for name in names
            for i, p in enumerate(parts(talk, name)) if i == 0 or not p["loop"]]


def _png_pixels(data: bytes) -> tuple[int, int, bytes]:
    """Width, height and compressed pixels of an 8-bit RGB PNG, as ffmpeg writes them."""
    if data[24:26] != b"\x08\x02" or data[28]:
        raise RuntimeError("The frame is not an 8-bit RGB PNG")
    width, height = struct.unpack(">II", data[16:24])
    chunks, i = [], 8
    while i < len(data):
        (size,) = struct.unpack(">I", data[i:i + 4])
        if data[i + 4:i + 8] == b"IDAT":
            chunks.append(data[i + 8:i + 8 + size])
        i += 12 + size
    return width, height, b"".join(chunks)


def _pdf_stream(entries: str, data: bytes) -> bytes:
    return f"<< {entries} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"


def pdf_of_pngs(pngs: list[bytes]) -> bytes:
    """A PDF with one page for each PNG. PDF reads the PNG pixels as they are, so nothing is
    compressed again and no quality is lost."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    kids = []
    for data in pngs:
        w, h, pixels = _png_pixels(data)
        n = len(objects) + 1
        pw, ph = 960, round(960 * h / w)  # the same page size for every resolution
        kids.append(f"{n} 0 R")
        objects += [
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw} {ph}] "
            f"/Resources << /XObject << /I {n + 1} 0 R >> >> /Contents {n + 2} 0 R >>".encode(),
            _pdf_stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} "
                        "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                        f"/DecodeParms << /Predictor 15 /Colors 3 /Columns {w} >>", pixels),
            _pdf_stream("", f"q {pw} 0 0 {ph} 0 0 cm /I Do Q".encode()),
        ]
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def _convert(talk: Talk, cmd, log):
    log("Exporting… (the first time it downloads reveal.js, so it needs internet)")
    code, lines = run(cmd, talk.pres, log)
    if code != 0:
        _fail(lines, 20, "the export failed", log)


def stills(talk: Talk, s: Slide, log=print, width: int | None = None) -> list[Path]:
    videos = parts(talk, s.name)
    if not videos:
        raise RuntimeError(f"{s.name} is not rendered")
    folder = talk.path(f"_stills/{s.name}")
    shutil.rmtree(folder, ignore_errors=True)
    made = []
    for i, p in enumerate(videos, 1):
        target = folder / f"pause_{i}.png"
        if frame(p["video"], target, width):
            made.append(target)
    if not made:
        raise RuntimeError("Could not grab any frames, is ffmpeg installed?")
    for p in made:
        log(str(p))
    return made


def place(talk: Talk, method: str, after: Slide | None) -> str:
    """Adds `self.<method>()` to construct() in main.py: after `after`, or at the end."""
    method = method if method.startswith("slide_") else f"slide_{method}"
    if method not in file_map(talk.pres):
        raise RuntimeError(f"{method} is not registered in {SLIDES_PACKAGE}/__init__.py: "
                           "register it first.")
    plan = read_plan(talk)
    ref = after or next((s for s in reversed(plan) if s.active), None)
    if ref is None:
        raise RuntimeError("main.py has no active slide to use as a reference.")
    main = talk.pres / "main.py"
    # Bytes instead of read_text: keeps the Windows line endings as they are.
    lines = main.read_bytes().decode("utf-8").splitlines(keepends=True)
    previous = lines[ref.line]
    indent = previous[:len(previous) - len(previous.lstrip())]
    eol = "\r\n" if previous.endswith("\r\n") else "\n"
    lines.insert(ref.line + 1, f"{indent}self.{method}(){eol}")
    main.write_text("".join(lines), "utf-8", newline="")
    return f"Placed {method} after {ref.name} in main.py."


# ─────────── editing the talk: new, move, rename, restore, delete, resolution ───────────
# Files are read and written as bytes so their Windows line endings stay as they are.

INIT = Path(SLIDES_PACKAGE) / "__init__.py"
TEMPLATE_FILES = ("_template.py", "_plantilla.py")
TEMPLATE_TITLES = ("Slide title", "Título de la diapositiva")


def _read(p: Path) -> str:
    return p.read_bytes().decode("utf-8")


def _write(p: Path, text: str):
    p.write_bytes(text.encode("utf-8"))


def _eol(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def _indent(line: str) -> str:
    return line[:len(line) - len(line.lstrip())]


def to_name(text: str) -> str:
    """“Git stash, how to save” → git_stash_how_to_save."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    name = re.sub(r"[^a-z0-9]+", "_", plain.lower()).strip("_")
    if not name or not name[0].isalpha():
        raise RuntimeError("The name has to start with a letter")
    return name


def _check_free(talk: Talk, name: str):
    if f"slide_{name}" in file_map(talk.pres):
        raise RuntimeError(f"There is already a slide called {name}")


def _assignments(tree):
    """(statement, its slide_x names) of each slide registration."""
    for st in _class_body(tree):
        names = _slide_names(st)
        if names:
            yield st, names


def _assignment(tree, method: str):
    return next((st for st, names in _assignments(tree) if method in names), None)


def _import_names(node, add: str | None, remove: str | None) -> list[str]:
    names = [ast.unparse(a) for a in node.names] if node else []  # "x" or "x as y"
    if add and add not in names:
        # Without reordering what is there: the new name goes in its alphabetical place.
        names.insert(next((i for i, n in enumerate(names) if n.lower() > add.lower()), len(names)), add)
    return [n for n in names if n.split(" as ")[-1] != remove]


def _import_text(module: str, names: list[str], multiline: bool, eol: str) -> str:
    single = f"from .{module} import {', '.join(names)}"
    if not names:
        return ""
    if multiline or len(single) > 99:
        return f"from .{module} import ({eol}" + "".join(f"    {n},{eol}" for n in names) + f"){eol}"
    return single + eol


def _edit_import(text: str, module: str, add: str | None = None, remove: str | None = None) -> str:
    """Adds or removes a name from `from .<module> import …` in the text of __init__.py."""
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    relative = _relative_imports(tree)
    node = next((n for n in relative if (n.module or "") == module), None)
    multiline = node is not None and node.end_lineno > node.lineno
    new = _import_text(module, _import_names(node, add, remove), multiline, _eol(text))
    if node is None:
        lines.insert(max((n.end_lineno for n in relative), default=0), new)
    else:
        lines[node.lineno - 1:node.end_lineno] = [new]
    return "".join(lines)


def _template(talk: Talk, name: str, init_text: str, function: str) -> str:
    title = name.replace("_", " ").capitalize()
    for file in TEMPLATE_FILES:
        own = talk.pres / SLIDES_PACKAGE / file
        if own.exists():
            text = _read(own)
            for placeholder in TEMPLATE_TITLES:
                text = text.replace(placeholder, title)
            return text
    # If the wrapper already makes the final pause (like in langchain), the slide doesn't repeat it.
    wrapper = re.search(r"^def _slide\b.*?(?=^\S)", init_text, re.S | re.M)
    pause = "" if wrapper and "next_slide(" in wrapper.group(0) else "    scene.next_slide()\n"
    return (
        "from manim import DOWN, GRAY, FadeIn, Text\n\n"
        "# New slide made from ManimRS Studio: its content is still missing.\n"
        f'TITLE = "{title}"\n\n\n'
        f"def {function}(scene):\n"
        "    title = Text(TITLE, font_size=44, color=GRAY)\n"
        "    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)\n"
        "    scene.wait(0.5)\n"
        f"{pause}"
    )


def _slide_folder(talk: Talk, ref: Slide) -> Path:
    """The folder of the reference slide, if it is inside diapositivas/."""
    package = talk.pres / SLIDES_PACKAGE
    folder = (talk.pres / ref.file).parent
    return folder if folder == package or package in folder.parents else package


def _registration(tree, ref: Slide) -> tuple[ast.Assign, str, str]:
    """Where the reference slide is registered (or the last registration), its wrapper and its
    function: the new slide is registered like it, `construir` in the older talks, `build` in the
    new ones."""
    assignment = _assignment(tree, ref.method) or next(
        (st for st, _ in reversed(list(_assignments(tree)))), None)
    if assignment is None:
        raise RuntimeError("I can't find where the slides are registered")
    call = assignment.value
    wrapper = call.func.id if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) else "_slide"
    argument = call.args[0] if isinstance(call, ast.Call) and call.args else None
    function = argument.attr if isinstance(argument, ast.Attribute) else "construir"
    return assignment, wrapper, function


def new_slide(talk: Talk, name: str, after: Slide | None) -> Slide:
    """Creates the file from the template, registers it and places it in main.py after `after`."""
    name = to_name(name)
    _check_free(talk, name)
    plan = read_plan(talk)
    ref = after or next((s for s in reversed(plan) if s.active), None)
    if ref is None:
        raise RuntimeError("The talk has no slide to use as a reference")
    package = talk.pres / SLIDES_PACKAGE
    folder = _slide_folder(talk, ref)
    file = folder / f"{name}.py"
    if file.exists():
        raise RuntimeError(f"There is already a file {file.name} in that folder")
    init, main = talk.pres / INIT, talk.pres / "main.py"
    init_text, main_text = _read(init), _read(main)
    ref_assignment, wrapper, function = _registration(ast.parse(init_text), ref)
    try:
        file.write_text(_template(talk, name, init_text, function), "utf-8")
        lines = init_text.splitlines(keepends=True)
        indent = _indent(lines[ref_assignment.lineno - 1])
        lines.insert(ref_assignment.end_lineno,
                     f"{indent}slide_{name} = {wrapper}({name}.{function}){_eol(init_text)}")
        module = ".".join(folder.relative_to(package).parts)
        _write(init, _edit_import("".join(lines), module, add=name))
        place(talk, f"slide_{name}", ref)
    except Exception:
        _write(init, init_text)
        _write(main, main_text)
        file.unlink(missing_ok=True)
        raise
    return next(s for s in read_plan(talk) if s.method == f"slide_{name}")


def _copy_name(talk: Talk, s: Slide) -> str:
    """A name for the copy of a slide that no slide has: x_copy, then x_copy_2, x_copy_3…"""
    taken = {p.name for p in read_plan(talk)}
    names = (f"{s.name}_copy" + (f"_{n}" if n > 1 else "") for n in range(1, 1000))
    return next(n for n in names if n not in taken)


def duplicate(talk: Talk, s: Slide, name: str | None = None) -> Slide:
    """Makes a copy of a slide with a new name, registers it and places it after the slide. The
    copy starts with the code of the slide, so a variation of a slide is a small change."""
    if not s.active:
        raise RuntimeError("Put the slide back in the talk before you duplicate it")
    source = talk.pres / s.file
    copy = new_slide(talk, name or _copy_name(talk, s), s)
    (talk.pres / copy.file).write_text(_read(source), "utf-8", newline="")
    return next(p for p in read_plan(talk) if p.method == copy.method)


def move(talk: Talk, s: Slide, after: Slide | None) -> str:
    """Moves the call of `s` in main.py right after `after`, or to the start."""
    if after is not None and after.line == s.line:
        return "It is already there"
    first = next(x.line for x in read_plan(talk) if x.active)
    target = after.line + 1 if after else first
    main = talk.pres / "main.py"
    lines = _read(main).splitlines(keepends=True)
    line = lines.pop(s.line)
    lines.insert(target - 1 if target > s.line else target, line)
    _write(main, "".join(lines))
    return f"{s.name} is now " + (f"after {after.name}" if after else "first")


def _rename_in_path(path: str, old: str, new: str) -> str:
    sep = "\\" if "\\" in path else "/"
    pieces = path.split(sep)
    for i in range(len(pieces) - 1):
        if pieces[i] == "files" and pieces[i + 1] == old:
            pieces[i + 1] = new
    return sep.join(pieces)


def _rename_render_json(source: Path, target: Path, old: str, new: str):
    """manim-slides keeps the paths of the videos inside the .json: they change with the name."""
    data = json.loads(source.read_text("utf-8"))
    for s in data.get("slides", []):
        s.update({k: _rename_in_path(s[k], old, new) for k in ("file", "rev_file") if s.get(k)})
    target.write_text(json.dumps(data, indent=2), "utf-8")
    source.unlink()


def _move_render(talk: Talk, old: str, new: str):
    """Gives the render files of one slide (its .json, videos and thumbnail) the new name."""
    if talk.path(f"{old}.json").exists():
        _rename_render_json(talk.path(f"{old}.json"), talk.path(f"{new}.json"), old, new)
    for a, b in ((f"files/{old}", f"files/{new}"),
                 (f"_thumbnails/{old}.jpg", f"_thumbnails/{new}.jpg")):
        if talk.path(a).exists() and not talk.path(b).exists():
            talk.path(a).rename(talk.path(b))
    shutil.rmtree(talk.path(f"_stills/{old}"), ignore_errors=True)


def _rename_keys(data: dict, pairs: list[tuple[str, str]]):
    for old, new in pairs:
        if old in data:
            data[new] = data.pop(old)


def _rename_renders(talk: Talk, pairs: list[tuple[str, str]], methods=("", "")):
    """Moves the renders of each old name to the new one, so nothing has to be rendered again."""
    pairs = [(a, b) for a, b in pairs if a != b]
    for old, new in pairs:
        _move_render(talk, old, new)
    mapping = dict(pairs)

    def in_renders(renders):
        _rename_keys(renders, pairs)
        for r in renders.values():
            r["previous"] = mapping.get(r.get("previous"), r.get("previous"))
            if methods[0] and r.get("method") == methods[0]:
                r["method"] = methods[1]

    update_json(talk.path("_renders.json"), in_renders)
    update_json(talk.path("_reviews.json"), lambda data: _rename_keys(data, pairs))
    update_json(talk.path("_resolutions.json"), lambda data: _rename_keys(data, pairs))


def _delete_renders(talk: Talk, names: list[str]):
    for n in names:
        talk.path(f"{n}.json").unlink(missing_ok=True)
        talk.path(f"_thumbnails/{n}.jpg").unlink(missing_ok=True)
        shutil.rmtree(talk.path(f"files/{n}"), ignore_errors=True)
        shutil.rmtree(talk.path(f"_stills/{n}"), ignore_errors=True)

    def drop(data):
        for n in names:
            data.pop(n, None)

    for file in ("_renders.json", "_reviews.json", "_resolutions.json"):
        update_json(talk.path(file), drop)


def rename(talk: Talk, s: Slide, new: str) -> str:
    """Changes the slide_x method in __init__.py and main.py; its renders are renamed with it."""
    new = to_name(new)
    old, method = s.method, f"slide_{new}"
    if method == old:
        return "It already has that name"
    _check_free(talk, new)
    before = _repetitions(talk, old)
    init = talk.pres / INIT
    text = _read(init)
    assignment = _assignment(ast.parse(text), old)
    if assignment is None:
        raise RuntimeError(f"I can't find where {s.name} is registered")
    lines = text.splitlines(keepends=True)
    lines[assignment.lineno - 1] = re.sub(rf"\b{old}\b", method, lines[assignment.lineno - 1], count=1)
    _write(init, "".join(lines))
    main = talk.pres / "main.py"
    _write(main, re.sub(rf"(self\.){old}(\(\))", rf"\g<1>{method}\g<2>", _read(main)))
    after = _repetitions(talk, method)
    _rename_renders(talk, list(zip(before, after)), (old, method))
    return f"{s.name} is now called {new}"


def restore(talk: Talk, s: Slide) -> str:
    """Uncomments the call of a slide in main.py."""
    main = talk.pres / "main.py"
    lines = _read(main).splitlines(keepends=True)
    lines[s.line] = re.sub(r"^(\s*)#\s*self\.", r"\1self.", lines[s.line], count=1)
    _write(main, "".join(lines))
    return f"{s.name} is back in the talk"


def to_recycle_bin(p: Path) -> bool:
    """Sends a file to the recycle bin (it can be recovered). On Linux, to the trash of the
    desktop; without one the file stays where it is."""
    if os.name != "nt":
        gio = shutil.which("gio")
        return bool(gio) and subprocess.run([gio, "trash", str(p)], capture_output=True).returncode == 0
    import ctypes
    from ctypes import wintypes

    class Operation(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT),
                    ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                    ("fFlags", ctypes.c_uint16), ("fAnyOperationsAborted", wintypes.BOOL),
                    ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR)]

    # FO_DELETE with FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
    op = Operation(None, 3, str(p.resolve()) + "\0", None, 0x40 | 0x10 | 0x04 | 0x400, False, None, None)
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0 and not p.exists()


def _imported_elsewhere(talk: Talk, file: Path) -> bool:
    pattern = re.compile(rf"^\s*(from|import)\s.*\b{re.escape(file.stem)}\b", re.M)
    others = (p for p in _python_files(talk.pres) if p not in (file, talk.pres / INIT))
    return any(pattern.search(p.read_text("utf-8", errors="replace")) for p in others)


def _import_of(tree, alias: str | None):
    """The relative import that brings `alias`."""
    return next((n for n in _relative_imports(tree)
                 if any((a.asname or a.name) == alias for a in n.names)), None)


def _unregister(talk: Talk, method: str) -> Path | None:
    """Removes `slide_x = …` from __init__.py; returns its file if nothing there uses it anymore."""
    init = talk.pres / INIT
    text = _read(init)
    tree = ast.parse(text)
    assignment = _assignment(tree, method)
    if assignment is None:
        return None
    alias = _alias_of(assignment)
    file = _import_aliases(tree, init.parent).get(alias)
    lines = text.splitlines(keepends=True)
    del lines[assignment.lineno - 1:assignment.end_lineno]
    text = "".join(lines)
    tree = ast.parse(text)
    still_used = any(isinstance(n, ast.Name) and n.id == alias for n in ast.walk(tree))
    node = _import_of(tree, alias)
    if alias and not still_used and node is not None:
        text = _edit_import(text, node.module or "", remove=alias)
    _write(init, text)
    if still_used or file is None or file.name == "__init__.py":
        return None
    return file


def _repetitions(talk: Talk, method: str) -> list[str]:
    """The names of the active calls of one slide method, in order: x, x-2, x-3…"""
    return [x.name for x in read_plan(talk) if x.active and x.method == method]


def delete(talk: Talk, s: Slide) -> str:
    """Removes the slide from main.py and deletes its renders. If its method is no longer used, it
    leaves the registry and its file goes to the recycle bin (unless another file imports it)."""
    siblings = _repetitions(talk, s.method)
    main = talk.pres / "main.py"
    lines = _read(main).splitlines(keepends=True)
    del lines[s.line]
    _write(main, "".join(lines))
    if s.active:
        # The repetitions that came after it move up one number: their renders too.
        remaining = [n for n in siblings if n != s.name]
        now = _repetitions(talk, s.method)
        _delete_renders(talk, [s.name])
        _rename_renders(talk, list(zip(remaining, now)))
    if any(x.method == s.method for x in read_plan(talk)):
        return f"{s.name} left the talk, its other repetitions stay"
    return _drop_file(talk, s)


def _drop_file(talk: Talk, s: Slide) -> str:
    """After its last call: the slide leaves the registry and its file goes to the recycle bin,
    unless another file imports it."""
    file = _unregister(talk, s.method)
    if file is None or _imported_elsewhere(talk, file):
        return f"{s.name} was deleted"
    if to_recycle_bin(file):
        return f"{s.name} was deleted, its file is in the recycle bin"
    return f"{s.name} was deleted, but its file could not go to the recycle bin"


def set_resolution(talk: Talk, s: Slide, quality: str | None):
    """The resolution of one slide; None goes back to the talk's."""
    def change(preferred):
        if quality in QUALITIES:
            preferred[s.name] = quality
        else:
            preferred.pop(s.name, None)
    update_json(talk.path("_resolutions.json"), change)


def note(talk: Talk, s: Slide, text: str | None, status: str):
    """status: approved, changes or clear."""
    def change(reviews):
        if status == "clear":
            reviews.pop(s.name, None)
            return
        before = reviews.get(s.name, {})
        reviews[s.name] = {"status": status, "note": text if text is not None
                           else before.get("note", ""), "hash": s.hash,
                           "date": datetime.now().isoformat(timespec="seconds")}
    update_json(talk.path("_reviews.json"), change)


# ───────────────────────────── new talk ─────────────────────────────
# The minimum for the studio to treat it like the others: main.py with construct(), the slides
# registered in diapositivas/__init__.py with _slide, a style and a template.

_NEW_GITIGNORE = """\
# Output generated by Manim / manim-slides
media/
slides/
diapos/

# Exports of the presentation
*.pptx
*.html
*.mp4

# Python
__pycache__/
*.pyc
.venv/
"""

_NEW_PYPROJECT = """\
[project]
name = "{id}"
version = "0.1.0"
description = {description}
requires-python = ">=3.13"
dependencies = [
    # manim 0.22 breaks manim-slides 5.7 (it has no config.write_to_movie)
    "manim>=0.18,<0.22",
    "manim-slides[pyqt6]>=5.1",
    "numpy>=1.26",
]
"""

_NEW_MAIN = """\
from manim import ManimColor
from manim_slides import Slide

from diapositivas import SlideBase, TalkSlides
from style import BACKGROUND


class presentation(TalkSlides, SlideBase, Slide):
    def construct(self):
        self.camera.background_color = ManimColor(BACKGROUND)

        self.slide_title()
        self.slide_closing()
"""

_NEW_STYLE = '''\
"""Colors and font of the talk: change them here and every slide changes."""

BACKGROUND = "#1f1e1d"
TEXT = "#faf9f5"
SECONDARY = "#c2c0b6"
ACCENT = "#d97757"
FONT = "Segoe UI"

TITLE_SIZE = 44
TEXT_SIZE = 28
'''

_NEW_INIT = '''\
from manim import FadeOut

from . import closing, title


class SlideBase:
    def start_slide(self):
        """Before each slide, whatever the previous one left fades out."""
        if self.mobjects:
            self.play(*[FadeOut(m) for m in self.mobjects], run_time=0.5)


def _slide(build):
    def method(self):
        self.start_slide()
        build(self)

    return method


class TalkSlides:
    slide_title = _slide(title.build)
    slide_closing = _slide(closing.build)
'''

_NEW_TITLE = '''\
from manim import BOLD, DOWN, LEFT, RIGHT, UP, FadeIn, GrowFromCenter, Line, Text, VGroup, Write

from style import ACCENT, FONT, SECONDARY, TEXT

TITLE = {title}
SUBTITLE = ""


def build(scene):
    title = Text(TITLE, font=FONT, font_size=60, color=TEXT, weight=BOLD)
    rule = Line(LEFT * 1.2, RIGHT * 1.2, color=ACCENT, stroke_width=6)
    pieces = [title, rule]
    if SUBTITLE:
        pieces.append(Text(SUBTITLE, font=FONT, font_size=30, color=SECONDARY))
    for p in pieces:
        if p.width > 12:
            p.scale_to_fit_width(12)
    VGroup(*pieces).arrange(DOWN, buff=0.45)

    scene.play(Write(title), run_time=1.2)
    scene.play(GrowFromCenter(rule), *[FadeIn(p, shift=UP * 0.15) for p in pieces[2:]],
               run_time=0.8)
    scene.wait(0.3)
    scene.next_slide()
'''

_NEW_CLOSING = '''\
from manim import BOLD, DOWN, UP, FadeIn, Text, VGroup

from style import ACCENT, FONT, TEXT

TITLE = {title}
SUBTITLE = {subtitle}


def build(scene):
    title = Text(TITLE, font=FONT, font_size=72, color=TEXT, weight=BOLD)
    question = Text(SUBTITLE, font=FONT, font_size=34, color=ACCENT)
    VGroup(title, question).arrange(DOWN, buff=0.5)

    scene.play(FadeIn(title, scale=0.9), run_time=0.9)
    scene.play(FadeIn(question, shift=UP * 0.15), run_time=0.6)
    scene.wait(0.3)
    scene.next_slide()
'''

# Used by `new`: “Slide title” becomes the name of the slide.
_NEW_TEMPLATE = '''\
from manim import BOLD, DOWN, LEFT, RIGHT, UL, FadeIn, Line, Text, VGroup

from style import ACCENT, FONT, TEXT, TEXT_SIZE, TITLE_SIZE

TITLE = "Slide title"
POINTS = [
    "First idea",
    "Second idea",
    "Third idea",
]


def build(scene):
    title = Text(TITLE, font=FONT, font_size=TITLE_SIZE, color=TEXT, weight=BOLD)
    title.to_corner(UL, buff=0.8)
    rows = VGroup()
    for point in POINTS:
        mark = Line(LEFT * 0.15, RIGHT * 0.15, color=ACCENT, stroke_width=5)
        text = Text(point, font=FONT, font_size=TEXT_SIZE, color=TEXT)
        rows.add(VGroup(mark, text).arrange(RIGHT, buff=0.3))
    rows.arrange(DOWN, aligned_edge=LEFT, buff=0.45)
    rows.next_to(title, DOWN, buff=0.8, aligned_edge=LEFT)

    scene.play(FadeIn(title, shift=DOWN * 0.2), run_time=0.7)
    for row in rows:
        scene.play(FadeIn(row, shift=RIGHT * 0.2), run_time=0.35)
    scene.wait(0.3)
    scene.next_slide()
'''


def talk_folder(title: str) -> str:
    """“Charla: Docker from scratch” → charla-docker-from-scratch."""
    plain = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    short = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-").removeprefix(TALK_PREFIX)
    if len(short) > 40:
        short = short[:40].rsplit("-", 1)[0]
    if not short:
        raise RuntimeError("The title needs at least one letter or number")
    return f"{TALK_PREFIX}{short}"


# The presenter keys of the other talks: → and ↓ next, ← and ↑ back, F full screen, Q quit.
_NEW_PRESENTER_KEYS = """\
[keys.QUIT]
name = 'QUIT'
ids = [81]

[keys.PLAY_PAUSE]
name = 'PLAY / PAUSE'
ids = [32]

[keys.NEXT]
name = 'NEXT'
ids = [
    16777236,
    16777239,
]

[keys.PREVIOUS]
name = 'PREVIOUS'
ids = [
    16777234,
    16777238,
]

[keys.REVERSE]
name = 'REVERSE'
ids = [86]

[keys.REPLAY]
name = 'REPLAY'
ids = [82]

[keys.FULL_SCREEN]
name = 'TOGGLE FULL SCREEN'
ids = [70]

[keys.HIDE_MOUSE]
name = 'HIDE / SHOW MOUSE'
ids = [72]
"""

_CLOSING_WORDS = {"es": ("Gracias", "¿Preguntas?"), "en": ("Thank you", "Questions?")}
_BAD_IN_NAMES = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_NAMES = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                   *(f"lpt{i}" for i in range(1, 10))}


def _folder_name(text: str) -> str:
    name = " ".join(text.split())
    if (not name or name in (".", "..") or _BAD_IN_NAMES.search(name) or name.endswith(".")
            or name.split(".")[0].lower() in _RESERVED_NAMES or len(name) > 100):
        raise RuntimeError("That folder name can't be used, try letters, numbers and dashes")
    return name


def new_talk(title: str, about: str = "", language: str = "es",
             where: Path | None = None, folder: str | None = None) -> Talk:
    """Creates <where>/<folder> (the talks folder and charla-<title> by default) with a title slide
    and a closing slide, ready to render and grow. Everything goes in that one folder, and the
    Studio adds it to its list. The folder may already exist if it is empty."""
    title, about = " ".join(title.split()), about.strip()
    if not LANGUAGE.fullmatch(language):
        raise RuntimeError("The language is a code like es or en")
    where = ROOT if where is None else Path(where)
    if not where.is_absolute() or not where.is_dir():
        raise RuntimeError("That place does not exist, choose another folder")
    name = _folder_name(folder) if folder else talk_folder(title)
    if not re.search(r"[A-Za-z0-9]", unicodedata.normalize("NFKD", title)):
        raise RuntimeError("The title needs at least one letter or number")
    root = where / name
    existed = root.exists()
    if existed and not (root.is_dir() and not any(root.iterdir())):
        raise RuntimeError(f"There is already a folder called {name} there, choose another name")
    _write_new_talk(root, _new_talk_files(name, title, about, language), existed)
    return register(root)


def _new_talk_files(name: str, title: str, about: str, language: str) -> dict:
    """The files of a new talk: {path inside its folder: text}."""
    readme = [f"# {title}", ""] + ([about, ""] if about else [])
    thanks, questions = _CLOSING_WORDS.get(language.split("-")[0], _CLOSING_WORDS["en"])
    project = {**PROJECT_FIELDS, "title": title, "about": about, "language": language}
    return {
        PROJECT_FILE: json.dumps({"manimrs": 1, **project}, ensure_ascii=False, indent=2) + "\n",
        "README.md": "\n".join(readme + [
            "Animated presentation with Manim Slides, made with ManimRS Studio. What the talk is",
            f"(title, what it is about, language and resolution) is in `{PROJECT_FILE}`.", ""]),
        ".gitignore": _NEW_GITIGNORE,
        ".manim-slides.toml": _NEW_PRESENTER_KEYS,
        "pyproject.toml": _NEW_PYPROJECT.format(
            id=_slug(name), description=json.dumps(f"{title}: presentation with Manim Slides",
                                                   ensure_ascii=False)),
        ".python-version": "3.13\n",
        "main.py": _NEW_MAIN,
        "style.py": _NEW_STYLE,
        f"{SLIDES_PACKAGE}/__init__.py": _NEW_INIT,
        f"{SLIDES_PACKAGE}/_template.py": _NEW_TEMPLATE,
        f"{SLIDES_PACKAGE}/title.py": _NEW_TITLE.format(title=repr(title)),
        f"{SLIDES_PACKAGE}/closing.py": _NEW_CLOSING.format(title=repr(thanks),
                                                            subtitle=repr(questions)),
    }


def _write_new_talk(root: Path, files: dict, existed: bool):
    """Writes every file, or none: if one fails, what was written goes."""
    try:
        for rel, text in files.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            _write(p, text)
    except Exception:
        if not existed:
            shutil.rmtree(root, ignore_errors=True)
            raise
        for p in root.iterdir():  # it was empty: everything in it is ours
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
        raise


# ───────────────────────────── panel ─────────────────────────────

class Jobs:
    """Queue of long jobs (renders and exports), one at a time."""

    def __init__(self):
        self.items: list[dict] = []
        self.lock = threading.Lock()
        self.ready = threading.Condition(self.lock)
        threading.Thread(target=self._loop, daemon=True).start()

    def add(self, talk: str, title: str, fn) -> dict:
        with self.lock:
            j = {"id": len(self.items) + 1, "talk": talk, "title": title, "status": "queued",
                 "log": deque(maxlen=400), "fn": fn, "proc": None, "started": None, "ended": None,
                 "result": None}
            self.items.append(j)
            self.ready.notify()
            return j

    def cancel(self, job_id: int):
        with self.lock:
            j = next((j for j in self.items if j["id"] == job_id), None)
        if not j:
            return
        if j["status"] == "queued":
            j["status"] = "cancelled"
        elif j["status"] == "running" and j["proc"] and j["proc"].poll() is None:
            j["log"].append("Cancelling…")
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(j["proc"].pid)],
                               capture_output=True)
            else:
                import signal
                with suppress(ProcessLookupError):
                    os.killpg(j["proc"].pid, signal.SIGKILL)

    def _loop(self):
        while True:
            with self.lock:
                while not (j := next((j for j in self.items if j["status"] == "queued"), None)):
                    self.ready.wait()
                j["status"], j["started"] = "running", time.time()
            try:
                j["result"] = j["fn"](j["log"].append, lambda p: j.__setitem__("proc", p))
                j["status"] = "ok"
            except Exception as e:  # noqa: BLE001 — any failure is shown in the panel
                j["log"].append(f"Error: {e}")
                j["status"] = "cancelled" if "Cancelling…" in j["log"] else "error"
            j["ended"] = time.time()

    def summary(self) -> list[dict]:
        with self.lock:
            return [{k: (list(v) if k == "log" else v) for k, v in j.items()
                     if k not in ("fn", "proc")} for j in self.items[-12:]]


JOBS: Jobs | None = None


def _open(path: Path):
    if os.name == "nt":
        os.startfile(path)  # noqa: S606
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])


def _open_in_editor(path: Path):
    code = shutil.which("code")
    if code:
        subprocess.Popen([code, "-g", str(path)])
    else:
        _open(path)


class Panel:
    """The panel's answers. panel_handler() joins it with BaseHTTPRequestHandler."""

    def log_message(self, *_):
        pass

    def end_headers(self):
        # No other page can show the panel inside a frame (and trick a click on its buttons), the
        # browser never guesses the type of a file, and the page loads nothing from anywhere else.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", PANEL_POLICY)
        super().end_headers()

    def _allowed(self) -> bool:
        """Only the panel's own page, on this computer. A web page open in the browser could send
        it orders (it comes from another Origin) or reach it through a DNS trick (another Host)."""
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "").lower() not in hosts:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.lower() in {f"http://{h}" for h in hosts}

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, p: Path):
        size = p.stat().st_size
        part = byte_range(self.headers.get("Range", ""), size)
        first, last = part or (0, size - 1)
        if part and (first > last or first >= size):
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if part:
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
        else:
            self.send_response(200)
        import mimetypes
        self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(last - first + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(p, "rb") as f:
            f.seek(first)
            left = last - first + 1
            while left > 0 and (chunk := f.read(min(1 << 16, left))):
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_GET(self):
        if not self._allowed():
            return self.send_error(403)
        url = urlparse(self.path)
        try:
            self._get(url.path, {k: v[0] for k, v in parse_qs(url.query).items()})
        except (ConnectionError, BrokenPipeError):
            pass
        except (SystemExit, KeyError, ValueError, OSError) as e:
            self._json({"error": str(e)}, 404)

    def _get(self, path: str, q: dict):
        if path == "/":
            return self._file(PANEL)
        if path == "/api/talks":
            return self._json([{"id": t.id, "title": t.title} for t in talks()])
        if path == "/api/status":
            data = status_with_media(find_talk(q["talk"]))
            data["jobs"] = JOBS.summary()
            return self._json(data)
        if path.startswith("/file/"):
            _, _, talk_id, rest = path.split("/", 3)
            talk = find_talk(talk_id)
            p = (talk.renders / unquote(rest)).resolve()
            if talk.renders.resolve() in p.parents and p.is_file():
                return self._file(p)
        self.send_error(404)

    def do_POST(self):
        json_body = self.headers.get("Content-Type", "").startswith("application/json")
        if not self._allowed() or not json_body:
            return self.send_error(403)
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 <= length <= 1 << 20:
                raise ValueError("too big")
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("not an object")
        except ValueError:
            return self._json({"error": "That request is not valid"}, 400)
        try:
            self._json(self._action(urlparse(self.path).path, data))
        except (SystemExit, RuntimeError, KeyError, IndexError, ValueError, TypeError) as e:
            self._json({"error": str(e)}, 400)

    def _action(self, route: str, d: dict):
        if route == "/api/cancel":
            JOBS.cancel(int(d["id"]))
            return {"ok": True}
        talk = find_talk(d["talk"])
        plan = read_plan(talk)
        if route not in PANEL_ACTIONS:
            raise KeyError(f"unknown action: {route}")
        PANEL_ACTIONS[route](talk, plan, d)
        return {"ok": True}


# The panel's page carries its own script and style and talks only to this server.
PANEL_POLICY = ("default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                "img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; "
                "form-action 'none'; frame-ancestors 'none'")


def panel_handler() -> type:
    """The class that answers the panel's requests."""
    from http.server import BaseHTTPRequestHandler
    return type("PanelHandler", (Panel, BaseHTTPRequestHandler), {})


def byte_range(header: str, size: int) -> tuple[int, int] | None:
    """(first, last) byte that a Range header asks for, or None without one. The caller refuses a
    range that starts after the end."""
    wanted = re.match(r"bytes=(\d*)-(\d*)$", header)
    if not (wanted and (wanted[1] or wanted[2])):
        return None
    if not wanted[1]:
        return max(0, size - int(wanted[2])), size - 1
    return int(wanted[1]), (min(int(wanted[2]), size - 1) if wanted[2] else size - 1)


def _panel_render(talk: Talk, plan: list[Slide], d: dict):
    quality = d.get("quality") or talk.resolution
    targets = targets_of(talk, plan, d["what"])
    title = (f"Render of {targets[0].name}" if len(targets) == 1
             else f"Render of {len(targets)} slides") + f" ({quality})"
    JOBS.add(talk.id, title, lambda log, on_start: render(talk, targets, quality, log, on_start))


def _panel_export(talk: Talk, plan: list[Slide], d: dict):
    fmt = d.get("format", "html")
    JOBS.add(talk.id, f"Export {talk.id} ({fmt.upper()})",
             lambda log, on_start: str(export(talk, fmt, log)))


def _panel_open(talk: Talk, plan: list[Slide], d: dict):
    if d.get("what") != "exported":
        return _open_in_editor(talk.pres / resolve(talk, plan, [d["name"]])[0].file)
    folder = talk.path("exported")
    folder.mkdir(parents=True, exist_ok=True)
    _open(folder)


PANEL_ACTIONS = {
    "/api/render": _panel_render,
    "/api/export": _panel_export,
    "/api/present": lambda talk, plan, d: present(talk, d.get("start"), wait=False, log=lambda _: None),
    "/api/review": lambda talk, plan, d: note(talk, resolve(talk, plan, [d["name"]])[0],
                                              d.get("note"), d["status"]),
    "/api/open": _panel_open,
}


def status_by_name(talk: Talk) -> dict[str, str]:
    return {r["name"]: r["status"] for r in talk_status(talk)["slides"] if r["active"]}


def open_panel(port=PORT, browser=True):
    global JOBS
    import webbrowser
    from http.server import ThreadingHTTPServer
    url = f"http://127.0.0.1:{port}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), panel_handler())
    except OSError:
        print(f"The panel is already open at {url}")
        if browser:
            webbrowser.open(url)
        return
    JOBS = Jobs()
    print(f"Slide panel at {url}  (Ctrl+C closes it)")
    if browser:
        threading.Timer(0.6, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Panel closed.")


# ───────────────────────────── command line ─────────────────────────────

def print_list(talk: Talk):
    rows = talk_status(talk)["slides"]
    count = Counter(r["status"] for r in rows)
    summary = ", ".join(f"{n} {LABELS[s]}" for s, n in count.most_common())
    print(f"{talk.id}: {sum(r['active'] for r in rows)} slides, {summary}")
    print(f"  folder {talk.pres} (the files below are inside it, what the talk is in {PROJECT_FILE})")
    group = None
    for r in rows:
        if r["group"] != group:
            group = r["group"]
            print(f"\n  {group}" if group else "")
        pos = f"{r['pos']:>3}" if r["pos"] else "  -"
        review = {"approved": "✓ approved", "changes": "✎ changes requested",
                  "to_review": "to review"}.get(r["review"].get("status", ""), "")
        print(f"  {pos}  {r['name']:<24} {r['label']:<22} {r['quality'] or '':<6} "
              f"{review:<20} {r['file']}")


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] == "panel":
        return open_panel(browser="--no-browser" not in argv)
    if argv[0] in ("-h", "--help", "help"):
        return print(__doc__)
    if argv[0] in TALKS_COMMANDS:
        return TALKS_COMMANDS[argv[0]](argv[1:])
    talk = find_talk(argv[0])
    try:
        _talk_command(talk, argv[1] if len(argv) > 1 else "list", argv[2:])
    except RuntimeError as e:
        raise SystemExit(f"Error: {e}") from None


def _talk_command(talk: Talk, command: str, args: list[str]):
    if command == "info":
        return _cmd_info(talk, args)
    if command == "forget":
        return print(forget(talk))
    execute(talk, command, _talk_parser(talk, command).parse_args(args), read_plan(talk))


def _talk_parser(talk: Talk, command: str) -> argparse.ArgumentParser:
    """The options of the commands about one talk (all share them)."""
    p = argparse.ArgumentParser(prog=f"studio {talk.id} {command}")
    p.add_argument("slides", nargs="*")
    p.add_argument("--quality", choices=QUALITIES, help="the talk's resolution by default")
    p.add_argument("--pending", action="store_true")
    p.add_argument("--all", action="store_true")
    p.add_argument("--pdf", action="store_true")
    p.add_argument("--mp4", action="store_true", help="one video of the talk, or of one slide")
    p.add_argument("--gif", action="store_true", help="a GIF of one slide")
    p.add_argument("--approve", action="store_true")
    p.add_argument("--clear", action="store_true")
    p.add_argument("--json", action="store_true")
    p.add_argument("--width", type=int)
    p.add_argument("--after")
    p.add_argument("--first", action="store_true")
    p.add_argument("--line", type=int, help="the line in main.py (works for commented-out slides)")
    return p


def _cmd_talks(args: list[str]):
    everything = talks()
    for t in everything:
        migrate(t)
        ensure_project(t)
    found = [{"id": t.id, "title": t.title, "path": str(t.pres)} for t in everything]
    if "--json" in args:
        return print(json.dumps(found, ensure_ascii=False))
    if not found:
        return print("No talks yet: make one with new-talk or add one with open <folder>")
    return print("\n".join(f"{t['id']:<26} {t['title']}\n{'':<26} {t['path']}" for t in found))


def _cmd_open(args: list[str]):
    p = argparse.ArgumentParser(prog="studio open")
    p.add_argument("folder")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(args)
    try:
        talk = open_talk(Path(a.folder))
    except RuntimeError as e:
        raise SystemExit(f"Error: {e}") from None
    return _print_talk(talk, a.json, f"{talk.id} is on the list")


def _cmd_new_talk(args: list[str]):
    p = argparse.ArgumentParser(prog="studio new-talk")
    p.add_argument("title", nargs="+")
    p.add_argument("--about", default="")
    p.add_argument("--language", default="es")
    p.add_argument("--in", dest="where", help="the folder that will hold it (the talks folder by default)")
    p.add_argument("--folder", help="the name of its folder (charla-<title> by default)")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(args)
    try:
        talk = new_talk(" ".join(a.title), a.about, a.language,
                        Path(a.where) if a.where else None, a.folder)
    except (RuntimeError, OSError) as e:
        raise SystemExit(f"Error: {e}") from None
    return _print_talk(talk, a.json, f"Created {talk.id} with a title slide and a closing slide")


TALKS_COMMANDS = {"talks": _cmd_talks, "open": _cmd_open, "new-talk": _cmd_new_talk}


def execute(talk: Talk, command: str, a, plan: list[Slide]):
    """Runs a command about one talk and prints what it answers."""
    if command not in COMMANDS:
        raise SystemExit(f"Unknown command “{command}”.\n{__doc__}")
    answer = COMMANDS[command](talk, a, plan)
    if answer is not None:
        print(answer)


def _print_talk(talk: Talk, as_json: bool, text: str):
    if as_json:
        return print(json.dumps({"id": talk.id, "title": talk.title, "path": str(talk.pres)},
                                ensure_ascii=False))
    print(f"{text}: {talk.title}\n  folder {talk.pres}")


def _cmd_info(talk: Talk, args: list[str]):
    """Shows talk.manimrs, or changes the fields given (`--title "…"`, `--resolution 720p`…)."""
    p = argparse.ArgumentParser(prog=f"studio {talk.id} info")
    for field in PROJECT_FIELDS:
        p.add_argument(f"--{field}")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(args)
    changes = {k: getattr(a, k) for k in PROJECT_FIELDS if getattr(a, k) is not None}
    info = save_project(talk, changes) if changes else project_info(talk)
    if a.json:
        return print(json.dumps({"id": talk.id, "path": str(talk.pres), **info}, ensure_ascii=False))
    print(f"{talk.id}, in {talk.pres / PROJECT_FILE}")
    for k, v in info.items():
        print(f"  {k:<11} {v}")


def _one(talk: Talk, a, plan: list[Slide]) -> Slide:
    """The slide of the command: by --line (also the commented-out ones) or by name or number."""
    if a.line is not None:
        s = next((s for s in plan if s.line == a.line), None)
        if s is None:
            raise RuntimeError("The talk changed, try again")
        return s
    if not a.slides:
        raise SystemExit("Tell me which slide")
    return resolve(talk, plan, a.slides[:1])[0]


def _cmd_new(talk, a, plan):
    if not a.slides:
        raise SystemExit('Tell me the name: new "git stash" [--after <slide>]')
    after = resolve(talk, plan, [a.after])[0] if a.after else None
    s = new_slide(talk, " ".join(a.slides), after)
    if a.json:
        return json.dumps({"name": s.name, "file": s.file, "pos": s.pos}, ensure_ascii=False)
    return f"Created {s.name} at position {s.pos} ({s.file})"


def _cmd_move(talk, a, plan):
    after = None if a.first else resolve(talk, plan, [a.after])[0] if a.after else None
    if after is None and not a.first:
        raise SystemExit("Tell me where: --after <slide> or --first")
    return move(talk, _one(talk, a, plan), after)


def _cmd_rename(talk, a, plan):
    if a.line is None and len(a.slides) < 2:
        raise SystemExit('Usage: rename <slide> "new name"')
    new = a.slides[1:] if a.line is None else a.slides
    return rename(talk, _one(talk, a, plan), " ".join(new))


def _cmd_restore(talk, a, plan):
    if a.line is not None:
        s = next((s for s in plan if s.line == a.line), None)
    else:
        s = next((s for s in plan if not s.active and a.slides and s.name == a.slides[0]), None)
    if s is None:
        raise RuntimeError("That slide is not commented out")
    return restore(talk, s)


def _cmd_resolution(talk, a, plan):
    s = _one(talk, a, plan)
    asked = (a.slides[1:] if a.line is None else a.slides)[:1]
    value = asked[0] if asked and asked[0] in QUALITIES else None
    set_resolution(talk, s, value)
    return f"{s.name}: " + (value or "the talk's resolution")


def _cmd_place(talk, a, plan):
    if not a.slides:
        raise SystemExit("Tell me which method to place: place slide_x [--after <slide>]")
    after = resolve(talk, plan, [a.after])[0] if a.after else None
    return place(talk, a.slides[0], after)


def _cmd_render(talk, a, plan):
    if not (a.all or a.pending or a.slides):
        raise SystemExit("Tell me what to render: names or numbers, --pending or --all.")
    what = "all" if a.all else "pending" if a.pending else a.slides
    render(talk, targets_of(talk, plan, what), a.quality or talk.resolution)


def _cmd_present(talk, a, plan):
    present(talk, resolve(talk, plan, a.slides[:1])[0].name if a.slides else None)


def _cmd_duplicate(talk, a, plan):
    name = " ".join(a.slides if a.line is not None else a.slides[1:]) or None
    s = duplicate(talk, _one(talk, a, plan), name)
    if a.json:
        return json.dumps({"name": s.name, "file": s.file, "pos": s.pos}, ensure_ascii=False)
    return f"Created {s.name} at position {s.pos} ({s.file})"


def _cmd_export(talk, a, plan):
    fmt = "pdf" if a.pdf else "mp4" if a.mp4 else "gif" if a.gif else "html"
    only = resolve(talk, plan, a.slides[:1])[0].name if a.slides else None
    export(talk, fmt, only=only)


def _cmd_stills(talk, a, plan):
    for s in resolve(talk, plan, a.slides):
        stills(talk, s, width=a.width)


def _cmd_note(talk, a, plan):
    s = resolve(talk, plan, a.slides[:1])[0]
    if a.clear:
        note(talk, s, None, "clear")
        return f"Cleared the review of {s.name}."
    if a.approve:
        note(talk, s, " ".join(a.slides[1:]) or None, "approved")
        return f"{s.name} approved."
    note(talk, s, " ".join(a.slides[1:]), "changes")
    return f"Noted the change for {s.name}."


# Each one takes (talk, arguments, plan) and returns the text to print, or None.
COMMANDS = {
    "list": lambda talk, a, plan: print_list(talk),
    "status": lambda talk, a, plan: json.dumps(status_with_media(talk), ensure_ascii=False),
    "place": _cmd_place,
    "render": _cmd_render,
    "present": _cmd_present,
    "export": _cmd_export,
    "stills": _cmd_stills,
    "notes": lambda talk, a, plan: print_notes(talk),
    "note": _cmd_note,
    "new": _cmd_new,
    "move": _cmd_move,
    "rename": _cmd_rename,
    "duplicate": _cmd_duplicate,
    "restore": _cmd_restore,
    "delete": lambda talk, a, plan: delete(talk, _one(talk, a, plan)),
    "resolution": _cmd_resolution,
}


def print_notes(talk: Talk):
    pending = [r for r in talk_status(talk)["slides"] if r["review"].get("status") == "changes"]
    if not pending:
        return print(f"{talk.id}: no changes requested.")
    print(f"{talk.id}: {len(pending)} slide(s) with changes requested, files inside {talk.pres}\n")
    for r in pending:
        print(f"- {r['pos']}. {r['name']}  ({r['file']})\n  {r['review']['note']}\n")


if __name__ == "__main__":
    main()

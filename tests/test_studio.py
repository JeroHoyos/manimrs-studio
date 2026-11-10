"""Tests of the engine (engine/studio.py) on a talk made in a temporary folder.

They do not need manim: a render is faked with the files a real one leaves.
Run them from the repository root with `uv run pytest`.
"""

import json
import os
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zlib
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import studio  # noqa: E402


@pytest.fixture
def talk(tmp_path, monkeypatch):
    monkeypatch.setattr(studio, "ROOT", tmp_path)
    monkeypatch.setattr(studio, "REGISTRY", tmp_path / "talks.json")
    monkeypatch.setattr(studio, "REGISTRY_LOCK", tmp_path / ".talks.lock")
    monkeypatch.setattr(studio, "to_recycle_bin", lambda p: p.unlink() or True)
    return studio.new_talk("Docker from scratch", language="en")


def names(talk):
    return [s.name for s in studio.read_plan(talk) if s.active]


def slide(talk, name):
    return next(s for s in studio.read_plan(talk) if s.name == name)


def statuses(talk):
    return {r["name"]: r["status"] for r in studio.talk_status(talk)["slides"]}


def fake_render(talk, *which, quality="1080p"):
    """Leaves what a render leaves: <name>.json, its video and its line in _renders.json."""
    plan = studio.read_plan(talk)
    done = [s for s in plan if s.active and (not which or s.name in which)]
    for s in done:
        video = talk.path(f"files/{s.name}/0.mp4")
        video.parent.mkdir(parents=True, exist_ok=True)
        video.write_bytes(b"video")
        studio.write_json(talk.path(f"{s.name}.json"),
                          {"slides": [{"file": f"diapos\\files\\{s.name}\\0.mp4"}]})
    studio._record(talk, done, studio.shared_fingerprint(talk, plan), quality)


def comment_out(talk, name):
    main = talk.pres / "main.py"
    s = slide(talk, name)
    lines = main.read_text("utf-8").splitlines(keepends=True)
    lines[s.line] = lines[s.line].replace("self.", "# self.", 1)
    main.write_text("".join(lines), "utf-8")


# ───────────────────────────── talks ─────────────────────────────

def test_new_talk(talk):
    assert talk.id == "charla-docker-from-scratch"
    assert names(talk) == ["title", "closing"]
    info = studio.project_info(talk)
    assert (info["title"], info["language"]) == ("Docker from scratch", "en")
    assert "Thank you" in (talk.pres / "diapositivas" / "closing.py").read_text("utf-8")
    assert [t.id for t in studio.talks()] == [talk.id]


def test_new_talk_refuses_bad_input(talk):
    with pytest.raises(RuntimeError, match="language"):
        studio.new_talk("Other", language="spanish")
    with pytest.raises(RuntimeError, match="letter or number"):
        studio.new_talk("¿?")
    with pytest.raises(RuntimeError, match="already a folder"):
        studio.new_talk("Docker from scratch")
    with pytest.raises(RuntimeError, match="folder name"):
        studio.new_talk("Other", folder="con")


def test_register_gives_unique_ids(talk, tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    first = studio.new_talk("Same", where=tmp_path / "a")
    second = studio.new_talk("Same", where=tmp_path / "b")
    assert (first.id, second.id) == ("charla-same", "charla-same-2")
    assert studio.register(second.pres).id == "charla-same-2"
    assert studio.open_talk(second.pres).id == "charla-same-2"
    studio.forget(first)
    assert "charla-same" not in [t.id for t in studio.talks()]
    assert studio.find_talk("docker-from-scratch").id == talk.id
    with pytest.raises(SystemExit, match="no talk called"):
        studio.find_talk("nope")


def test_save_project(talk):
    (talk.pres / "talk.manimrs").write_text(
        json.dumps({**studio.project_info(talk), "mine": 1}), "utf-8")
    info = studio.save_project(talk, {"title": "  New   title ", "resolution": "720p"})
    assert (info["title"], info["resolution"]) == ("New title", "720p")
    assert json.loads((talk.pres / "talk.manimrs").read_text("utf-8"))["mine"] == 1
    for bad in ({"resolution": "4k"}, {"title": " "}, {"language": "spanish"}, {"colour": "red"}):
        with pytest.raises(RuntimeError):
            studio.save_project(talk, bad)


def test_readme_about():
    lines = ["# Title", "", "> a quote", "First line of **about**", "with [a link](http://x).", "",
             "Second paragraph"]
    assert studio._readme_about(lines) == "First line of about with a link."
    assert studio._readme_about(["# Only a title"]) == ""


def test_migrate_converts_the_spanish_files(talk):
    studio.write_json(talk.path("_registro.json"), {"x": {"metodo": "slide_x", "calidad": "alta"}})
    studio.write_json(talk.path("_revision.json"), {"x": {"estado": "aprobada", "nota": "ok"}})
    studio.write_json(talk.path("_calidades.json"), {"x": "baja"})
    talk.path("_miniaturas").mkdir()
    studio.migrate(talk)
    assert studio.read_json(talk.path("_renders.json"), {})["x"]["quality"] == "1080p"
    assert studio.read_json(talk.path("_reviews.json"), {})["x"]["status"] == "approved"
    assert studio.read_json(talk.path("_resolutions.json"), {}) == {"x": "480p"}
    assert talk.path("_thumbnails").is_dir() and not talk.path("_miniaturas").exists()
    assert not talk.path("_registro.json").exists()


# ───────────────────────────── plan and status ─────────────────────────────

def test_plan_groups_and_repetitions(talk):
    main = talk.pres / "main.py"
    main.write_text(main.read_text("utf-8").replace("        self.slide_title()",
                                                    "        # Part one\n        self.slide_title()"),
                    "utf-8")
    studio.place(talk, "title", slide(talk, "closing"))
    plan = studio.read_plan(talk)
    assert [(s.name, s.pos, s.group) for s in plan] == [
        ("title", 1, "Part one"), ("closing", 2, "Part one"), ("title-2", 3, "Part one")]
    assert (plan[1].previous, plan[2].previous) == ("title", "closing")
    assert studio.file_map(talk.pres)["slide_title"].name == "title.py"


def test_status_kinds(talk):
    assert statuses(talk) == {"title": "new", "closing": "new"}
    fake_render(talk)
    assert statuses(talk) == {"title": "up_to_date", "closing": "up_to_date"}
    studio.set_resolution(talk, slide(talk, "closing"), "480p")
    assert statuses(talk)["closing"] == "resolution"
    studio.set_resolution(talk, slide(talk, "closing"), None)
    title = talk.pres / "diapositivas" / "title.py"
    title.write_text(title.read_text("utf-8") + "\n", "utf-8")
    assert statuses(talk) == {"title": "changed", "closing": "transition"}
    fake_render(talk)
    (talk.pres / "style.py").write_text("ACCENT = 1\n", "utf-8")
    assert statuses(talk) == {"title": "shared", "closing": "shared"}
    comment_out(talk, "closing")
    assert statuses(talk)["closing"] == "out"


def test_render_at_another_resolution_than_the_talk_is_pending(talk):
    fake_render(talk, quality="480p")
    assert statuses(talk) == {"title": "resolution", "closing": "resolution"}
    studio.save_project(talk, {"resolution": "480p"})
    assert statuses(talk) == {"title": "up_to_date", "closing": "up_to_date"}
    studio.set_resolution(talk, slide(talk, "title"), "1080p")
    assert statuses(talk) == {"title": "resolution", "closing": "up_to_date"}
    pending = [s.name for s in studio.targets_of(talk, studio.read_plan(talk), "pending")]
    assert pending == ["title"]


def test_approval_needs_the_same_code(talk):
    s = slide(talk, "title")
    studio.note(talk, s, None, "approved")
    review = lambda: studio.talk_status(talk)["slides"][0]["review"]["status"]  # noqa: E731
    assert review() == "approved"
    title = talk.pres / "diapositivas" / "title.py"
    title.write_text(title.read_text("utf-8") + "\n", "utf-8")
    assert review() == "to_review"


def test_status_with_media(talk):
    fake_render(talk, "title")
    rows = studio.status_with_media(talk)["slides"]
    assert rows[0]["parts"][0]["url"].startswith(f"/file/{talk.id}/files/title/0.mp4?v=")
    assert rows[1]["parts"] == []


def test_resolve(talk):
    plan = studio.read_plan(talk)
    pick = lambda *texts: [s.name for s in studio.resolve(talk, plan, list(texts))]  # noqa: E731
    assert pick("2", "title", "slide_title", "closing") == ["closing", "title"]
    with pytest.raises(SystemExit, match="did you mean closing"):
        pick("clos")
    with pytest.raises(SystemExit, match="no slide “nope”"):
        pick("nope")
    comment_out(talk, "closing")
    with pytest.raises(SystemExit, match="restore it first"):
        studio.resolve(talk, studio.read_plan(talk), ["closing"])


# ───────────────────────────── editing ─────────────────────────────

def test_edit_import():
    text = "from manim import X\nfrom . import a, c\n\nY = 1\n"
    assert studio._edit_import(text, "", add="b") == "from manim import X\nfrom . import a, b, c\n\nY = 1\n"
    assert studio._edit_import(text, "", remove="a") == "from manim import X\nfrom . import c\n\nY = 1\n"
    assert studio._edit_import(text, "sub", add="z") == (
        "from manim import X\nfrom . import a, c\nfrom .sub import z\n\nY = 1\n")
    one = "from . import a\nY = 1\n"
    assert studio._edit_import(one, "", remove="a") == "Y = 1\n"
    long = [f"name_number_{i}" for i in range(8)]
    out = studio._edit_import(f"from . import {', '.join(long[:-1])}\r\n", "", add=long[-1])
    assert out.startswith("from . import (\r\n    name_number_0,\r\n") and out.endswith(")\r\n")


def test_new_slide(talk):
    s = studio.new_slide(talk, "Git stash, how", slide(talk, "title"))
    assert (s.name, s.pos, s.file) == ("git_stash_how", 2, "diapositivas/git_stash_how.py")
    assert names(talk) == ["title", "git_stash_how", "closing"]
    init = (talk.pres / "diapositivas" / "__init__.py").read_text("utf-8")
    assert "from . import closing, git_stash_how, title" in init
    assert "slide_git_stash_how = _slide(git_stash_how.build)" in init
    assert '"Git stash how"' in (talk.pres / s.file).read_text("utf-8")
    with pytest.raises(RuntimeError, match="already a slide"):
        studio.new_slide(talk, "git stash how", None)


def test_new_slide_keeps_windows_line_endings(talk):
    main = talk.pres / "main.py"
    main.write_bytes(main.read_bytes().replace(b"\n", b"\r\n"))
    studio.new_slide(talk, "Extra", None)
    text = main.read_bytes()
    assert b"self.slide_extra()\r\n" in text and text.count(b"\n") == text.count(b"\r\n")
    assert names(talk) == ["title", "closing", "extra"]


def test_duplicate_copies_the_code_and_goes_after_the_slide(talk):
    studio.new_slide(talk, "volumes", slide(talk, "title"))
    source = talk.pres / "diapositivas" / "volumes.py"
    source.write_text(source.read_text("utf-8") + "# mine", "utf-8")
    copy = studio.duplicate(talk, slide(talk, "volumes"))
    assert names(talk) == ["title", "volumes", "volumes_copy", "closing"]
    assert (talk.pres / copy.file).read_text("utf-8").endswith("# mine")
    assert studio.duplicate(talk, slide(talk, "volumes")).name == "volumes_copy_2"
    assert studio.duplicate(talk, slide(talk, "title"), "Second title").name == "second_title"


def test_export_of_a_video_names_the_videos_in_order(talk, tmp_path):
    fake_render(talk)
    listing = studio._video_list(talk, ["title", "closing"], tmp_path).read_text("utf-8")
    assert [line.rsplit("/", 2)[1] for line in listing.splitlines()] == ["title", "closing"]
    assert "-loop" in studio._video_filter(talk, "gif")
    assert "scale=1920:1080" in studio._video_filter(talk, "mp4")[1]


def test_export_refuses_what_it_cannot_make(talk):
    fake_render(talk, "title")
    with pytest.raises(RuntimeError, match="one slide"):
        studio.export(talk, "gif", log=lambda *_: None)
    with pytest.raises(RuntimeError, match="MP4 or GIF"):
        studio.export(talk, "pdf", log=lambda *_: None, only="title")
    with pytest.raises(RuntimeError, match="not rendered"):
        studio.export(talk, "mp4", log=lambda *_: None, only="closing")


def test_move(talk):
    studio.new_slide(talk, "middle", slide(talk, "title"))
    studio.move(talk, slide(talk, "closing"), None)
    assert names(talk) == ["closing", "title", "middle"]
    studio.move(talk, slide(talk, "closing"), slide(talk, "middle"))
    assert names(talk) == ["title", "middle", "closing"]
    assert studio.move(talk, slide(talk, "title"), slide(talk, "title")) == "It is already there"


def test_rename_keeps_the_renders(talk):
    fake_render(talk)
    title = slide(talk, "title")
    studio.note(talk, title, "bigger", "changes")
    studio.set_resolution(talk, title, "720p")
    studio.rename(talk, title, "Opening")
    assert names(talk) == ["opening", "closing"]
    assert not talk.path("title.json").exists()
    assert talk.path("files/opening/0.mp4").exists()
    files = studio.read_json(talk.path("opening.json"), {})["slides"][0]["file"]
    assert files == "diapos\\files\\opening\\0.mp4"
    renders = studio.read_json(talk.path("_renders.json"), {})
    assert renders["opening"]["method"] == "slide_opening"
    assert renders["closing"]["previous"] == "opening"
    assert studio.read_json(talk.path("_reviews.json"), {})["opening"]["note"] == "bigger"
    assert studio.read_json(talk.path("_resolutions.json"), {}) == {"opening": "720p"}
    assert statuses(talk) == {"opening": "resolution", "closing": "up_to_date"}
    with pytest.raises(RuntimeError, match="already a slide"):
        studio.rename(talk, slide(talk, "opening"), "closing")


def test_restore(talk):
    comment_out(talk, "closing")
    assert names(talk) == ["title"]
    studio.restore(talk, slide(talk, "closing"))
    assert names(talk) == ["title", "closing"]


def test_delete_a_repetition_then_the_slide(talk):
    studio.place(talk, "title", slide(talk, "closing"))
    fake_render(talk)
    assert "other repetitions stay" in studio.delete(talk, slide(talk, "title"))
    assert names(talk) == ["closing", "title"]
    assert talk.path("title.json").exists() and not talk.path("title-2.json").exists()
    assert talk.path("files/title/0.mp4").exists()
    assert "recycle bin" in studio.delete(talk, slide(talk, "title"))
    init = (talk.pres / "diapositivas" / "__init__.py").read_text("utf-8")
    assert "slide_title" not in init and "from . import closing\n" in init
    assert not (talk.pres / "diapositivas" / "title.py").exists()
    assert "title" not in studio.read_json(talk.path("_renders.json"), {})


def test_delete_keeps_a_file_that_another_one_imports(talk):
    studio.new_slide(talk, "helper", None)
    closing = talk.pres / "diapositivas" / "closing.py"
    closing.write_text("from .helper import TITLE\n" + closing.read_text("utf-8"), "utf-8")
    assert studio.delete(talk, slide(talk, "helper")).endswith("was deleted")
    assert (talk.pres / "diapositivas" / "helper.py").exists()


def test_render_lock(talk):
    # A killed render left its lock file, and its process id now belongs to a live process.
    lock = talk.path("_render.lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text(str(os.getpid()))
    said = []
    with studio.RenderLock(talk, said.append):
        second = threading.Thread(target=lambda: studio.RenderLock(talk, said.append).__enter__().__exit__())
        second.start()
        time.sleep(0.5)
        assert second.is_alive(), "a second render must wait for the first one"
        assert said == ["Another render of this talk is running, waiting for it to finish…"]
    second.join(5)
    assert not second.is_alive(), "it must start when the first one ends"


def png(width, height):
    """An 8-bit RGB PNG, like the frames that ffmpeg writes. The pixels go in two IDAT chunks."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    pixels = zlib.compress(b"".join(b"\0" + b"\x2b\x59\xff" * width for _ in range(height)))
    half = len(pixels) // 2
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", pixels[:half]) + chunk(b"IDAT", pixels[half:]) + chunk(b"IEND", b""))


def test_pdf_has_no_page_for_a_loop_after_a_pause(talk):
    fake_render(talk)
    pause, loop = {"file": "a.mp4"}, {"file": "b.mp4", "loop": True}
    studio.write_json(talk.path("opening.json"), {"slides": [pause, loop, pause]})
    studio.write_json(talk.path("closing.json"), {"slides": [loop, pause]})
    videos = studio.pdf_videos(talk, ["opening", "closing"])
    assert [v.name for v in videos] == ["a.mp4", "a.mp4", "b.mp4", "a.mp4"]


def test_pdf_of_pngs():
    pdf = studio.pdf_of_pngs([png(16, 9), png(32, 18)])
    assert pdf.startswith(b"%PDF-1.4") and pdf.endswith(b"%%EOF\n")
    assert b"/Count 2" in pdf and pdf.count(b"/MediaBox [0 0 960 540]") == 2
    assert zlib.decompress(pdf.split(b"stream\n")[1].split(b"\nendstream")[0]).startswith(b"\0\x2b\x59\xff")
    # The cross-reference table must point at each object, or readers have to repair the file.
    start = int(pdf.rsplit(b"startxref\n", 1)[1].split()[0])
    assert pdf[start:].startswith(b"xref")
    rows = pdf[start:].split(b"\n")[3:3 + 8]  # catalog, pages, and page, image, drawing for each
    for n, row in enumerate(rows, 1):
        assert len(row) == 19 and pdf[int(row[:10]):].startswith(f"{n} 0 obj".encode())
    with pytest.raises(RuntimeError):
        studio.pdf_of_pngs([png(4, 4).replace(b"\x08\x02\0\0\0", b"\x08\x06\0\0\0")])


# ───────────────────────────── command line ─────────────────────────────

def test_command_line(talk, capsys):
    out = lambda *argv: (studio.main(list(argv)), capsys.readouterr().out)[1]  # noqa: E731
    assert "Noted the change for title" in out(talk.id, "note", "title", "make", "it", "bigger")
    assert "make it bigger" in out("docker-from-scratch", "notes")
    assert "title approved" in out(talk.id, "note", "title", "--approve")
    assert "Cleared" in out(talk.id, "note", "title", "--clear")
    assert "title: 720p" in out(talk.id, "resolution", "title", "720p")
    assert "the talk's resolution" in out(talk.id, "resolution", "title", "default")
    assert "closing is now first" in out(talk.id, "move", "closing", "--first")
    assert "now called opening" in out(talk.id, "rename", "title", "Opening")
    assert json.loads(out(talk.id, "new", "Extra", "--after", "opening", "--json"))["pos"] == 3
    assert "Placed slide_extra after extra" in out(talk.id, "place", "slide_extra", "--after", "extra")
    assert "extra-2" in out(talk.id, "list")
    assert json.loads(out(talk.id, "status"))["slides"][0]["name"] == "closing"
    assert json.loads(out(talk.id, "info", "--resolution", "720p", "--json"))["resolution"] == "720p"
    assert json.loads(out("talks", "--json"))[0]["id"] == talk.id
    assert "left the talk" in out(talk.id, "delete", "extra-2")
    assert "file is in the recycle bin" in out(talk.id, "delete", "extra")
    comment_out(talk, "opening")
    assert "back in the talk" in out(talk.id, "restore", "opening")
    for argv, message in (([talk.id, "bogus"], "Unknown command"),
                          ([talk.id, "render"], "what to render"),
                          ([talk.id, "move", "opening"], "Tell me where"),
                          ([talk.id, "info", "--resolution", "4k"], "Error"),
                          (["open", "relative"], "Error")):
        with pytest.raises(SystemExit, match=message):
            studio.main(argv)


def test_command_line_contract_of_the_app(talk, capsys, tmp_path):
    """The exact calls of crates/desktop/manimrs_studio/src/commands/: their arguments and JSON must not change."""
    def call(*argv):
        studio.main(list(argv))
        return json.loads(capsys.readouterr().out)

    (tmp_path / "elsewhere").mkdir()
    made = call("new-talk", "--json", "--about=What", "--language=en",
                f"--in={tmp_path / 'elsewhere'}", "--folder=my-talk", "--", "My title")
    assert set(made) == {"id", "title", "path"} and made["title"] == "My title"
    assert Path(made["path"]) == tmp_path / "elsewhere" / "my-talk"
    assert call("open", "--json", "--", made["path"])["id"] == made["id"]
    assert [t["id"] for t in call("talks", "--json")] == [talk.id, made["id"]]
    info = call(made["id"], "info", "--json", "--title=Other", "--author=Me")
    assert set(info) == {"id", "path", *studio.PROJECT_FIELDS}
    assert (info["title"], info["author"], info["about"]) == ("Other", "Me", "What")


def test_command_line_talks(talk, capsys, tmp_path):
    studio.main(["new-talk", "Second", "talk", "--language", "es", "--json"])
    made = json.loads(capsys.readouterr().out)
    assert made["id"] == "charla-second-talk"
    assert "Gracias" in (Path(made["path"]) / "diapositivas" / "closing.py").read_text("utf-8")
    studio.main(["open", made["path"], "--json"])
    assert json.loads(capsys.readouterr().out)["id"] == "charla-second-talk"
    studio.main([made["id"], "forget"])
    studio.main(["talks"])
    assert "charla-second-talk" not in capsys.readouterr().out


# ───────────────────────────── web panel ─────────────────────────────

@pytest.fixture
def panel(talk, monkeypatch):
    calls = []
    monkeypatch.setattr(studio, "JOBS", studio.Jobs())
    monkeypatch.setattr(studio, "render", lambda t, targets, q, log, on_start: calls.append(
        ([s.name for s in targets], q)))
    monkeypatch.setattr(studio, "_open_in_editor", lambda p: calls.append(("editor", p.name)))
    monkeypatch.setattr(studio, "_open", lambda p: calls.append(("open", p.name)))
    server = ThreadingHTTPServer(("127.0.0.1", 0), studio.panel_handler())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}", calls
    server.shutdown()


def get(url, **headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def post(url, data, kind="application/json"):
    request = urllib.request.Request(url, json.dumps(data).encode(), {"Content-Type": kind})
    try:
        with urllib.request.urlopen(request) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_panel_serves_ranges(panel):
    base, _ = panel
    size = studio.PANEL.stat().st_size
    assert get(base + "/")[0] == 200
    code, headers, body = get(base + "/", Range="bytes=0-9")
    assert (code, len(body), headers["Content-Range"]) == (206, 10, f"bytes 0-9/{size}")
    assert get(base + "/", Range="bytes=-5")[2] == studio.PANEL.read_bytes()[-5:]
    assert get(base + "/", Range="bytes=5-")[2] == studio.PANEL.read_bytes()[5:]
    assert get(base + "/", Range=f"bytes={size}-")[0] == 416
    assert get(base + "/", Host="evil.example")[0] == 403
    assert get(base + "/", Origin="http://evil.example")[0] == 403


def test_panel_cannot_be_framed(panel):
    base, _ = panel
    for url in (base + "/", base + "/api/talks", base + "/nothing"):
        headers = get(url)[1]
        assert headers["X-Frame-Options"] == "DENY"
        assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
        assert headers["X-Content-Type-Options"] == "nosniff"


def test_panel_api(panel, talk):
    base, calls = panel
    assert json.loads(get(base + "/api/talks")[2]) == [{"id": talk.id, "title": "Docker from scratch"}]
    assert json.loads(get(base + f"/api/status?talk={talk.id}")[2])["slides"][0]["name"] == "title"
    assert get(base + "/api/status?talk=nope")[0] == 404
    talk.renders.mkdir()
    talk.path("note.txt").write_text("hi")
    assert get(base + f"/file/{talk.id}/note.txt")[2] == b"hi"
    assert get(base + f"/file/{talk.id}/..%2Fmain.py")[0] == 404
    assert post(base + "/api/review", {"talk": talk.id, "name": "title", "status": "changes",
                                       "note": "x"}) == (200, {"ok": True})
    assert studio.read_json(talk.path("_reviews.json"), {})["title"]["note"] == "x"
    for what in ("pending", "all", ["closing"]):
        assert post(base + "/api/render", {"talk": talk.id, "what": what})[0] == 200
    assert post(base + "/api/open", {"talk": talk.id, "name": "title"})[0] == 200
    assert post(base + "/api/open", {"talk": talk.id, "what": "exported"})[0] == 200
    assert post(base + "/api/cancel", {"id": 99}) == (200, {"ok": True})
    assert post(base + "/api/nothing", {"talk": talk.id})[0] == 400
    assert post(base + "/api/review", {"talk": talk.id}, kind="text/plain")[0] == 403
    deadline = time.time() + 10
    while time.time() < deadline and len([c for c in calls if isinstance(c[0], list)]) < 3:
        time.sleep(0.05)
    renders = [c for c in calls if isinstance(c[0], list)]
    assert renders == [(["title", "closing"], "1080p"), (["title", "closing"], "1080p"),
                       (["closing"], "1080p")]
    assert ("editor", "title.py") in calls and ("open", "exported") in calls


# ───────────────────────────── start and processes ─────────────────────────────

def test_a_missing_program_is_named(talk):
    with pytest.raises(RuntimeError, match="Could not find no-such-program-here"):
        studio.run(["no-such-program-here", "x"], talk.pres, print)


def test_file_url_is_relative_to_the_renders(talk):
    video = talk.path("files/title/a.mp4")
    video.parent.mkdir(parents=True)
    video.write_bytes(b"x")
    assert studio.file_url(talk, video).startswith(f"/file/{talk.id}/files/title/a.mp4?v=")
    roundabout = talk.pres / "diapositivas" / ".." / "diapos" / "files" / "title" / "a.mp4"
    assert studio.file_url(talk, roundabout).startswith(f"/file/{talk.id}/files/title/a.mp4?v=")


def test_the_panel_modules_are_not_loaded_at_start():
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import studio; "
            "print([m for m in ('http.server', 'zipfile', 'webbrowser') if m in sys.modules])")
    out = subprocess.run([sys.executable, "-c", code, str(Path(studio.__file__).parent)],
                         capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "[]"


# ───────────────────────────── MCP server for any agent ─────────────────────────────

def test_mcp_server_answers_an_agent(talk, monkeypatch):
    import mcp_server
    calls = []
    monkeypatch.setattr(mcp_server, "studio", lambda *args: calls.append(args) or "done")
    start = mcp_server.answer({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert start["result"]["serverInfo"]["name"] == "studio"
    assert mcp_server.answer({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    tools = mcp_server.answer({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})["result"]["tools"]
    assert {t["name"] for t in tools} == {"talks", "slides", "notes", "render", "view", "place",
                                          "export", "present"}
    assert mcp_server.answer({"jsonrpc": "2.0", "id": 3, "method": "nope"})["error"]["code"] == -32601

    def tool(name, **arguments):
        message = {"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                   "params": {"name": name, "arguments": arguments}}
        return mcp_server.answer(message)["result"]

    assert not tool("render", talk="docker", slides=["title", 2], quality="480p")["isError"]
    assert calls[-1] == ("docker", "render", "--quality=480p", "--", "title", "2")
    assert not tool("place", talk="docker", method="slide_x", after="title")["isError"]
    assert calls[-1] == ("docker", "place", "--after=title", "--", "slide_x")
    assert tool("render", talk="docker", slides=[])["isError"]
    assert tool("render", talk="docker", slides=["a"], quality="4k")["isError"]
    assert tool("slides", talk="--help")["isError"]
    assert tool("slides", talk="../other")["isError"]
    assert tool("nothing", talk="docker")["isError"]


def test_mcp_server_over_its_input_and_output(talk):
    server = Path(studio.__file__).with_name("mcp_server.py")
    lines = [{"jsonrpc": "2.0", "id": 1, "method": "ping"}, "not json",
             {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "nothing"}}]
    text = "\n".join(l if isinstance(l, str) else json.dumps(l) for l in lines) + "\n"
    out = subprocess.run([sys.executable, str(server)], input=text, capture_output=True, text=True,
                         encoding="utf-8", check=True)
    first, second, third = (json.loads(l) for l in out.stdout.splitlines())
    assert first == {"jsonrpc": "2.0", "id": 1, "result": {}}
    assert second["error"]["code"] == -32700
    assert third["result"]["isError"]

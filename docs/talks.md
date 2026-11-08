# Talks

## Talks in any folder

The list at the top of the app shows all the talks that the engine knows. The talks can be in any
folder. The engine keeps the list in `manimrs-studio/talks.json`.

| Action | Procedure | Result |
| --- | --- | --- |
| Make a talk | Select *+ New talk* at the end of the list. Type the title, what the talk is about and the language of its slides. Click *Choose folder* to select where the talk goes. | The new talk has a title slide and an end slide. If you wrote what the talk is about, Claude proposes the slides and waits for your approval. |
| Open a talk | Select *Open a talk…*, then select the folder of the talk. | The talk goes into the list. If the folder is empty, the form for a new talk opens. |
| See or change a talk | Click the **ⓘ** button next to the list. | A form shows the title, what the talk is about, the author and the language. *Show in folder* opens the folder of the talk. |
| Remove a talk from the list | In the same form, click *Remove from the list…*. | The engine does not delete files. You can open the talk again at a later time. |

For *Open a talk…*, you can select one of these folders:

- The folder of the talk.
- Its `presentacion` folder, for example `charla-git\presentacion`.
- The folder of its `talk.manimrs` file.

The first time, the engine adds the talks that are next to `manimrs-studio` and that have a
`presentacion/main.py` file.

## The talk.manimrs file

Each talk has a `talk.manimrs` file next to its `main.py`. This JSON file tells what the talk is.
You can read it and change it with a text editor:

```json
{
  "manimrs": 1,
  "title": "Git y GitHub",
  "about": "Una introducción a Git y GitHub para principiantes",
  "author": "",
  "language": "es",
  "resolution": "1080p"
}
```

| Field | Contents |
| --- | --- |
| `title` | The name of the talk in the app. The title slide keeps its own text. |
| `about` | Who the talk is for and what it is about. Claude reads it before it makes slides. |
| `author` | The person who gives the talk. |
| `language` | The language of the slides, as a code: `es`, `en`, `pt-BR`. |
| `resolution` | The resolution of the talk: `480p`, `720p` or `1080p`. A slide without its own resolution renders at this resolution, and is up to date only at this resolution. |

If a talk has no `talk.manimrs` file, the engine makes one the first time that it opens the talk.
It takes the title and the first paragraph of the `README.md` of the talk. The engine keeps all other
fields that you add to the file.

## The format of a talk

A talk is a folder with a `main.py`. The engine reads the talk from these files:

| File | Contents |
| --- | --- |
| `main.py` | One Manim Slides scene. Its `construct()` method calls the slides in order: `self.slide_<name>()`. |
| `diapositivas/__init__.py` | The registry of the slides: `slide_<name> = _slide(<module>.build)`. |
| `diapositivas/<name>.py` | The content of a slide: a function that gets the scene and ends with `scene.next_slide()`. |
| `diapositivas/_template.py` | The template for a new slide. The text `Slide title` changes to the name of the slide. |
| `pyproject.toml` | The Python packages of the talk. |
| `talk.manimrs` | What the talk is. |

The folder names come from Spanish: `presentacion` is the presentation and `diapositivas` are the
slides. The engine keeps these names.

Rules of the format:

- A comment line in `construct()` starts a group of slides. The app shows the group name above the
  slides.
- A slide call that is a comment (`# self.slide_x()`) has the status *commented out*. The app shows it
  in grey.
- A slide can be in `construct()` more than one time. The second call is `<name>-2`, the third call
  is `<name>-3`.
- Each slide starts with a hook that removes the previous slide: `start_slide()`, or
  `iniciar_slide()` in older talks.
- The older talks keep their code in `presentacion/`. The talks that the app makes keep all the
  files in one folder.

## A new talk

A new talk gets these files:

| File | Contents |
| --- | --- |
| `talk.manimrs` | The title, what the talk is about and the language. |
| `README.md` | The title and what the talk is about. |
| `main.py` | The scene, with a title slide and an end slide. |
| `style.py` | The colors, the font and the text sizes. Change them here to change all the slides. |
| `diapositivas/__init__.py` | The registry, with `title` and `closing`. |
| `diapositivas/title.py`, `closing.py` | The two first slides. The end slide uses the language of the talk. |
| `diapositivas/_template.py` | The template for the slides that you add. |
| `pyproject.toml`, `.python-version` | Python 3.13, Manim below 0.22 and Manim Slides. Manim 0.22 does not work with Manim Slides 5.7. |
| `.manim-slides.toml` | The keys of the presenter. |
| `.gitignore` | The folders that a render makes. |

The default folder is `charla-<title>` in the talks folder. You can select a different folder and
name. An empty folder that is already there is also correct.

## The files of a render

The engine keeps the renders in the `diapos` folder of the talk. A render of one slide does not
change the files of the other slides.

| File | Contents |
| --- | --- |
| `<name>.json` | The pauses of the slide and the path of each video, in the Manim Slides format. |
| `files/<name>/` | The videos of the slide. |
| `_renders.json` | The code that made each render: hashes of the slide, of the slide before it and of the shared code. |
| `_reviews.json` | The notes and the approvals from the review. |
| `_resolutions.json` | The resolution of each slide that has its own resolution. |
| `_thumbnails/` | One image for each slide. |
| `_stills/` | One image for each pause, for Claude. |
| `exported/` | The HTML package and the PDF. |
| `_data.lock`, `_render.lock` | Locks. Only one process at a time changes these files or renders the talk. |

Older versions of the engine used Spanish names: `_registro.json`, `_revision.json`,
`_calidades.json`, `_miniaturas/`, `_fotos/` and `exportado/`. The engine changes them to the new
names the first time that it opens the talk.

The old `presentacion/slides/` folder of Manim Slides is not necessary. You can delete it.

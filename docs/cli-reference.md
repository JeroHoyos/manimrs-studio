# Command reference

The commands do the same work as the app and the web panel.

## Run a command

From the `manimrs-studio` folder:

```powershell
.\studio <command>
```

From the talks folder:

```powershell
uv run --no-project manimrs-studio/engine/studio.py <command>
```

The engine uses only the Python standard library. A project environment is not necessary.

## Commands for the list of talks

| Command | Result |
| --- | --- |
| `studio` | Opens the web panel in the browser. |
| `studio panel --no-browser` | Starts the web panel without the browser. |
| `studio talks [--json]` | Lists the talks with the folder of each talk. |
| `studio open <folder> [--json]` | Adds the talk in `<folder>` to the list. |
| `studio new-talk "<title>" [options]` | Makes a talk with a title slide and an end slide. |
| `studio help` | Shows the help. |

Options of `new-talk`:

| Option | Default | Result |
| --- | --- | --- |
| `--about "<text>"` | empty | What the talk is about. |
| `--language <code>` | `es` | The language of the slides, for example `en`. |
| `--in <folder>` | the talks folder | The folder that holds the new talk. Give the full path. |
| `--folder <name>` | `charla-<title>` | The name of the folder of the talk. |
| `--json` | | Writes the result as JSON. |

## Commands for one talk

`<talk>` is the name from `studio talks`, for example `charla-git`. The prefix `charla-` is optional.
`<slide>` is the name or the number of a slide in `studio <talk> list`.

| Command | Result |
| --- | --- |
| `studio <talk> list` | Lists the slides with their status. This is the default command. |
| `studio <talk> status` | Writes the status of the talk as JSON. |
| `studio <talk> info [--json]` | Shows the fields of `talk.manimrs`. |
| `studio <talk> info --<field> "<value>"` | Changes fields of `talk.manimrs`: `title`, `about`, `author`, `language`, `resolution`. |
| `studio <talk> forget` | Removes the talk from the list. The files of the talk do not change. |
| `studio <talk> render <slide>...` | Renders only these slides. |
| `studio <talk> render --pending` | Renders the slides that are not up to date. |
| `studio <talk> render --all` | Renders all the slides. |
| `studio <talk> present [<slide>]` | Presents the slides that have a video, from `<slide>`. |
| `studio <talk> export [--pdf]` | Makes the HTML package and its `.zip`, or a PDF with one page for each pause. |
| `studio <talk> export --mp4 [<slide>]` | Makes one video of the talk, or of one slide. A loop plays one time. |
| `studio <talk> export --gif <slide>` | Makes a GIF of one slide, 960 pixels wide. |
| `studio <talk> stills <slide> [--width <pixels>]` | Makes a PNG image of the end of each pause. |
| `studio <talk> notes` | Lists the changes from the review. |
| `studio <talk> note <slide> "<text>"` | Writes a change request for the slide. |
| `studio <talk> note <slide> --approve` | Approves the slide. |
| `studio <talk> note <slide> --clear` | Removes the review of the slide. |
| `studio <talk> new "<name>" [--after <slide>]` | Makes, registers and puts a new slide in the talk. |
| `studio <talk> place slide_<name> [--after <slide>]` | Puts a registered slide in `main.py`. |
| `studio <talk> move <slide> --after <slide>` | Moves a slide. Use `--first` to make it the first slide. |
| `studio <talk> rename <slide> "<new name>"` | Renames a slide and its videos. |
| `studio <talk> duplicate <slide> ["<new name>"]` | Makes a copy of a slide after it. Without a name, the copy is `<slide>_copy`. |
| `studio <talk> restore <slide>` | Removes the comment from the call of a slide in `main.py`. |
| `studio <talk> delete <slide>` | Removes a slide. Its file goes to the recycle bin. |
| `studio <talk> resolution <slide> <value>` | Sets the resolution of one slide: `480p`, `720p`, `1080p` or `default`. |

Options for one talk:

| Option | Commands | Result |
| --- | --- | --- |
| `--quality 480p\|720p\|1080p` | `render` | The resolution of the render. The default is the resolution of the talk. A slide with its own resolution keeps it. |
| `--line <number>` | `move`, `rename`, `restore`, `delete`, `resolution` | Selects the slide by its line in `main.py` (from 0). This also works for a slide that is a comment. |
| `--json` | `info`, `new`, `talks`, `open`, `new-talk` | Writes the result as JSON. |

## Examples

Render two slides at 480p:

```powershell
.\studio git render 3 git_diff --quality 480p
```

Add a slide after `git_diff`:

```powershell
.\studio git new "git stash" --after git_diff
```

## Errors

If a command cannot do its work, it writes `Error:` and the cause, and it stops with a code that is
not zero. The engine does not change files when the input is not correct.

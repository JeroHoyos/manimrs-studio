# Claude chat

The chat runs Claude Code without a terminal. The app shows all that Claude does as messages, steps,
permission cards and questions.

## Steps

The app puts what Claude thinks, its tool calls and the short notes between them in one row. The
row shows a summary, for example "Edited a file, rendered 2 slides, and 7 more steps". At the right,
it shows the images that Claude examined.

Click the row to see each step. Click a step to see its details: the thought, the command, the
result or the image. The last answer of Claude stays below the row. The focus view hides the steps.

## The message box

| Control | Result |
| --- | --- |
| Enter | Sends the message. In the chat settings, you can use Ctrl+Enter. |
| `@` | Mentions a file of the talks folder or of the open talk. |
| `/` at the start | Runs a command. |
| `+` | Attaches images, PDF files or text files. You can also paste or drop them. |
| Esc, or the square button | Stops Claude. |

You can send more messages while Claude works.

## Mode, model and effort

- **Mode.** Claude always works in *Auto mode*. Claude does safe actions without a question. Before
  a risky action, Claude shows a permission card.
- **Model and effort.** Select them with the chips below the message box.

## Actions

Click the `/` button or push Ctrl+/ to see the actions. They are the same as in the Claude Code
extension for VS Code:

| Group | Actions |
| --- | --- |
| Context | Attach a file, mention a file, clear, resume, rewind, bookmarks, export, side question. |
| Model | Switch model, effort, fast mode, switch models when a message has a flag, account and usage limits. |
| Customize | Output styles, MCP servers, hooks, permissions, memory, instructions (CLAUDE.md), plugins, sandbox. |
| Settings | Status, chat settings (focus view, timestamps, Ctrl+Enter). |
| Support | Help docs, report a problem, open the conversation in a terminal. |

*Rewind* puts back the code, the conversation or both, as they were before a message. The list
also shows all the slash commands.

## History

Click the clock button to see the conversations of the talks folder. Select one to continue it.

## Talks in other folders

Claude works in the talks folder and in the folders of the talks that are in other places. When you
open or make a talk during a conversation, Claude gets access to its folder in the next
conversation. Until then, Claude asks before it changes files of that talk.

## The MCP tools of the app

The app starts a local MCP server for its Claude session. Claude uses these tools without a
permission card:

| Tool | Arguments | Result |
| --- | --- | --- |
| `talks` | none | The talks: name, title and folder of each one. |
| `slides` | `talk` | The slides in order: number, name, status, review and `.py` file. |
| `notes` | `talk` | The changes that the user wrote in the review. |
| `render` | `talk`, `slides`, `quality` | Renders only those slides. The app shows the progress and the video. |
| `view` | `talk`, `slide` | The image of the end of each pause of a slide. |
| `show` | `talk`, `slide` | Opens the slide in the app. |
| `place` | `talk`, `method`, `after` | Adds `self.<method>()` to `construct()`, after a slide or at the end. |
| `export` | `talk`, `format` | Makes the HTML package (`html`) or the PDF (`pdf`). |
| `present` | `talk`, `start` | Opens the presenter. |

The value of `talk` is the name from the list of talks, for example `charla-git`. The prefix
`charla-` is optional. The value of `slide` is the name or the number of the slide.

## The slides skill

The `/slides` command comes from the `slides` skill of Claude Code. The skill tells Claude the
procedure for a slide. Claude reads the rules of the talk and makes the smallest change. Then it
renders the slide, examines its images and shows the slide to the user.

Claude Code finds the skill in `.claude/skills/slides/SKILL.md` of the talks folder.

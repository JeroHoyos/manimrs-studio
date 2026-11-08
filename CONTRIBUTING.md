# Contribute to ManimRS Studio

Thank you for your help. This file tells you how to report a problem, how to set up the project and
how to send a change.

## Report a bug

1. Make sure that the bug is not in the [issues](../../issues) already.
2. Open a new issue with the *Bug report* template.
3. Give the steps that cause the bug, the result and the result that you expected.
4. Give the versions of Windows, the app, uv and Claude Code.

Do not report a vulnerability in a public issue. Refer to [SECURITY.md](SECURITY.md).

## Suggest a feature

Open a new issue with the *Feature request* template. Tell the problem first, then the solution
that you propose.

## Set up the project

1. Install the [requirements](docs/installation.md#requirements).
2. Clone the repository into a folder for talks, as [Installation](docs/installation.md) shows.
3. In the `manimrs-studio` folder, install the tools for development:

   ```powershell
   uv sync
   ```

The tools are pytest and complexipy. The engine uses only the Python standard library.

## Run the tests

```powershell
uv run pytest
```

The tests make a talk in a temporary folder. Manim is not necessary for the tests.

Add a test for each new branch, parser or file change in the engine. A test must fail when the
change breaks.

## Examine the complexity

```powershell
uv run complexipy .
```

The cognitive complexity of each Python function must be 10 or less. The configuration is in
`pyproject.toml`. If a function gets more than 10, divide it by task. Do not divide it only to make
it shorter.

## Build the app

```powershell
cd app
cargo build --release
```

After a change to `app/ui/`, build the app again, because the interface goes into the `.exe`
file. If the app is open, close it first.

To control the window from a script, start the app with this environment variable:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
```

Then connect to `http://127.0.0.1:9223/json` with the DevTools protocol. Use `Runtime.evaluate` to
read and change the page, and `Page.captureScreenshot` to get an image.

## Code standard

- Make the smallest change that solves all of the problem. Do not add options, layers or code
  for the future.
- Use what the project has before you add something. Do not add a dependency for a few lines.
- Keep the structure of the code: the engine in Python, the app in Rust, the interface in HTML and
  JavaScript without a build step.
- Write code, comments, interface text and documentation in English.
- Write a comment only for the reason that the code cannot show.
- Do not change the commands that the app uses, or their JSON output, without a change to
  `app/src/`. The tests in `tests/` keep this contract.

The project uses the `ponytail` and `ponytail-review` skills of Claude Code, in `.claude/skills/`.
They give the same rules in more detail.

### Libraries in app/ui/vendor

1. Get the browser build from the official npm package: `marked/lib/marked.umd.js` and
   `dompurify/dist/purify.min.js`.
2. Make sure that the file agrees with the `integrity` hash of the package.
3. Use a version that has been on npm for two weeks or more.

## Documentation

Write all documentation in ASD-STE100 Simplified Technical English. Refer to
[Documentation style](docs/writing-style.md).

When a change affects the user, update the documentation in `docs/` and add a line to
[CHANGELOG.md](CHANGELOG.md), below *Unreleased*.

## Send a pull request

1. Make a branch from `main`.
2. Make one change in each pull request: one feature or one fix.
3. Run the tests and complexipy. Both must pass.
4. If you changed `app/`, build the app and examine the change in the window.
5. Write the title in the [Conventional Commits](https://www.conventionalcommits.org/) format.
   For example: `fix: keep the reviews when a slide is renamed`.
6. Complete the pull request template.

The types of title are `feat`, `fix`, `docs`, `refactor`, `test` and `chore`.

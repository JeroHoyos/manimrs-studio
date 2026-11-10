# The window of the app

This folder holds the window of ManimRS Studio, in TypeScript. The Rust app in
`crates/desktop/manimrs_studio/` shows it in a Tauri window.

| Path | Contents |
| --- | --- |
| `apps/studio/index.html` | The page: the icons and the fixed parts of the window. |
| `apps/studio/src/` | The code of the window. The number of each file gives its load order. |
| `apps/studio/src/styles/` | The styles. |
| `apps/studio/public/` | The fonts and the two vendor libraries (`marked`, `DOMPurify`). |
| `libs/bridge/` | The types that the window shares with the Rust app and the engine. |
| `scripts/build.mjs` | The build: TypeScript, then a copy of the page into `apps/studio/dist/`. |

## Commands

```powershell
npm ci             # install TypeScript
npm run build      # check the types and write apps/studio/dist/
npm run typecheck  # check the types only
```

Build the window before you build the app. The app takes the window from `apps/studio/dist/`.

## Rules

- The only tool is TypeScript. There is no bundler and no framework.
- The files of `src/` are scripts with one shared scope. The move to modules is on the
  [roadmap](../README.md#status-and-roadmap).
- A new command of the app gets a type in `libs/bridge/` if it returns data.
- Get a vendor library from npm only. Check its `integrity` value. Use a version that is two
  weeks old or older.

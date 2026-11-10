// The bridge between the window and the Rust side of the app.
//
// The Rust side gives `window.__TAURI__` (see `withGlobalTauri` in tauri.conf.json). The window
// calls a command with `invoke` and gets the events of the app with `listen`. The commands are in
// crates/desktop/manimrs_studio/src/commands/.

interface TauriEvent<T> {
  payload: T;
}

interface TauriGlobal {
  core: {
    invoke(command: string, args?: Record<string, unknown>): Promise<any>;
  };
  event: {
    listen<T = any>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
  };
}

interface Window {
  __TAURI__: TauriGlobal;
}

// The two libraries that index.html loads before the app (public/vendor/).
declare const marked: {
  parse(text: string, options?: Record<string, unknown>): string;
  use(...extensions: Record<string, unknown>[]): void;
  Renderer: new () => Record<string, any>;
};

declare const DOMPurify: {
  sanitize(html: string, options?: Record<string, unknown>): string;
  addHook(name: string, hook: (node: any, data?: any) => void): void;
};

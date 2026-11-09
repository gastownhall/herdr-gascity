// The subset of gpui-shell's script globals (herdr-app v0.1.14, gpui-kit
// typings.rs) that this mod uses. Only src/host.ts touches them.

/** herdr's fetch: options {method, headers, body} only; no response headers; 30 s timeout; 8 MiB cap. */
declare function fetch(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ readonly status: number; readonly ok: boolean; readonly url: string; text(): Promise<string> }>;

/** Per-copy storage that survives a restart (keyed by the copy's props). */
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

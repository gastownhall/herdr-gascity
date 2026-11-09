// The app's command book: which deliveries have run, and what became of
// every command any copy got.
//
// herdr delivers `herdr-app do gascity.<command>` to every copy on screen
// (the tab, the "needs you" window, a split pane, pinned copies), each in
// its own turn. Copies share the module, so this module-level book lets a
// command that changes gc state run once per app: the first copy that shows
// the command's city claims the delivery; the others find it claimed and log
// a duplicate. A delivery is its exact text: the same text again within
// DUPLICATE_WINDOW_MS is the same delivery. With a nonce it is the same
// delivery for NONCE_WINDOW_MS, and a different nonce is a different one.
//
// The log is app-wide, so the probe (written by one owner copy) shows a
// command whichever copy ran it.

/** The same command text within this is one delivery to several copies. */
export const DUPLICATE_WINDOW_MS = 2_000;
/** A delivery with a nonce stays claimed this long. */
export const NONCE_WINDOW_MS = 10 * 60_000;
/** Commands kept in the log. */
export const COMMAND_LOG_LIMIT = 20;

/** One command a copy got, and what became of it. */
export interface CommandEntry {
  at: number;
  /** The command as shown (cleaned, shortened). */
  command: string;
  /** Which copy: "window", "panel", or "panel <city>" for a pinned one. */
  copy: string;
  /**
   * done: run; asked: it opened its button's question (no confirm);
   * refused: why in `detail`; skipped: it names another city than this
   * copy's; duplicate: another copy already ran this delivery.
   */
  result: "done" | "asked" | "refused" | "skipped" | "duplicate";
  detail: string;
}

/** The app's command book. */
export class CommandBook {
  private readonly claims = new Map<string, number>();
  private log: CommandEntry[] = [];

  /** Claims delivery `text` at `now`; false when a copy already claimed it within its window. */
  claim(text: string, nonce: boolean, now: number): boolean {
    for (const [k, until] of this.claims) if (until <= now) this.claims.delete(k);
    if (this.claims.has(text)) return false;
    this.claims.set(text, now + (nonce ? NONCE_WINDOW_MS : DUPLICATE_WINDOW_MS));
    return true;
  }

  /** Gives up a claim: the copy that claimed `text` refused it. */
  release(text: string): void {
    this.claims.delete(text);
  }

  record(entry: CommandEntry): void {
    this.log = [...this.log, entry].slice(-COMMAND_LOG_LIMIT);
  }

  /** The log, oldest first. */
  entries(): readonly CommandEntry[] {
    return this.log;
  }
}

let shared: CommandBook | null = null;

/** The app's book, created on first use (module scope: every copy shares it; a mod reload starts a new one). */
export function sharedCommandBook(): CommandBook {
  shared ??= new CommandBook();
  return shared;
}

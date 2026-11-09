// The subset of the gpui-kit / gpui-base element builders that this mod uses,
// as declared by the gpui-kit typings herdr-app v0.1.14 generates at run time.
// The full `gpui-kit.d.ts` is written into the app home on every start.

/** A concrete `#rgb`, `#rrggbb` or `#rrggbbaa` colour; bare token names are not accepted. */
type GpuiColor = `#${string}`;

/** The props a view was opened with. */
type GpuiProps = Record<string, unknown>;

/** A chained element builder (GPUI names). Every method returns the element. */
interface GpuiElement {
  id(id: string): GpuiElement;
  child(child: GpuiElement | string): GpuiElement;
  children(children: readonly (GpuiElement | string)[]): GpuiElement;
  when(condition: boolean, apply: (el: GpuiElement) => GpuiElement): GpuiElement;
  size_full(): GpuiElement;
  flex_1(): GpuiElement;
  p(n: number): GpuiElement;
  gap(n: number): GpuiElement;
  text_size(n: number): GpuiElement;
  font_semibold(): GpuiElement;
  text_color(color: GpuiColor): GpuiElement;
  bg(color: GpuiColor): GpuiElement;
  /** Needs an `id`. Keyboard activation counts as a click. */
  on_click(handler: (event: unknown, cx: GpuiContext) => void): GpuiElement;
  /** The keyboard means this element while `handle` is focused. */
  track_focus(handle: GpuiFocusHandle): GpuiElement;
  /** Delivered while this element or one inside it holds the keyboard. */
  on_key_down(handler: (event: GpuiKeyEvent, cx: GpuiContext) => void): GpuiElement;
}

/** A focus target the script owns, created once (in init) and kept on the view. */
interface GpuiFocusHandle {
  /** Moves the keyboard onto the element tracking this handle. */
  focus(): void;
  /** Whether the element tracking this handle has the keyboard. */
  is_focused(): boolean;
}

/** What an `on_key_down` handler receives. */
interface GpuiKeyEvent {
  /** The key printed on the key that was pressed, e.g. "j" or "escape". */
  key: string;
  /** The whole chord as a key binding spells it, e.g. "cmd-shift-s" or "escape". */
  keystroke: string;
}

/** One-shot and repeating callbacks on the foreground executor, owned by the view whose context made them. */
interface GpuiTimer {
  /**
   * Calls `handler(cx)` every `ms`. The interval is measured from the end of
   * one call, so a slow handler delays the next tick instead of stacking.
   */
  every(ms: number, handler: (cx: GpuiAsyncContext) => void): unknown;
}

/** The context `render` gets. Never keep one past the call that got it. */
interface GpuiContext {
  notify(): void;
  /** One-shot and repeating callbacks on the foreground executor. */
  readonly timer: GpuiTimer;
  /** Runs `body` as a task of this view; a rejection is reported, not swallowed. */
  spawn(body: (cx: GpuiAsyncContext) => unknown): unknown;
  /** Resolves after `ms` on GPUI's foreground executor. */
  sleep(ms?: number): Promise<void>;
  /** A new focus handle: call it in init or an event handler, never in render. */
  focus_handle(): GpuiFocusHandle;
}

/** The context `init`, `close` and tasks get: valid across `await`. */
interface GpuiAsyncContext extends GpuiContext {}

declare module "gpui-kit" {
  export abstract class View {
    constructor(props?: GpuiProps);
    /** Runs once. herdr passes `undefined` props to a root view: read `props()` from herdr. */
    init?(props: GpuiProps | undefined, cx: GpuiAsyncContext): void;
    /** Root view only: one final call when the host closes this copy (not when hidden). */
    close?(cx: GpuiAsyncContext): void | Promise<void>;
    abstract render(cx: GpuiContext): GpuiElement | string;
  }
  export function div(): GpuiElement;
}

declare module "gpui-base" {
  export function v_flex(): GpuiElement;
  export function h_flex(): GpuiElement;

  /**
   * Retained text state, created once and kept on the view. `InputState.new`
   * needs a live host call: create it in `init` or an event handler, never in
   * `render`.
   */
  export interface InputState {
    value(): string;
    set_value(next: string): void;
    /** `submit` fires on Enter. */
    on(event: "change" | "submit" | "focus" | "blur", handler: (event: unknown, cx: GpuiContext) => void): boolean;
  }
  export const InputState: { new: (options?: { placeholder?: string; value?: string }) => InputState };

  /** The frame around retained text state. */
  export const Input: { new: (state: InputState) => GpuiElement };
}

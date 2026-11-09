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
}

/** The context `render` gets. Never keep one past the call that got it. */
interface GpuiContext {
  notify(): void;
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
}

// The subset of the gpui-kit / gpui-base element builders that this mod uses.
// herdr-app generates the full `gpui-kit.d.ts` at runtime; the types-drift job
// (slice M12) checks `src/` against it.

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
  text_color(color: string): GpuiElement;
  bg(color: string): GpuiElement;
}

/** The per-callback context. Never keep one past the callback that got it. */
interface GpuiContext {
  notify(): void;
}

declare module "gpui-kit" {
  export class View {
    init?(props: Record<string, unknown>, cx: GpuiContext): void;
    render(cx: GpuiContext): GpuiElement;
    close?(cx: GpuiContext): Promise<void>;
  }
  export function div(): GpuiElement;
}

declare module "gpui-base" {
  export function v_flex(): GpuiElement;
  export function h_flex(): GpuiElement;
}

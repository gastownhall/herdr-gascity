// A small stand-in for what `herdr-app types <dir>` writes (gpui-kit.d.ts):
// the same module layout and names as the real file, few members.

declare module "gpui-kit" {
  export type Color = `#${string}`;
  export type DefiniteLength = number | `${number}px`;

  export interface Context {
    notify(): void;
    readonly timer: Timer;
  }
  export interface AsyncContext extends Context {}

  export interface FocusHandle {
    focus(): void;
    is_focused(): boolean;
  }

  export interface KeyEvent {
    key: string;
    keystroke: string;
  }

  export interface Timer {
    every(ms: number, handler: (cx: AsyncContext) => void): unknown;
  }

  export interface NativeElement {
    id(name: string): NativeElement;
    child(child: string | NativeElement): NativeElement;
    p(value: DefiniteLength): NativeElement;
    bg(value: Color): NativeElement;
  }

  export abstract class View {
    constructor(props?: import("gpui-shell").Props);
    init?(props: import("gpui-shell").Props | undefined, cx: AsyncContext): void;
    abstract render(cx: Context): NativeElement | string;
  }

  export function div(): NativeElement;
}

declare module "gpui-base" {
  export function v_flex(): import("gpui-kit").NativeElement;
}

declare module "gpui-shell" {
  export type Props = Record<string, any>;
}

declare module "herdr" {
  // The `herdr` module: what a mod may ask of Herdr and the user's machine.

  /** Every theme colour by name. */
  export function theme(): Record<string, string>;
  /** The user's home directory. */
  export function home(): string;
}

declare const localStorage: { getItem(key: string): string | null };

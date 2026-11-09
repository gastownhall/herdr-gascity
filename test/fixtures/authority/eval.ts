export function decode(text: string): unknown {
  return eval("(" + text + ")");
}

import * as herdr from "herdr";

const host: Record<string, (...a: unknown[]) => unknown> = { ...herdr };
export const go = (name: string) => host[name]!("x");

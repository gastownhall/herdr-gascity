// The only module that imports zod (the authority lint enforces it). It turns
// on `jitless` before any schema exists: every schema module imports zod from
// here, so this module body runs first, and zod v4 never builds a parser with
// the Function constructor. The parity test
// (test/engine/parity.test.ts) proves it at run time in QuickJS with Function
// and eval trapped.
//
// Only the zod/mini builders the mod uses are re-exported, by name, so esbuild
// keeps just those (a re-exported namespace would pull in all of zod). Import
// it as `import * as z from "./zod.ts"`.

import * as zod from "zod/mini";

zod.config({ jitless: true });

/** True when zod's global config has jitless on (checked by the parity probe). */
export function jitlessEnabled(): boolean {
  return zod.config().jitless === true;
}

export {
  array, boolean, enum, int, nullable, number, object, optional, pipe, record, string, transform, union, unknown,
} from "zod/mini";
export type { ZodMiniType } from "zod/mini";

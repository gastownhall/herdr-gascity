// Linted as src/host.ts with the real allowlist: only the first call, the
// exact allowlisted text, may run gcBin. Any other argv or program is a hit.
import * as herdr from "herdr";

export const allowed = herdr.exec(gcBin, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS });
export const otherArgs = herdr.exec(gcBin, ["session", "attach", id], { timeout: GC_STATUS_TIMEOUT_MS });
export const extraArg = herdr.exec(gcBin, ["supervisor", "status", "--json", "--city", path], { timeout: GC_STATUS_TIMEOUT_MS });
export const otherProgram = herdr.exec(program, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS });
export const noTimeout = herdr.exec(gcBin, ["supervisor", "status", "--json"]);

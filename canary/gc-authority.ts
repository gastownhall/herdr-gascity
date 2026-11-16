// The canary's authority audit (stage authority, S13): the mod acts on gc
// only through gc's API, and only as far as its probe shows.
//
//   - Programs: every exec_log entry is on the mod's allowlist (src/host.ts):
//     `<gc> supervisor status --json`, the dashboard opener on a loopback URL,
//     tab.select, an attach tab with the HC_* scrub into this run's city and
//     session, and the two notifications.
//   - Actions → writes: every action the probe shows as done has the write gc
//     recorded for it (a supervisor.request event: phase complete, a mutating
//     method, 2xx), at the path its kind sends to. An action kind the audit
//     has no rule for fails closed.
//   - Writes → actions: every successful write to the city in the window is
//     accounted for by an action (one per attempt) or by the canary agent
//     closing this run's bead. A refused write (non-2xx) changed nothing.
//   - Changes → writes: every bead change gc recorded for this run's bead and
//     every create/close/delete of this run's session bead has a write that
//     started before it and names it (or creates it). The controller's own
//     updates of a session bead (wake, runtime metadata) are not mod writes.
//   - fetch_in_flight_max is at most 2.
//   - The mod and gc agree on the bead's close reason and the session's
//     attach.
//
// Pure: the CLI at the bottom reads the probe, gc's events and gc's state and
// prints the findings; it exits 1 when there are any.

import { HC_SCRUB, NO_START_FLAG } from "../src/terminal/argv.ts";

/** A gc event as GET /v0/events (supervisor scope) lists it; supervisor.request carries the write in its payload. */
export interface GcEvent {
  type: string;
  ts: string;
  city: string;
  subject?: string;
  payload?: { method?: string; path?: string; status?: number; duration_ms?: number; phase?: string };
}

/** The probe fields the audit reads. */
export interface ProbeView {
  actions: { action: string; state: string; attempt: number }[];
  exec_log: { kind: string; argv: string[] }[];
  fetch_in_flight_max: number;
  board: null | { closed: { recent: { id: string; close_reason: string | null }[] } };
  sessions: { id: string; attached: boolean }[];
}

/** What this run made in gc, and where. */
export interface RunSubjects {
  city: string;
  gcBin: string;
  cityPath: string;
  sessions: string[];
  beads: string[];
  /** The window's start (ISO 8601): earlier events belong to someone else. */
  since: string;
}

/** gc's own view of this run's subjects. */
export interface GcState {
  beads: { id: string; close_reason: string | null }[];
  sessions: { id: string; attached: boolean }[];
}

export interface AuthorityInput {
  run: RunSubjects;
  probe: ProbeView;
  events: GcEvent[];
  gc: GcState;
}

export interface AuthorityAudit {
  findings: string[];
  /** Successful writes to the city in the window. */
  writes: number;
}

/** The most fetches the mod may have in flight at once. */
export const FETCH_IN_FLIGHT_BOUND = 2;
/**
 * How long gc may take between measuring a request's duration and stamping its
 * supervisor.request event (it logs and records metrics in between): a write's
 * start is its stamp less duration_ms less this. Seen at about 2 ms on a runner.
 */
export const RECORD_LAG_MS = 50;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface Write {
  method: string;
  path: string;
  status: number;
  start: number;
  end: number;
  ts: string;
  by: string | null;
}

/** An action kind's write: the path pattern and, for the report, its shape. Optional writes need not happen. */
interface Rule {
  shape: string;
  match: (path: string) => boolean;
  required: boolean;
}

function rules(city: string): ReadonlyMap<string, Rule> {
  const base = `/v0/city/${city}`;
  const sessionPath = (verb: string) => (p: string) => new RegExp(`^${escape(base)}/session/[^/]+/${verb}$`).test(p);
  const submit: Rule = { shape: `POST ${base}/session/{id}/submit`, match: sessionPath("submit"), required: true };
  return new Map<string, Rule>([
    ["session.new", { shape: `POST ${base}/sessions`, match: (p) => p === `${base}/sessions`, required: true }],
    ["session.wake", { shape: `POST ${base}/session/{id}/wake`, match: sessionPath("wake"), required: true }],
    ["session.attach", { shape: `POST ${base}/session/{id}/wake`, match: sessionPath("wake"), required: false }],
    ["session.submit", submit],
    ["session.interrupt", submit],
    // The open detail pane's keep-awake (src/sync/keepAwake.ts): its pin, and the unpin once no pane is open.
    ["session.keep-awake", { shape: `POST ${base}/session/{id}/pin`, match: sessionPath("pin"), required: true }],
    ["session.keep-awake-release", { shape: `POST ${base}/session/{id}/unpin`, match: sessionPath("unpin"), required: true }],
    ["bead.create", { shape: `POST ${base}/beads`, match: (p) => p === `${base}/beads`, required: true }],
  ]);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Milliseconds since the epoch; gc writes nanoseconds, which Date.parse may refuse. */
export function epochMs(ts: string): number {
  const ms = Date.parse(ts.replace(/(\.\d{3})\d+/, "$1"));
  if (Number.isNaN(ms)) throw new Error(`timestamp ${JSON.stringify(ts)} does not parse`);
  return ms;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loopbackUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function allowed(e: { kind: string; argv: string[] }, run: RunSubjects): boolean {
  const a = e.argv;
  switch (e.kind) {
    case "exec":
      if ((a[0] === run.gcBin || a[0] === "gc") && same(a.slice(1), ["supervisor", "status", "--json"])) return true;
      return a.length === 2 && (a[0] === "xdg-open" || a[0] === "open") && loopbackUrl(a[1]!);
    case "run": {
      if (a.length === 2 && a[0] === "tab.select" && a[1] !== "") return true;
      const head = ["tab.new", ...HC_SCRUB, run.gcBin, "--city", run.cityPath, "session", "attach"];
      if (!same(a.slice(0, head.length), head)) return false;
      const rest = a.slice(head.length);
      return run.sessions.includes(rest[0] ?? "") && (rest.length === 1 || (rest.length === 2 && rest[1] === NO_START_FLAG));
    }
    case "notify":
      return a.length === 0 || same(a, ["mod.open", "gascity"]);
    default:
      return false;
  }
}

function writesOf(events: readonly GcEvent[], run: RunSubjects, since: number): Write[] {
  const prefix = `/v0/city/${run.city}/`;
  const out: Write[] = [];
  for (const e of events) {
    const p = e.payload;
    if (e.type !== "supervisor.request" || p?.phase !== "complete" || p.method === undefined || p.path === undefined) continue;
    if (!MUTATING.has(p.method) || !p.path.startsWith(prefix)) continue;
    const status = p.status ?? 0;
    if (status < 200 || status > 299) continue;
    const end = epochMs(e.ts);
    // The event is stamped after completion; the request began duration_ms (truncated) and the record's lag earlier.
    const start = end - (p.duration_ms ?? 0) - 1 - RECORD_LAG_MS;
    if (start < since) continue;
    out.push({ method: p.method, path: p.path, status, start, end, ts: e.ts, by: null });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The bead events that change a run's bead, and those of a session bead the mod (not the controller) causes. */
const BEAD_CHANGES = new Set(["bead.created", "bead.updated", "bead.closed", "bead.deleted"]);
const SESSION_CHANGES = new Set(["bead.created", "bead.closed", "bead.deleted"]);

function explains(w: Write, type: string, subject: string, kind: "bead" | "session", city: string): boolean {
  const base = `/v0/city/${city}`;
  if (type === "bead.created") return w.method === "POST" && w.path === (kind === "bead" ? `${base}/beads` : `${base}/sessions`);
  return w.path === `${base}/${kind}/${subject}` || w.path.startsWith(`${base}/${kind}/${subject}/`);
}

/** Runs the audit. */
export function auditAuthority(input: AuthorityInput): AuthorityAudit {
  const { run, probe } = input;
  const findings: string[] = [];
  const since = epochMs(run.since);

  for (const e of probe.exec_log) {
    if (!allowed(e, run)) findings.push(`exec_log: ${e.kind} ${JSON.stringify(e.argv)} is not on the allowlist`);
  }

  const writes = writesOf(input.events, run, since);
  const byKind = rules(run.city);
  // Required writes first, so an optional rule never takes a write a required one needs.
  const actions = [...probe.actions].sort((a, b) => Number(byKind.get(b.action)?.required ?? false) - Number(byKind.get(a.action)?.required ?? false));
  for (const a of actions) {
    if (a.state === "not-sent") continue;
    const rule = byKind.get(a.action);
    if (rule === undefined) {
      findings.push(`action ${a.action}: the audit has no rule for this kind`);
      continue;
    }
    let taken = 0;
    for (const w of writes) {
      if (taken >= Math.max(a.attempt, 1)) break;
      if (w.by === null && rule.match(w.path)) {
        w.by = a.action;
        taken++;
      }
    }
    if (taken === 0 && a.state === "done" && rule.required) findings.push(`action ${a.action} is done but gc saw no ${rule.shape}`);
  }
  for (const w of writes) {
    if (w.by === null && w.method === "POST" && run.beads.some((b) => w.path === `/v0/city/${run.city}/bead/${b}/close`)) w.by = "canary agent";
  }
  for (const w of writes) {
    if (w.by === null) findings.push(`write ${w.method} ${w.path} (${w.status}) at ${w.ts} is not accounted for by any action`);
  }

  for (const e of input.events) {
    if (e.city !== run.city || e.subject === undefined) continue;
    const kind = run.beads.includes(e.subject) ? "bead" : run.sessions.includes(e.subject) ? "session" : null;
    if (kind === null || !(kind === "bead" ? BEAD_CHANGES : SESSION_CHANGES).has(e.type)) continue;
    const ts = epochMs(e.ts);
    if (ts < since) continue;
    if (!writes.some((w) => w.start <= ts && explains(w, e.type, e.subject!, kind, run.city))) {
      findings.push(`event ${e.type} for ${e.subject} at ${e.ts} has no write before it`);
    }
  }

  if (probe.fetch_in_flight_max > FETCH_IN_FLIGHT_BOUND) {
    findings.push(`fetch_in_flight_max is ${probe.fetch_in_flight_max}, over the bound of ${FETCH_IN_FLIGHT_BOUND}`);
  }

  const closed = probe.board?.closed.recent ?? [];
  for (const b of run.beads) {
    const shown = closed.find((c) => c.id === b);
    const theirs = input.gc.beads.find((g) => g.id === b);
    if (shown === undefined) findings.push(`bead ${b}: the mod does not show it as closed`);
    else if (theirs === undefined) findings.push(`bead ${b}: gc does not have it`);
    else if (shown.close_reason !== theirs.close_reason) {
      findings.push(`bead ${b}: the mod shows close reason ${JSON.stringify(shown.close_reason)}, gc has ${JSON.stringify(theirs.close_reason)}`);
    }
  }
  for (const s of run.sessions) {
    const shown = probe.sessions.find((p) => p.id === s);
    const theirs = input.gc.sessions.find((g) => g.id === s);
    if (shown === undefined) findings.push(`session ${s}: the mod does not show it`);
    else if (theirs === undefined) findings.push(`session ${s}: gc does not have it`);
    else if (shown.attached !== theirs.attached) findings.push(`session ${s}: the mod shows attached ${shown.attached}, gc has ${theirs.attached}`);
  }

  return { findings, writes: writes.length };
}

/** How long the CLI lets gc's events and the mod's probe settle before it reports. */
const SETTLE_MS = 30_000;

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function gather(api: string, run: RunSubjects, probePath: string): Promise<AuthorityInput> {
  const window = Math.ceil((Date.now() - epochMs(run.since)) / 1000) + 60;
  const listed = (await getJson(`${api}/v0/events?since=${window}s`)) as { items: GcEvent[] };
  const base = `${api}/v0/city/${encodeURIComponent(run.city)}`;
  const beads = await Promise.all(run.beads.map(async (id) => (await getJson(`${base}/bead/${encodeURIComponent(id)}`)) as GcState["beads"][number]));
  const sessions = await Promise.all(run.sessions.map(async (id) => (await getJson(`${base}/session/${encodeURIComponent(id)}`)) as GcState["sessions"][number]));
  const probe = JSON.parse(await Bun.file(probePath).text()) as ProbeView;
  return { run, probe, events: listed.items, gc: { beads, sessions } };
}

async function main(): Promise<number> {
  const { parseArgs } = await import("node:util");
  const { values } = parseArgs({
    options: {
      api: { type: "string" },
      probe: { type: "string" },
      city: { type: "string" },
      "gc-bin": { type: "string" },
      "city-path": { type: "string" },
      session: { type: "string", multiple: true, default: [] },
      bead: { type: "string", multiple: true, default: [] },
      since: { type: "string" },
      out: { type: "string" },
    },
  });
  const need = (k: keyof typeof values): string => {
    const v = values[k];
    if (typeof v !== "string" || v === "") throw new Error(`--${k} is required`);
    return v;
  };
  const run: RunSubjects = {
    city: need("city"), gcBin: need("gc-bin"), cityPath: need("city-path"),
    sessions: values.session as string[], beads: values.bead as string[], since: need("since"),
  };
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    const input = await gather(need("api"), run, need("probe"));
    const audit = auditAuthority(input);
    if (audit.findings.length === 0 || Date.now() >= deadline) {
      if (values.out !== undefined) await Bun.write(values.out, `${JSON.stringify({ ...audit, input }, null, 2)}\n`);
      console.log(`authority: ${audit.writes} write(s) to ${run.city}, ${input.probe.actions.length} action(s), ${input.probe.exec_log.length} exec_log entr(ies), ${audit.findings.length} finding(s)`);
      for (const f of audit.findings) console.log(`  FINDING ${f}`);
      return audit.findings.length === 0 ? 0 : 1;
    }
    await Bun.sleep(2000);
  }
}

if (import.meta.main) {
  main().then((code) => process.exit(code), (e: unknown) => {
    console.error(`authority: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  });
}

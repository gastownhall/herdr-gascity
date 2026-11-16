// canary/gc-authority.ts: the S13 audit. Every gc state change the run saw
// must trace back to a write the mod's probe shows as sent (or the canary
// agent's own close), every write must be accounted for, every program the
// mod ran must be on its allowlist, and the mod and gc must agree on what
// the run changed.

import { describe, expect, test } from "bun:test";
import { auditAuthority, type AuthorityInput, type GcEvent } from "../../../canary/gc-authority.ts";

const CITY = "canary";
const SESSION = "cn-1a2b";
const BEAD = "cn-9z8y";
const CITY_PATH = "/tmp/run/city";
const GC = "/opt/gc/bin/gc";
const T0 = Date.parse("2026-11-16T05:20:00Z");

const at = (s: number) => new Date(T0 + s * 1000).toISOString();

function request(s: number, method: string, path: string, status = 200, durationMs = 5): GcEvent {
  return { type: "supervisor.request", ts: at(s), city: "__supervisor__", payload: { method, path, status, duration_ms: durationMs, phase: "complete" } };
}

function event(s: number, type: string, subject: string, city = CITY): GcEvent {
  return { type, ts: at(s), city, subject };
}

const ATTACH_ARGV = ["tab.new", "env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET", GC, "--city", CITY_PATH, "session", "attach", SESSION];

/** A run that did everything right: create a session, attach, create a bead, send the close line; the agent closed the bead. */
function good(): AuthorityInput {
  return {
    run: { city: CITY, gcBin: GC, cityPath: CITY_PATH, sessions: [SESSION], beads: [BEAD], since: at(0) },
    probe: {
      actions: [
        { action: "session.submit", state: "done", attempt: 1 },
        { action: "bead.create", state: "done", attempt: 1 },
        { action: "session.attach", state: "done", attempt: 1 },
        { action: "session.new", state: "done", attempt: 1 },
      ],
      exec_log: [
        { kind: "exec", argv: [GC, "supervisor", "status", "--json"] },
        { kind: "notify", argv: [] },
        { kind: "notify", argv: ["mod.open", "gascity"] },
        { kind: "run", argv: ATTACH_ARGV },
        { kind: "run", argv: ["tab.select", "t-4"] },
      ],
      fetch_in_flight_max: 2,
      board: { closed: { recent: [{ id: BEAD, close_reason: "canary n-1" }] } },
      sessions: [{ id: SESSION, attached: true }],
    },
    events: [
      request(-5, "POST", "/v0/city/other/beads", 201),
      request(1, "GET", `/v0/city/${CITY}/sessions`),
      request(2, "POST", `/v0/city/${CITY}/sessions`, 202),
      event(2.1, "bead.created", SESSION),
      event(3, "session.woke", SESSION),
      event(3.5, "bead.updated", SESSION),
      request(4, "POST", `/v0/city/${CITY}/session/${SESSION}/wake`),
      request(6, "POST", `/v0/city/${CITY}/beads`, 201, 10),
      event(5.995, "bead.created", BEAD),
      request(7, "POST", `/v0/city/${CITY}/session/${SESSION}/submit`, 202),
      request(8, "POST", `/v0/city/${CITY}/bead/${BEAD}/close`),
      event(8, "bead.closed", BEAD),
      event(9, "bead.created", "cn-order-1"),
    ],
    gc: { beads: [{ id: BEAD, close_reason: "canary n-1" }], sessions: [{ id: SESSION, attached: true }] },
  };
}

const findings = (i: AuthorityInput) => auditAuthority(i).findings;

describe("auditAuthority", () => {
  test("a clean run has no findings and accounts for every write", () => {
    const a = auditAuthority(good());
    expect(a.findings).toEqual([]);
    expect(a.writes).toBe(5);
  });

  test("a program outside the allowlist is a finding", () => {
    const i = good();
    i.probe.exec_log.push({ kind: "exec", argv: ["sh", "-c", "id"] });
    i.probe.exec_log.push({ kind: "exec", argv: [GC, "session", "kill", SESSION] });
    i.probe.exec_log.push({ kind: "exec", argv: ["xdg-open", "https://example.com/"] });
    expect(findings(i)).toEqual([
      'exec_log: exec ["sh","-c","id"] is not on the allowlist',
      `exec_log: exec ${JSON.stringify([GC, "session", "kill", SESSION])} is not on the allowlist`,
      'exec_log: exec ["xdg-open","https://example.com/"] is not on the allowlist',
    ]);
  });

  test("the allowlist takes the dashboard opener on a loopback URL and an attach with --no-start", () => {
    const i = good();
    i.probe.exec_log.push({ kind: "exec", argv: ["xdg-open", "http://127.0.0.1:8372/"] });
    i.probe.exec_log.push({ kind: "run", argv: [...ATTACH_ARGV, "--no-start"] });
    expect(findings(i)).toEqual([]);
  });

  test("an attach without the HC_* scrub, into another city, or with an extra argument is a finding", () => {
    const i = good();
    i.probe.exec_log.push({ kind: "run", argv: ["tab.new", GC, "--city", CITY_PATH, "session", "attach", SESSION] });
    i.probe.exec_log.push({ kind: "run", argv: ATTACH_ARGV.map((a) => (a === CITY_PATH ? "/elsewhere" : a)) });
    i.probe.exec_log.push({ kind: "run", argv: [...ATTACH_ARGV, "--force"] });
    expect(findings(i)).toHaveLength(3);
  });

  test("a done action with no write behind it is a finding", () => {
    const i = good();
    i.events = i.events.filter((e) => !(e.type === "supervisor.request" && e.payload?.path === `/v0/city/${CITY}/session/${SESSION}/submit`));
    expect(findings(i)).toEqual(["action session.submit is done but gc saw no POST /v0/city/canary/session/{id}/submit"]);
  });

  test("a write no action accounts for is a finding (the mod wrote more than it showed)", () => {
    const i = good();
    i.events.push(request(10, "POST", `/v0/city/${CITY}/beads`, 201));
    expect(findings(i)).toEqual([`write POST /v0/city/${CITY}/beads (201) at ${at(10)} is not accounted for by any action`]);
  });

  test("a retried action may account for one write per attempt", () => {
    const i = good();
    i.probe.actions[0] = { action: "session.submit", state: "done", attempt: 2 };
    i.events.push(request(7.5, "POST", `/v0/city/${CITY}/session/${SESSION}/submit`, 202));
    expect(findings(i)).toEqual([]);
  });

  test("the open pane's keep-awake pin and its release each account for their own write", () => {
    const i = good();
    i.probe.actions.push({ action: "session.keep-awake", state: "done", attempt: 1 }, { action: "session.keep-awake-release", state: "done", attempt: 1 });
    i.events.push(request(4.5, "POST", `/v0/city/${CITY}/session/${SESSION}/pin`), request(9, "POST", `/v0/city/${CITY}/session/${SESSION}/unpin`));
    expect(auditAuthority(i)).toEqual({ findings: [], writes: 7 });
  });

  test("a pin no keep-awake action shows is a finding, and a done keep-awake needs its pin", () => {
    const i = good();
    i.events.push(request(4.5, "POST", `/v0/city/${CITY}/session/${SESSION}/pin`));
    i.probe.actions.push({ action: "session.keep-awake-release", state: "done", attempt: 1 });
    expect(findings(i)).toEqual([
      `action session.keep-awake-release is done but gc saw no POST /v0/city/${CITY}/session/{id}/unpin`,
      `write POST /v0/city/${CITY}/session/${SESSION}/pin (200) at ${at(4.5)} is not accounted for by any action`,
    ]);
  });

  test("a write that gc refused changed nothing and needs no account", () => {
    const i = good();
    i.events.push(request(10, "POST", `/v0/city/${CITY}/beads`, 409));
    expect(findings(i)).toEqual([]);
  });

  test("a bead change with no write before it is a finding (a change through another path)", () => {
    const i = good();
    i.events = i.events.filter((e) => e.payload?.path !== `/v0/city/${CITY}/bead/${BEAD}/close`);
    expect(findings(i)).toEqual([`event bead.closed for ${BEAD} at ${at(8)} has no write before it`]);
  });

  test("a write that only starts after the change does not explain it", () => {
    const i = good();
    i.events = i.events.map((e) => (e.type === "bead.closed" ? event(7.9, "bead.closed", BEAD) : e));
    expect(findings(i)).toEqual([`event bead.closed for ${BEAD} at ${at(7.9)} has no write before it`]);
  });

  test("an action of a kind the audit does not know fails closed", () => {
    const i = good();
    i.probe.actions.push({ action: "city.unregister", state: "done", attempt: 1 });
    expect(findings(i)).toEqual(["action city.unregister: the audit has no rule for this kind"]);
  });

  test("an action that was never sent needs no write", () => {
    const i = good();
    i.probe.actions.push({ action: "bead.create", state: "not-sent", attempt: 0 });
    expect(findings(i)).toEqual([]);
  });

  test("more than two fetches in flight is a finding", () => {
    const i = good();
    i.probe.fetch_in_flight_max = 3;
    expect(findings(i)).toEqual(["fetch_in_flight_max is 3, over the bound of 2"]);
  });

  test("the mod and gc disagree on the bead's close reason or the session's attach", () => {
    const i = good();
    i.gc = { beads: [{ id: BEAD, close_reason: "something else" }], sessions: [{ id: SESSION, attached: false }] };
    expect(findings(i)).toEqual([
      `bead ${BEAD}: the mod shows close reason "canary n-1", gc has "something else"`,
      `session ${SESSION}: the mod shows attached true, gc has false`,
    ]);
  });

  test("a subject the mod does not show at all is a finding", () => {
    const i = good();
    i.probe.board = { closed: { recent: [] } };
    i.probe.sessions = [];
    expect(findings(i)).toEqual([`bead ${BEAD}: the mod does not show it as closed`, `session ${SESSION}: the mod does not show it`]);
  });

  test("events before the run's start are out of the window", () => {
    const i = good();
    i.events.push(event(-1, "bead.closed", BEAD), request(-2, "POST", `/v0/city/${CITY}/beads`, 201));
    expect(findings(i)).toEqual([]);
  });
});

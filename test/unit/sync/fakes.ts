// Test doubles for the sync engine:
//   - FakeClock: time and one-shot timers that move only when a test
//     advances them (for the pure modules);
//   - FakeHost: herdr's task ownership (gpui-shell scheduler): every async
//     host operation — fetch, sleep, a periodic timer — belongs to the copy
//     whose code is running when it starts; its completion is resumed in
//     that copy's scope, which then drains every queued JS job; closing a
//     copy runs its close in its scope, drains, and cancels every task it
//     owns, whose promises then never settle. The sync engine must work
//     under this rule;
//   - FakeGc: answers from the recorded contract fixtures through a
//     herdr-shaped fetch (no headers, whole body), and can hold a request
//     open to model herdr's blocking pool thread.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostFetch, HostRequest, HostResponse } from "../../../src/gc/client.ts";
import type { Clock } from "../../../src/sync/clock.ts";

/** Lets every queued promise reaction run. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

interface PendingTimer {
  at: number;
  seq: number;
  resolve: () => void;
}

/** A clock and one-shot timers that only move when the test calls advance(). */
export class FakeClock implements Clock {
  private t: number;
  private seq = 0;
  private timers: PendingTimer[] = [];

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  after(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({ at: this.t + Math.max(0, ms), seq: this.seq++, resolve });
    });
  }

  /** Moves time forward by `ms`, firing every timer due on the way in order, and lets promise reactions run between them. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await flush();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.resolve();
      await flush();
    }
    this.t = target;
    await flush();
  }
}

/** A copy of the mod, as herdr's scheduler knows it. */
export type Owner = string;

interface HostTimer {
  at: number;
  seq: number;
  owner: Owner | null;
  fire: () => void;
  /** Set for a periodic timer: re-armed after each call. */
  every?: number;
}

/** herdr's task ownership over a fake clock (see the header). */
export class FakeHost implements Clock {
  /** The copy whose scope is entered, or null for host code. */
  current: Owner | null = null;
  readonly closed = new Set<Owner>();
  /** Host completions that never ran because their owner had closed. */
  cancelled = 0;
  /** Each fetch's path and owner, in start order. */
  readonly starts: { path: string; owner: Owner | null }[] = [];
  private t: number;
  private seq = 0;
  private timers: HostTimer[] = [];
  private turns: { owner: Owner | null; settle: () => void }[] = [];

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  /** herdr's fetch over `inner`: owned by the ambient copy; its completion is a host turn in that copy's scope. */
  wrap(inner: HostFetch): HostFetch {
    return (url, init) => {
      const owner = this.current;
      this.starts.push({ path: new URL(url).pathname, owner });
      const p = inner(url, init);
      return new Promise<HostResponse>((resolve, reject) => {
        p.then(
          (r) => this.turns.push({ owner, settle: () => resolve(r) }),
          (e: unknown) => this.turns.push({ owner, settle: () => reject(e) }),
        );
      });
    };
  }

  /** cx.sleep: owned by the ambient copy. */
  sleep(ms: number): Promise<void> {
    const owner = this.current;
    return new Promise((resolve) => this.timers.push({ at: this.t + Math.max(0, ms), seq: this.seq++, owner, fire: resolve }));
  }

  /** A periodic timer (cx.timer.every with a handler): owned by the ambient copy; `fn` runs in its scope. */
  every(ms: number, fn: () => void): void {
    this.timers.push({ at: this.t + ms, seq: this.seq++, owner: this.current, fire: fn, every: ms });
  }

  /** Runs `body` in `owner`'s scope and drains every queued job there; nothing if the owner has closed. */
  async run(owner: Owner | null, body: () => void): Promise<void> {
    if (owner !== null && this.closed.has(owner)) {
      this.cancelled++;
      return;
    }
    const prev = this.current;
    this.current = owner;
    try {
      body();
      await flush();
    } finally {
      this.current = prev;
    }
  }

  /** Closes a copy: `onClose` in its scope, drain, then cancel every task it owns. */
  async close(owner: Owner, onClose: () => void): Promise<void> {
    await this.run(owner, onClose);
    this.closed.add(owner);
    this.timers = this.timers.filter((t) => t.owner !== owner);
    await this.runTurns();
  }

  /** Runs pending host completions, each in its owner's scope. */
  async runTurns(): Promise<void> {
    await flush();
    while (this.turns.length > 0) {
      const turn = this.turns.shift() as { owner: Owner | null; settle: () => void };
      await this.run(turn.owner, turn.settle);
    }
  }

  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await this.runTurns();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      if (next.every !== undefined) this.timers.push({ ...next, at: this.t + next.every, seq: this.seq++ });
      await this.run(next.owner, next.fire);
      await this.runTurns();
    }
    this.t = target;
    await this.runTurns();
  }
}

const FIXTURES = join(import.meta.dir, "..", "..", "contract", "fixtures");

/** The recorded body of one contract fixture. */
export function fixtureBody(op: string, name: string): unknown {
  const f = JSON.parse(readFileSync(join(FIXTURES, op, `${name}.json`), "utf8")) as { body: unknown };
  return f.body;
}

/** One request as the fake gc saw it. */
export interface SeenRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  init: HostRequest;
  at: number;
}

/** A scripted answer: a JSON body, a transport failure, or a request held open until released. */
export type FakeReply =
  | { status: number; body: unknown; finalUrl?: string }
  | { reject: string }
  | { hold: true };

/** A gc event as the fake serves it. */
export interface FakeEvent {
  seq: number;
  type: string;
  subject?: string;
}

/**
 * A fake gc API at one loopback URL. By default it serves the recorded
 * fixtures for every read the store makes, an event log in `events`, and
 * counts requests in flight.
 */
export class FakeGc {
  readonly seen: SeenRequest[] = [];
  events: FakeEvent[] = [];
  /** Total = LatestSeq; by default the newest event's seq. */
  total: number | null = null;
  inFlight = 0;
  maxInFlight = 0;
  /** Per-path override; return undefined to use the default. */
  override: ((req: SeenRequest) => FakeReply | undefined) | null = null;
  private held: { resolve: (r: HostResponse) => void; reject: (e: unknown) => void; url: string }[] = [];

  constructor(readonly clock: Clock, readonly base = "http://127.0.0.1:8372") {}

  readonly fetch: HostFetch = (url, init) => {
    const u = new URL(url);
    const req: SeenRequest = { method: init.method, path: u.pathname, query: u.searchParams, init, at: this.clock.now() };
    this.seen.push(req);
    const reply = this.override?.(req) ?? this.defaultReply(req);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const done = <T>(v: T): T => {
      this.inFlight--;
      return v;
    };
    if ("hold" in reply) {
      return new Promise<HostResponse>((resolve, reject) => {
        this.held.push({ resolve: (r) => resolve(done(r)), reject: (e) => reject(done(e)), url });
      });
    }
    if ("reject" in reply) return Promise.reject(new Error(reply.reject)).catch((e: unknown) => Promise.reject(done(e)));
    return Promise.resolve(done(response(reply.finalUrl ?? url, reply.status, reply.body)));
  };

  /** Requests held open right now. */
  heldCount(): number {
    return this.held.length;
  }

  /** Answers the oldest held request. */
  release(status = 200, body: unknown = { items: [], total: 0 }): void {
    const h = this.held.shift();
    if (!h) throw new Error("no held request");
    h.resolve(response(h.url, status, body));
  }

  /** Fails the oldest held request the way herdr's fetch fails a dead connection. */
  failHeld(message = "error sending request: connection refused"): void {
    const h = this.held.shift();
    if (!h) throw new Error("no held request");
    h.reject(new Error(message));
  }

  /** Appends events with the next seqs. */
  emit(...events: { type: string; subject?: string }[]): void {
    for (const e of events) {
      const seq = (this.events.at(-1)?.seq ?? this.total ?? 0) + 1;
      this.events.push({ seq, ...e });
    }
    this.total = null;
  }

  /** Requests whose path ends with `suffix` (e.g. "/sessions"). */
  count(suffix: string, since = 0): number {
    return this.seen.slice(since).filter((r) => r.path.endsWith(suffix)).length;
  }

  paths(since = 0): string[] {
    return this.seen.slice(since).map((r) => `${r.path}${r.query.size > 0 ? `?${r.query.toString()}` : ""}`);
  }

  private latest(): number {
    return this.total ?? this.events.at(-1)?.seq ?? 0;
  }

  private defaultReply(req: SeenRequest): FakeReply {
    const p = req.path;
    if (p === "/health") return { status: 200, body: fixtureBody("get-health", "ok") };
    if (p === "/v0/cities") return { status: 200, body: fixtureBody("get-v0-cities", "ok") };
    if (p.endsWith("/events")) {
      const limit = Number(req.query.get("limit") ?? "50");
      const items = [...this.events].sort((a, b) => b.seq - a.seq).slice(0, limit).map((e) => ({
        seq: e.seq, type: e.type, ts: "2026-11-09T00:00:00Z", actor: "test", ...(e.subject ? { subject: e.subject } : {}), payload: {},
      }));
      return { status: 200, body: { items, total: this.latest() } };
    }
    if (p.endsWith("/sessions")) {
      const name = req.query.get("wake_reasons") === "true" ? "wake-reasons" : "ok";
      return { status: 200, body: fixtureBody("get-v0-city-by-city-name-sessions", name) };
    }
    if (/\/session\/[^/]+\/pending$/.test(p)) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-session-by-id-pending", "none") };
    if (p.endsWith("/pending")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-pending", "ok") };
    if (p.endsWith("/rigs")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-rigs", "ok") };
    if (p.endsWith("/agents")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-agents", "ok") };
    if (p.endsWith("/work/ready")) {
      const status = req.query.get("status");
      const name = status === "closed" ? "closed-seed" : status === "in_progress" ? "in-progress" : "ready";
      return { status: 200, body: fixtureBody("get-v0-city-by-city-name-work-ready", name) };
    }
    const bead = /\/bead\/([^/]+)$/.exec(p);
    if (bead) {
      const body = fixtureBody("get-v0-city-by-city-name-bead-by-id", "ok") as Record<string, unknown>;
      return { status: 200, body: { ...body, id: decodeURIComponent(bead[1] ?? "") } };
    }
    const session = /\/session\/([^/]+)$/.exec(p);
    if (session) {
      const body = fixtureBody("get-v0-city-by-city-name-session-by-id", "peek") as Record<string, unknown>;
      return { status: 200, body: { ...body, id: decodeURIComponent(session[1] ?? "") } };
    }
    return { status: 404, body: { title: "Not Found", status: 404, detail: `no route ${p}` } };
  }
}

function response(url: string, status: number, body: unknown): HostResponse {
  const text = JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, url, text: () => Promise.resolve(text) };
}

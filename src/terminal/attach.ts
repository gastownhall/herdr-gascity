// Open terminal, today: wake through gc's API, then an attach tab.
//
// herdr-core kills every process carrying a terminal's HC_SCOPE token when
// that terminal's holder dies, so gc must never start a session's runtime
// inside the tab: `gc session attach` on a session that is not running starts
// it in the CLI process. So, as one action in the city's activity log:
//   1. GET the session; if gc says it is not running, POST …/wake (with the
//      action's Idempotency-Key) so the controller starts it from its own
//      environment, then GET it at 0.5 s, 1 s, then every 2 s until gc says
//      `running`, for at most WAKE_DEADLINE_MS. A refused wake, or a session
//      still not running at the deadline, opens no tab;
//   2. find a local space (the active one if it is on this computer, else the
//      first local one; never a remote machine's space, where the attach
//      would run on another host);
//   3. dedupe: a terminal in a local space still running our attach (its
//      program is not the shell: herdr's wrapper `exec`s a shell when the
//      attach exits) gets its tab selected; anything else gets a new tab
//      running attachArgv (`env -u HC_* gc --city <path> session attach <id>`,
//      plus `--no-start` when gc has it);
//   4. confirm through herdr's terminal list (run() returns nothing): a new
//      terminal running the attach within CONFIRM_WITHIN_MS (else not-seen),
//      still running it EXIT_WATCH_MS after the tab opened (else
//      attach-exited: gc's reason is in the tab, which stays open as a shell).
//
// Its only gc mutation is the wake; its only herdr commands are tab.new and
// tab.select, through host.ts, which checks the argv shape again.

import type { ActionSpec, Sent, Watch, WatchEnd } from "../actions/activity.ts";
import type { GcClient } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { OPERATIONS } from "../gc/operations.gen.ts";
import * as ops from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";
import type { HostScene, HostSpace, HostTerminal } from "../host.schemas.ts";
import { err, ok, type Result } from "../result.ts";
import type { Clock } from "../sync/clock.ts";
import type { Domain } from "../sync/invalidate.ts";
import { errorText } from "../vm/errorText.ts";
import { attachArgv, isAttachOf } from "./argv.ts";
import type { TerminalBinding } from "./binding.ts";

/** Polls of a woken session's state, each measured from the previous answer… */
export const WAKE_POLL_DELAYS_MS: readonly number[] = [500, 1000];
/** …then this between polls… */
export const WAKE_POLL_EVERY_MS = 2000;
/** …until this long after gc answered the wake: then no tab is opened. */
export const WAKE_DEADLINE_MS = 60_000;
/** A new tab's attach must show in herdr's terminal list within this long after tab.new… */
export const CONFIRM_WITHIN_MS = 5000;
/** …and still be the terminal's program this long after it (else it exited: see the tab). */
export const EXIT_WATCH_MS = 10_000;
/** How often the terminal list is read while confirming (a copy's tick). */
export const CONFIRM_POLL_MS = 250;

/** A wake changes the session list and the agents' roll-up. */
const LIFECYCLE: readonly Domain[] = ["sessions", "agents"];

/** What open terminal needs from herdr (host.ts; fakes in tests). */
export interface TerminalHost {
  /** spaces(), panes() and terminals(), decoded. */
  scene(): Result<HostScene, GcError>;
  /** tab.new running an attach argv (host.ts refuses any other argv). */
  openTab(tab: { space: string; name: string; argv: string[] }): Result<null, GcError>;
  /** tab.select. */
  selectTab(tab: string): Result<null, GcError>;
}

export interface OpenDeps {
  host: TerminalHost;
  clock: Clock;
}

/** Where a new attach tab goes: the active space if it is on this computer, else the first space that is; null when none is. */
export function localSpace(spaces: readonly HostSpace[]): HostSpace | null {
  const active = spaces.find((s) => s.active);
  if (active && active.machine === null) return active;
  return spaces.find((s) => s.machine === null) ?? null;
}

/** The terminals shown in a tab of a local space, each with that tab. */
export function localTerminals(scene: HostScene): { terminal: HostTerminal; tab: string }[] {
  const tabs = new Set(scene.spaces.filter((s) => s.machine === null).flatMap((s) => s.tabs.map((t) => t.id)));
  const out: { terminal: HostTerminal; tab: string }[] = [];
  for (const terminal of scene.terminals) {
    const pane = scene.panes.find((p) => p.terminal === terminal.address && tabs.has(p.tab));
    if (pane) out.push({ terminal, tab: pane.tab });
  }
  return out;
}

/** Is this terminal running its program (not finished, not back at the shell)? */
function runsProgram(t: HostTerminal): boolean {
  return t.state === "live" && !t.program.shell;
}

function notStarted(sessionId: string, reason: Extract<GcError, { kind: "attach-not-started" }>["reason"], detail: string): WatchEnd {
  return { kind: "failed", error: { kind: "attach-not-started", sessionId, reason, detail } };
}

/** The session as the log describes it when it is not running: "asleep (idle)". */
function stateText(s: T.SessionResponse): string {
  return s.reason !== undefined && s.reason !== "" ? `${s.state} (${s.reason})` : s.state;
}

/** The "Open terminal" action for a session's binding; `name` is the new tab's name. */
export function openTerminal(binding: TerminalBinding, name: string, deps: OpenDeps): ActionSpec {
  const { target, noStart } = binding;
  const id = target.sessionId;
  const { host, clock } = deps;
  const failed = (error: GcError): WatchEnd => ({ kind: "failed", error });
  const exited = notStarted(id, "attach-exited", "attach failed: see the tab for gc's reason (the tab stays open as a shell)");

  /** Steps 2–3: select the tab still running the attach, or open a new one in a local space. */
  const openOrSelect = (): Watch | WatchEnd => {
    const scene = host.scene();
    if (!scene.ok) return failed(scene.error);
    const local = localTerminals(scene.value);
    const running = local.find((x) => runsProgram(x.terminal) && isAttachOf(x.terminal.argv, target));
    if (running) {
      const selected = host.selectTab(running.tab);
      if (!selected.ok) return failed(selected.error);
      return { kind: "done", detail: `already open: showed its tab (terminal ${running.terminal.address})` };
    }
    const space = localSpace(scene.value.spaces);
    if (space === null) return notStarted(id, "no-local-space", "no local space: open one (space.new)");
    // Terminals that ran this attach before (now shells) are not the new one.
    const before = new Set(scene.value.terminals.filter((t) => isAttachOf(t.argv, target)).map((t) => t.address));
    const opened = host.openTab({ space: space.id, name, argv: attachArgv(target, noStart) });
    if (!opened.ok) return failed(opened.error);
    return confirm(clock.now(), before, null);
  };

  /** Step 4: the new tab's terminal, seen in herdr's list and still running the attach. */
  const confirm = (openedAt: number, before: ReadonlySet<string>, seen: string | null): Watch => ({
    detail: seen === null ? "tab opened: waiting for herdr to list its terminal" : `tab opened: checking the attach keeps running (terminal ${seen})`,
    nextAt: clock.now() + CONFIRM_POLL_MS,
    deadline: openedAt + (seen === null ? CONFIRM_WITHIN_MS : EXIT_WATCH_MS),
    expired: seen === null
      ? notStarted(id, "not-seen-in-terminals", `herdr listed no new terminal running the attach within ${CONFIRM_WITHIN_MS / 1000} s of tab.new`)
      : { kind: "done", detail: `opened in a new tab (terminal ${seen})` },
    abandoned: { kind: "done", detail: "tab opened; not confirmed: the Gas City view that asked closed" },
    step: () => Promise.resolve(confirmStep(openedAt, before, seen)),
  });

  const confirmStep = (openedAt: number, before: ReadonlySet<string>, seen: string | null): Watch | WatchEnd => {
    const scene = host.scene();
    if (!scene.ok) return failed(scene.error);
    const now = clock.now();
    if (seen === null) {
      const mine = localTerminals(scene.value).find((x) => !before.has(x.terminal.address) && isAttachOf(x.terminal.argv, target));
      if (!mine) return confirm(openedAt, before, null);
      if (!runsProgram(mine.terminal)) return exited;
      return now - openedAt >= EXIT_WATCH_MS ? { kind: "done", detail: `opened in a new tab (terminal ${mine.terminal.address})` } : confirm(openedAt, before, mine.terminal.address);
    }
    const t = scene.value.terminals.find((x) => x.address === seen);
    if (!t) return { kind: "done", detail: `opened in a new tab (terminal ${seen}); the tab has since closed` };
    if (!runsProgram(t)) return exited;
    return now - openedAt >= EXIT_WATCH_MS ? { kind: "done", detail: `opened in a new tab (terminal ${seen})` } : confirm(openedAt, before, seen);
  };

  /** Step 1 after the wake: poll until gc says running, then open. */
  const waitRunning = (wokeAt: number, polls: number, last: Result<T.SessionResponse, GcError>): Watch => ({
    detail: `woken: waiting for gc to report session ${id} running`,
    nextAt: clock.now() + (WAKE_POLL_DELAYS_MS[polls] ?? WAKE_POLL_EVERY_MS),
    deadline: wokeAt + WAKE_DEADLINE_MS,
    expired: notStarted(id, "not-running-after-wake", last.ok
      ? `gc did not report the session running within ${WAKE_DEADLINE_MS / 1000} s of the wake; it is ${stateText(last.value)}`
      : `gc did not report the session running within ${WAKE_DEADLINE_MS / 1000} s of the wake; last read failed: ${errorText(last.error)}`),
    abandoned: {
      kind: "not-sent",
      reason: "no tab was opened: the Gas City view that asked closed before gc reported the session running (gc was asked to wake it)",
    },
    step: async (c: GcClient, city: string) => {
      const r = await ops.getSession(c, city, id);
      if (r.ok && r.value.running) return openOrSelect();
      return waitRunning(wokeAt, polls + 1, r);
    },
  });

  const toSent = (next: Watch | WatchEnd): Result<Sent, GcError> => {
    if ("step" in next) return ok({ kind: "watch", watch: next });
    if (next.kind === "failed") return err(next.error);
    if (next.kind === "done") return ok({ kind: "done", detail: next.detail });
    // openOrSelect never ends unsent.
    return err({ kind: "host-call", api: "open terminal", cause: next.reason });
  };

  const send = async (c: GcClient, city: string, key: string): Promise<Result<Sent, GcError>> => {
    const s = await ops.getSession(c, city, id);
    if (!s.ok) return s;
    if (s.value.running) return toSent(openOrSelect());
    const woke = await ops.wakeSession(c, city, id, key);
    if (!woke.ok) {
      // An unknown outcome may have woken it: the log says so and offers a same-key retry.
      if (woke.error.kind === "outcome-unknown") return woke;
      return err({ kind: "attach-not-started", sessionId: id, reason: "wake-refused", detail: errorText(woke.error) });
    }
    return ok({ kind: "watch", watch: waitRunning(clock.now(), 0, s) });
  };

  const wake = "post-v0-city-by-city-name-session-by-id-wake";
  return {
    kind: "session.attach",
    verb: "Open terminal",
    target: { kind: "session", id },
    operationId: wake,
    idempotent: OPERATIONS[wake].idempotencyKey,
    confirm: null,
    refresh: LIFECYCLE,
    send,
  };
}

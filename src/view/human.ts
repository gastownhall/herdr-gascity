// The Needs-a-human region: one row per thing in the city waiting on a
// person, at the top of the panel. Render only: a row's click opens the
// session's detail (its prompt and answer buttons) or the bead's detail (its
// Close… and Sling…), through the same actions as the agents and the board.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import type { ThemeRead } from "../host.ts";
import type { DecisionRow, HumanModel, QuestionRow } from "../vm/human.ts";
import { greyedIf, label, muted } from "./text.ts";

export interface HumanActions {
  /** Opens a session's detail; null closes it. */
  selectSession(id: string | null, cx: GpuiContext): void;
  /** Opens a bead's detail; null closes it. */
  selectBead(id: string | null, cx: GpuiContext): void;
}

/** "? reviewer asks (question) · session gc-12". */
export function questionText(r: QuestionRow): string {
  return `${r.selected ? "▸ " : ""}? ${r.who} asks (${r.what}) · session ${r.session}`;
}

/** "◆ ga-1 · P1 · "Approve the charter" · 3 d · [beadhive] · → mayor". */
export function decisionText(r: DecisionRow): string {
  const parts = [r.bead];
  if (r.priority !== null) parts.push(r.priority);
  parts.push(`"${r.title}"`);
  if (r.age !== null) parts.push(r.age);
  if (r.labels.length > 0) parts.push(`[${r.labels.join(", ")}]`);
  if (r.assignee !== null) parts.push(`→ ${r.assignee}`);
  return `${r.selected ? "▸ " : ""}◆ ${parts.join(" · ")}`;
}

/** "Needs a human · 2 questions · 15 decisions". */
export function humanTitle(m: HumanModel): string {
  const parts = ["Needs a human"];
  if (m.questions > 0) parts.push(`${m.questions} question${m.questions === 1 ? "" : "s"}`);
  if (m.decisions > 0) parts.push(`${m.decisions} decision${m.decisions === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The region; null when there is nothing to show (no rows, no error, loaded). */
export function renderHuman(m: HumanModel, theme: ThemeRead, actions: HumanActions): GpuiElement | null {
  const state = m.region;
  if (state.kind === "ok" && state.error === null && m.rows.length === 0 && m.unreadable.length === 0) return null;
  let region = v_flex().id("gascity-human").gap(4).child(label("gascity-human-title", humanTitle(m)));
  if (state.kind === "loading") region = region.child(muted(label("gascity-human-loading", "loading…"), theme));
  if (state.error !== null) region = region.child(label("gascity-human-error", state.error));
  const rows = m.rows.map((r, i) => {
    const id = `gascity-human-${i}`;
    const el = r.kind === "question"
      ? label(id, questionText(r)).on_click((_, cx) => actions.selectSession(r.selected ? null : r.session, cx))
      : label(id, decisionText(r)).on_click((_, cx) => actions.selectBead(r.selected ? null : r.bead, cx));
    return r.kind === "question" || r.selected ? el : muted(el, theme);
  });
  let body = v_flex().id("gascity-human-body").gap(2).children(rows);
  if (m.more > 0) body = body.child(muted(label("gascity-human-more", `${m.more} more decision${m.more === 1 ? "" : "s"} not listed`), theme));
  m.unreadable.forEach((u, k) => {
    body = body.child(label(`gascity-human-unreadable-${k}`, u));
  });
  return region.child(greyedIf(div().id("gascity-human-data").child(body), state.stale, theme));
}

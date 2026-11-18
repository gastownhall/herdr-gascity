// The run view in the Needs you tab: one formula run's header (PR, title,
// formula · rig · target, Answer, Open in factory ↗), a wide stage strip
// with each stage's name, then its steps (glyph, title, rounds, attempts,
// session, Open on a live session) and the counts. Render only: clicks call
// the actions.

import { h_flex, v_flex } from "gpui-base";
import type { StatusColors, ThemeRead } from "../host.ts";
import type { RunStepRow, RunViewModel, StepTone } from "../vm/runDetail.ts";
import { stageBar } from "./strip.ts";
import { label, muted, pill } from "./text.ts";

export interface RunActions {
  /** Opens the terminal of a session a step names (gc's session name). */
  openRunSession(name: string, cx: GpuiContext): void;
  /** Reads the run again now. */
  refreshRun(cx: GpuiContext): void;
  /** Closes the run view. */
  closeRun(cx: GpuiContext): void;
  /** Opens a link (the run in factory) in the browser. */
  openLink(url: string, cx: GpuiContext): void;
}

function toneColor(tone: StepTone, c: StatusColors): GpuiColor | undefined {
  return tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "bad" ? c.bad : tone === "dim" ? c.dim : undefined;
}

function button(id: string, text: string, _colors: StatusColors, onClick: (cx: GpuiContext) => void): GpuiElement {
  return pill(id, text, onClick);
}

function stepRow(s: RunStepRow, i: number, theme: ThemeRead, colors: StatusColors, actions: RunActions): GpuiElement {
  const id = `gascity-run-step-${i}`;
  const color = toneColor(s.tone, colors);
  let glyph = label(`${id}-glyph`, s.glyph).w(14).flex_none();
  if (color !== undefined) glyph = glyph.text_color(color);
  let title = label(`${id}-title`, s.title).flex_1().min_w_0().overflow_hidden().whitespace_nowrap().text_ellipsis();
  if (s.tone === "dim") title = muted(title, theme);
  else if (s.tone === "bad" && color !== undefined) title = title.text_color(color);
  let attempts = label(`${id}-attempts`, s.attempts ?? "").w(60).flex_none().text_size(12);
  attempts = s.exhausted && colors.bad !== undefined ? attempts.text_color(colors.bad) : muted(attempts, theme);
  let row = h_flex().id(id).gap(8).items_center().py(1).pl(s.depth === 1 ? 22 : 0).min_w_0()
    .child(glyph)
    .child(title);
  if (s.rounds !== null) row = row.child(muted(label(`${id}-rounds`, s.rounds), theme).flex_none().text_size(12));
  row = row.child(attempts);
  const session = label(`${id}-session`, s.session ?? "").w(220).flex_none().text_size(12).overflow_hidden().whitespace_nowrap().text_ellipsis();
  row = row.child(s.live ? session : muted(session, theme));
  const name = s.session;
  if (s.live && name !== null) row = row.child(button(`${id}-open`, "Open", colors, (cx) => actions.openRunSession(name, cx)));
  return row;
}

/** The run view, or null when the window shows no run. */
export function renderRun(m: RunViewModel | null, theme: ThemeRead, colors: StatusColors, actions: RunActions): GpuiElement | null {
  if (m === null) return null;
  const heading = m.ref !== null ? `${m.ref}  ${m.title}` : m.title;
  const buttons: GpuiElement[] = [];
  const answer = m.answer;
  if (answer !== null) buttons.push(button("gascity-run-answer", "Answer", colors, (cx) => actions.openRunSession(answer, cx)));
  const link = m.link;
  if (link !== null) buttons.push(button("gascity-run-factory", "Open in factory ↗", colors, (cx) => actions.openLink(link, cx)));
  buttons.push(button("gascity-run-refresh", "Refresh", colors, (cx) => actions.refreshRun(cx)));
  buttons.push(button("gascity-run-close", "Close run", colors, (cx) => actions.closeRun(cx)));
  const head = h_flex().id("gascity-run-head").gap(8).items_center().min_w_0()
    .child(label("gascity-run-title", heading).flex_1().min_w_0().text_size(15).font_semibold().overflow_hidden().whitespace_nowrap().text_ellipsis())
    .children(buttons);
  let el = v_flex().id("gascity-run").gap(8).pt(4).child(head);
  const sub = [m.sub, `city ${m.city}`].filter((x) => x !== "").join(" · ");
  el = el.child(muted(label("gascity-run-sub", sub), theme).text_size(12));
  if (m.note !== null) {
    let note = label("gascity-run-note", m.note).text_size(12);
    note = m.noteWarn && colors.warn !== undefined ? note.text_color(colors.warn) : muted(note, theme);
    el = el.child(note);
  }
  if (m.stages.length > 0) {
    // A wide strip: each stage a full-width cell, its name under it.
    const cells = m.stages.map((s, i) => v_flex().id(`gascity-run-stage-${i}`).flex_1().min_w_0().gap(3)
      .child(stageBar(`gascity-run-stage-${i}-cell`, s.cell, colors))
      .child(muted(label(`gascity-run-stage-${i}-label`, s.label), theme).text_size(11).overflow_hidden().whitespace_nowrap().text_ellipsis()));
    el = el.child(h_flex().id("gascity-run-stages").gap(6).items_start().children(cells));
  }
  if (m.steps.length > 0) {
    const head2 = h_flex().id("gascity-run-steps-head").gap(8).text_size(12)
      .child(muted(label("gascity-run-steps-h", "Steps"), theme).flex_1())
      .child(muted(label("gascity-run-steps-a", "tries"), theme).w(60).flex_none())
      .child(muted(label("gascity-run-steps-s", "session"), theme).w(220).flex_none());
    el = el.child(v_flex().id("gascity-run-steps").gap(1).child(head2).children(m.steps.map((s, i) => stepRow(s, i, theme, colors, actions))));
  }
  if (m.moreSteps > 0) el = el.child(muted(label("gascity-run-more", `${m.moreSteps} more steps in factory`), theme).text_size(12));
  const foot = [m.counts, m.path !== null ? `worktree ${m.path}` : null].filter((x): x is string => x !== null).join("    ");
  if (foot !== "") el = el.child(muted(label("gascity-run-foot", foot), theme).text_size(12));
  return el;
}

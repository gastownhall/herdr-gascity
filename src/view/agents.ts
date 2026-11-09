// The agents region: data age and error line, banners, rig groups with
// their agents and sessions (status chip, pending, active bead, attached
// eye), "Other sessions", unreadable rows. Stale data is greyed, never
// hidden. Clicking a session opens its detail; clicking a group collapses it.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { ThemeRead } from "../host.ts";
import type { AgentRow, AgentsModel, SessionRow } from "../vm/agents.ts";
import { greyedIf, label, muted } from "./text.ts";

export interface AgentsActions {
  /** Opens a session's detail; the selected one closes it. */
  selectSession(id: string | null, cx: GpuiContext): void;
  toggleGroup(key: string, cx: GpuiContext): void;
}

function statusText(row: { status: { label: string; detail: string | null } }): string {
  return row.status.detail === null ? row.status.label : `${row.status.label} · ${row.status.detail}`;
}

function sessionRow(r: SessionRow, id: string, theme: ThemeRead, actions: AgentsActions): GpuiElement {
  const parts = [r.label, statusText(r)];
  if (r.activeBead !== null) {
    parts.push(r.activeBead.title === null ? `bead ${r.activeBead.id} (${r.activeBead.note ?? ""})` : `bead ${r.activeBead.id} "${r.activeBead.title}"`);
  } else {
    parts.push("no active bead");
  }
  if (r.attached) parts.push("terminal attached");
  const row = h_flex().id(id).gap(8)
    .on_click((_, cx) => actions.selectSession(r.selected ? null : r.id, cx))
    .child(label(`${id}-text`, `${r.selected ? "▸ " : ""}session ${r.id}: ${parts.join(" · ")}`));
  return r.selected ? row : muted(row, theme);
}

function agentRow(a: AgentRow, id: string, theme: ThemeRead, actions: AgentsActions): GpuiElement {
  const head = [a.label];
  if (a.pool !== null) head.push(a.pool);
  head.push(statusText(a));
  const el = v_flex().id(id).gap(2).child(label(`${id}-head`, head.join(" · ")));
  return el.children(a.sessions.map((r, k) => sessionRow(r, `${id}-session-${k}`, theme, actions)));
}

/** The agents region for one model. */
export function renderAgents(m: AgentsModel, theme: ThemeRead, actions: AgentsActions): GpuiElement {
  let region = v_flex().id("gascity-agents").gap(6).child(label("gascity-agents-title", "Agents"));
  const state = m.region;
  if (state.kind === "loading") region = region.child(muted(label("gascity-agents-loading", "loading…"), theme));
  if (state.age !== null) region = region.child(muted(label("gascity-agents-age", state.stale ? `${state.age} (may be out of date)` : state.age), theme));
  if (state.error !== null) region = region.child(label("gascity-agents-error", state.error));
  m.banners.forEach((b, i) => {
    region = region.child(label(`gascity-agents-banner-${i}`, b));
  });
  const groups = m.groups.map((g, i) => {
    const counts = g.counts === null ? (g.listed ? "" : " (not in gc's rig list)") : ` · ${g.counts}`;
    const head = label(`gascity-group-${i}`, `${g.collapsed ? "▸" : "▾"} ${g.title}${g.suspended ? " (suspended)" : ""}${counts}`)
      .on_click((_, cx) => actions.toggleGroup(g.key, cx));
    return v_flex().id(`gascity-group-${i}-body`).gap(4).child(head)
      .children(g.agents.map((a, j) => agentRow(a, `gascity-agent-${i}-${j}`, theme, actions)));
  });
  let body = v_flex().id("gascity-agents-body").gap(6).children(groups);
  if (m.other.length > 0) {
    body = body.child(v_flex().id("gascity-other").gap(2).child(label("gascity-other-title", "Other sessions"))
      .children(m.other.map((r, k) => sessionRow(r, `gascity-other-${k}`, theme, actions))));
  }
  if (m.unreadable.length > 0) {
    body = body.child(v_flex().id("gascity-unreadable").gap(2).children(m.unreadable.map((u, k) => label(`gascity-unreadable-${k}`, u.text))));
  }
  if (state.kind === "ok" && m.groups.length === 0 && m.other.length === 0) body = body.child(muted(label("gascity-agents-empty", "gc lists no agents"), theme));
  return region.child(greyedIf(div().id("gascity-agents-data").child(body), state.stale, theme));
}

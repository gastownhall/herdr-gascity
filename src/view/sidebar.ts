// The cross-city views. Render only: clicks call the actions.
//
//   - the sidebar block: "Cities" with a "N need you" badge, then one row per
//     city (health dot, name, running agents, a chevron to unfold it), and
//     under each city what waits on a person there, always shown;
//   - the Needs a human pane: filter chips (kind, city), then the questions
//     and decisions of every city, each with its buttons.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { StatusColors, ThemeRead } from "../host.ts";
import type { InboxFilter, InboxModel, NeedRow, SidebarCity, SidebarModel, Tone } from "../vm/sidebar.ts";
import { label, muted, themedRoot } from "./text.ts";

export interface CrossCityActions {
  /** Folds or unfolds a city in the sidebar. */
  toggleCity(city: string, cx: GpuiContext): void;
  /** Opens the "needs you" window on a session's question (its prompt and answer buttons). */
  openQuestion(city: string, session: string, cx: GpuiContext): void;
  /** Opens the "needs you" window on a bead (its detail, Close… and Sling…). */
  openDecision(city: string, bead: string, cx: GpuiContext): void;
  /** Opens the Needs a human pane. */
  openInbox(cx: GpuiContext): void;
  /** Narrows the pane to a kind. */
  setFilter(filter: InboxFilter, cx: GpuiContext): void;
  /** Narrows the pane to a city; null for every city. */
  setInboxCity(city: string | null, cx: GpuiContext): void;
  /** Opens a web dashboard link in the browser. */
  openLink(url: string, cx: GpuiContext): void;
}

function toneColor(tone: Tone, c: StatusColors): GpuiColor | undefined {
  return tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "bad" ? c.bad : c.dim;
}

function dot(id: string, tone: Tone, colors: StatusColors): GpuiElement {
  const color = toneColor(tone, colors);
  const el = div().id(id).size(8).flex_none().rounded_full();
  return color === undefined ? el.border_1() : el.bg(color);
}

/** A small rounded count, tinted when it is about questions. */
function badge(id: string, text: string, urgent: boolean, colors: StatusColors): GpuiElement {
  let el = div().id(id).flex_none().px(6).rounded(5).text_size(11).child(text);
  const c = urgent ? colors.bad : colors.dim;
  if (c !== undefined) el = el.text_color(c).bg(`${c}26` as GpuiColor);
  return el;
}

function hoverable(el: GpuiElement, colors: StatusColors): GpuiElement {
  const c = colors.hover;
  return c === undefined ? el : el.hover((s) => s.bg(c));
}

/** "? reviewer · 2 d" over the prompt's first line; "◆ P1 · 3 d" over a bead's title. */
export function rowText(r: NeedRow): { head: string; body: string } {
  if (r.kind === "question") return { head: `? ${r.who}${r.age !== null ? ` · ${r.age}` : ""}`, body: r.text };
  const head = [`◆ ${r.bead}`, r.priority, r.age].filter((x): x is string => x !== null).join(" · ");
  return { head, body: r.title };
}

function needRow(r: NeedRow, id: string, theme: ThemeRead, colors: StatusColors, actions: CrossCityActions): GpuiElement {
  const { head, body } = rowText(r);
  let headEl = label(`${id}-head`, head).text_size(12);
  if (r.kind === "question" && colors.bad !== undefined) headEl = headEl.text_color(colors.bad);
  else headEl = muted(headEl, theme);
  const el = v_flex().id(id).pl(22).pr(6).py(2).rounded(5).min_w_0()
    .child(headEl)
    .child(label(`${id}-body`, body).text_size(12.5).overflow_hidden().whitespace_nowrap().text_ellipsis())
    .on_click((_, cx) => (r.kind === "question" ? actions.openQuestion(r.city, r.session, cx) : actions.openDecision(r.city, r.bead, cx)));
  return hoverable(el, colors);
}

function cityBlock(c: SidebarCity, i: number, theme: ThemeRead, colors: StatusColors, actions: CrossCityActions): GpuiElement {
  const id = `gascity-side-city-${i}`;
  let head = h_flex().id(id).gap(6).items_center().px(6).py(3).rounded(5)
    .child(muted(label(`${id}-chev`, c.expanded ? "▾" : "▸"), theme).w(10).flex_none())
    .child(dot(`${id}-dot`, c.tone, colors))
    .child(label(`${id}-name`, c.name).flex_1().min_w_0().overflow_hidden().whitespace_nowrap().text_ellipsis());
  if (c.questions > 0) head = head.child(badge(`${id}-q`, `${c.questions} ?`, true, colors));
  head = head.child(muted(label(`${id}-meta`, c.meta), theme).text_size(11.5).flex_none())
    .on_click((_, cx) => actions.toggleCity(c.name, cx));
  let el = v_flex().id(`${id}-block`).gap(1).child(hoverable(head, colors));
  el = el.children(c.rows.map((r, k) => needRow(r, `${id}-row-${k}`, theme, colors, actions)));
  if (c.more > 0) {
    el = el.child(hoverable(muted(label(`${id}-more`, `${c.more} more decision${c.more === 1 ? "" : "s"}`), theme)
      .text_size(12).pl(22).py(1).rounded(5).on_click((_, cx) => actions.toggleCity(c.name, cx)), colors));
  }
  if (c.details.length > 0) {
    el = el.child(v_flex().id(`${id}-details`).pl(22).gap(0)
      .children(c.details.map((d, k) => muted(label(`${id}-detail-${k}`, d), theme).text_size(12))));
  }
  const link = c.link;
  if (c.expanded && link !== null) {
    el = el.child(hoverable(label(`${id}-mdash`, "Open in mdash ↗").text_size(12).pl(22).py(1).rounded(5)
      .on_click((_, cx) => actions.openLink(link, cx)), colors));
  }
  return el;
}

/** The sidebar block. */
export function renderSidebar(m: SidebarModel, theme: ThemeRead, colors: StatusColors, actions: CrossCityActions): GpuiElement {
  let head = h_flex().id("gascity-side-head").gap(6).items_center().px(6).pb(4)
    .child(muted(label("gascity-side-title", "Cities"), theme).text_size(12).flex_1());
  if (m.total > 0) head = head.child(badge("gascity-side-total", `${m.total} need you`, m.questions > 0, colors).on_click((_, cx) => actions.openInbox(cx)));
  let root = themedRoot(theme, v_flex().id("gascity-side").size_full().p(6).gap(2).overflow_y_scroll().text_size(13)).child(head);
  if (m.note !== null) root = root.child(muted(label("gascity-side-note", m.note), theme).px(6).text_size(12));
  return root.children(m.cities.map((c, i) => cityBlock(c, i, theme, colors, actions)));
}

// ---- the Needs a human pane -----------------------------------------------------------

function chip(id: string, text: string, on: boolean, colors: StatusColors, onClick: (cx: GpuiContext) => void): GpuiElement {
  let el = div().id(id).px(9).py(1).rounded(10).border_1().text_size(12).child(text).on_click((_, cx) => onClick(cx));
  const c = on ? colors.ok : colors.dim;
  if (c !== undefined) el = el.border_color(c);
  if (on && colors.ok !== undefined) el = el.text_color(colors.ok);
  return el;
}

function button(id: string, text: string, colors: StatusColors, onClick: (cx: GpuiContext) => void): GpuiElement {
  const el = div().id(id).flex_none().px(8).py(1).rounded(5).border_1().text_size(12).child(text).on_click((_, cx) => onClick(cx));
  return colors.dim === undefined ? el : hoverable(el.border_color(colors.dim), colors);
}

function inboxRow(r: NeedRow, id: string, theme: ThemeRead, colors: StatusColors, actions: CrossCityActions): GpuiElement {
  const main = v_flex().id(`${id}-main`).flex_1().min_w_0();
  let titleText: string;
  let sub: string;
  let buttons: GpuiElement[];
  if (r.kind === "question") {
    titleText = `${r.who}: ${r.text}`;
    sub = [r.city, `session ${r.session}`, r.age].filter((x) => x !== null).join(" · ");
    buttons = [button(`${id}-answer`, "Answer", colors, (cx) => actions.openQuestion(r.city, r.session, cx))];
  } else {
    titleText = r.title;
    sub = [r.city, r.bead, r.priority, r.age, r.why.join(" + "), r.labels.length > 0 ? `[${r.labels.join(", ")}]` : null].filter((x) => x !== null && x !== "").join(" · ");
    buttons = [button(`${id}-open`, "Resolve…", colors, (cx) => actions.openDecision(r.city, r.bead, cx))];
    const link = r.link;
    if (link !== null) buttons.push(button(`${id}-mdash`, "mdash ↗", colors, (cx) => actions.openLink(link, cx)));
  }
  let title = label(`${id}-title`, titleText).overflow_hidden().whitespace_nowrap().text_ellipsis();
  if (r.kind === "question" && colors.bad !== undefined) title = title.text_color(colors.bad);
  const row = h_flex().id(id).gap(10).items_center().px(10).py(6).border_t_1()
    .child(main.child(title).child(muted(label(`${id}-sub`, sub), theme).text_size(12).overflow_hidden().whitespace_nowrap().text_ellipsis()))
    .children(buttons);
  return row;
}

/** The Needs a human pane. */
export function renderInbox(
  m: InboxModel, theme: ThemeRead, colors: StatusColors, actions: CrossCityActions, close: ((cx: GpuiContext) => void) | null = null,
): GpuiElement {
  let head = h_flex().id("gascity-inbox-head").gap(8).items_center()
    .child(div().id("gascity-inbox-title").flex_1().text_size(16).font_semibold().child("Needs a human"));
  const link = m.link;
  if (link !== null) head = head.child(button("gascity-inbox-mdash", "Open mdash ↗", colors, (cx) => actions.openLink(link, cx)));
  if (close !== null) head = head.child(button("gascity-inbox-close", "Close", colors, close));
  let root = themedRoot(theme, v_flex().id("gascity-inbox").size_full().p(12).gap(8).overflow_y_scroll().text_size(13)).child(head);
  const kinds = h_flex().id("gascity-inbox-kinds").gap(6).items_center()
    .child(chip("gascity-inbox-all", `All ${m.counts.all}`, m.filter === "all", colors, (cx) => actions.setFilter("all", cx)))
    .child(chip("gascity-inbox-questions", `Questions ${m.counts.questions}`, m.filter === "questions", colors, (cx) => actions.setFilter("questions", cx)))
    .child(chip("gascity-inbox-decisions", `Decisions ${m.counts.decisions}`, m.filter === "decisions", colors, (cx) => actions.setFilter("decisions", cx)));
  const cities = h_flex().id("gascity-inbox-cities").gap(6).items_center()
    .child(chip("gascity-inbox-city-all", "Every city", m.city === null, colors, (cx) => actions.setInboxCity(null, cx)))
    .children(m.byCity.map((c, i) => chip(`gascity-inbox-city-${i}`, `${c.name} ${c.count}`, m.city === c.name, colors, (cx) => actions.setInboxCity(c.name, cx))));
  root = root.child(kinds).child(cities);
  if (m.note !== null) root = root.child(muted(label("gascity-inbox-note", m.note), theme));
  m.groups.forEach((g, i) => {
    root = root.child(muted(label(`gascity-inbox-group-${i}`, g.title), theme).text_size(12).pt(6))
      .child(v_flex().id(`gascity-inbox-rows-${i}`).children(g.rows.map((r, k) => inboxRow(r, `gascity-inbox-${i}-${k}`, theme, colors, actions))));
  });
  if (m.notListed > 0) root = root.child(muted(label("gascity-inbox-not-listed", `${m.notListed} more decisions not listed (gc lists ${50} per city)`), theme));
  if (m.note === null && m.groups.length === 0) root = root.child(muted(label("gascity-inbox-empty", "Nothing waits on a person right now."), theme));
  return root;
}

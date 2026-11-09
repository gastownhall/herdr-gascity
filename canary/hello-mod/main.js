// A minimal mod for the headless-app spike (canary/). It proves a mod copy is
// alive inside a real herdr-app window: it writes a probe file the CI job
// reads, records every command it gets from nextCommand() (`hello.<cmd>`,
// and "focus" from pane.go) and every key that reaches it, and draws a large
// colored panel so a screenshot is visibly not blank.

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { appHome, readTextFile, writeTextFile, nextCommand } from "herdr";

const SCHEMA = "herdr-spike-hello-probe/1";

export default class Hello extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.path = `${appHome()}/data/hello-probe/probe.json`;
    this.state = { schema: SCHEMA, seq: 0, started_at: new Date().toISOString(), renders: 0, focused: false, commands: [], keys: [], errors: [] };
    // The last text this copy wrote (writeTextFile is compare-and-swap).
    this.raw = undefined;
    this.queue = Promise.resolve();
    this.save();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          this.handle.focus();
          this.state.focused = true;
        }
        this.state.commands.push(c);
        this.save();
        cx.notify();
      }
    });
  }

  save() {
    this.queue = this.queue.then(async () => {
      try {
        if (this.raw === undefined) this.raw = await readTextFile(this.path);
        this.state.seq += 1;
        this.state.ts = new Date().toISOString();
        const text = JSON.stringify(this.state) + "\n";
        await writeTextFile(this.path, text, this.raw);
        this.raw = text;
      } catch (e) {
        this.state.errors.push(String(e));
        this.raw = undefined;
      }
    });
  }

  render(_cx) {
    this.state.renders += 1;
    if (this.state.renders === 1) this.save();
    return v_flex()
      .id("hello")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        this.state.keys.push(e.key);
        this.save();
        cx.notify();
        cx.stop_propagation();
      })
      .size_full()
      .items_center()
      .justify_center()
      .gap(12)
      .bg("#1f6feb")
      .text_color("#ffffff")
      .child(div().text_size(40).font_semibold().child("HELLO FROM A MOD"))
      .child(div().text_size(16).child(`commands ${this.state.commands.length} · keys ${this.state.keys.length} · focused ${this.state.focused}`))
      .child(div().text_size(12).text_color("#dbe9ff").child(this.path));
  }
}

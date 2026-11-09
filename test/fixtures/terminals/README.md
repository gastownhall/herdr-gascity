Host data fixtures for the open-terminal tests (`test/unit/terminal/`): what
herdr-app's `spaces()`, `panes()` and `terminals()` return, one scenario per
file, in the full record shapes of herdr-app v0.1.14 (`defaults/herdr.d.ts`
SpaceInfo/PaneInfo; `terminals()` = `hc ls --json` records plus herdr's
`program`, `src/window.rs` terminals_listed). An attach terminal's `argv` is
what herdr's `tab.new` wrapper runs: `$SHELL -ic '"$@"; exec "$0" -i' $SHELL
<our argv>` (`src/window.rs` unix_agent_argv); when the attach exits, the
wrapper `exec`s an interactive shell, so the terminal stays with the same
argv and `program.shell` becomes true.

- `no-attach`: a local space (active) with the mod tab and a shell tab; a remote space.
- `attach-running`: plus a terminal whose current program is our attach of sc-20.
- `attach-ended`: the same terminal after the attach exited (`program.shell: true`).
- `attach-remote`: a running attach of sc-20 in the remote space only.
- `remote-active`: the active space is on another machine; a local space exists.
- `remote-only`: no local space at all.

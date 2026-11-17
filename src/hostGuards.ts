// The argument checks of host.ts's wrappers around herdr calls that would
// otherwise take anything: a herdr mod runs with the person's full rights, so
// each wrapper refuses, before calling herdr, any argument outside the one
// shape the mod needs.
//   - tab.new runs only an attach argv (terminal/argv.ts attachArgvIssue);
//   - xdg-open/open get only an http(s) URL on this computer (a file path
//     would be opened by its default handler: on macOS, `open x.command`
//     runs it);
//   - writeTextFile writes only the probe file's directory under the app
//     home (a file under <app home>/mods/ would install code no lint saw).
//
// Pure: no host calls.

/** The probe file's directory, under herdr's app home. */
export function probeDir(appHome: string): string {
  return `${appHome.replace(/\/+$/, "")}/data/gascity-probe`;
}

/** Why `path` may not be written, or null: a plain file name directly in the probe directory. */
export function probePathIssue(path: string, appHome: string): string | null {
  const dir = `${probeDir(appHome)}/`;
  const name = path.startsWith(dir) ? path.slice(dir.length) : null;
  if (name === null || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name)) return `refused: the mod writes only files in ${dir}, not ${JSON.stringify(path)}`;
  return null;
}

/** http(s), a loopback host, an optional port and path; no whitespace or control characters. */
const LOCAL_WEB_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[^\s\u0000-\u001f\u007f]*)?$/i;

/** Why `url` may not be handed to xdg-open/open, or null: http(s) URLs on this computer (the gc dashboard), or under the configured web dashboard. */
export function openUrlIssue(url: string, dashboards: string | null | readonly (string | null)[] = null): string | null {
  if (LOCAL_WEB_URL.test(url)) return null;
  // The configured web dashboards (gascity.settings dashboardUrl and runsUrl, https origins): a URL under one, with no control characters or whitespace.
  const allowed = (Array.isArray(dashboards) ? dashboards : [dashboards]).filter((d): d is string => typeof d === "string" && /^https:\/\//.test(d));
  if (!/[\s\u0000-\u001f\u007f]/.test(url) && allowed.some((d) => url.startsWith(`${d.replace(/\/+$/, "")}/`))) return null;
  return `refused: only http(s) URLs on this computer${allowed.length > 0 ? ` or under ${allowed.join(" or ")}` : ""} are opened, not ${JSON.stringify(url)}`;
}

// Links into the web dashboard (mdash: gascity-dashboard), when one is set
// (gascity.settings dashboardUrl). Its pages live under /city/<city>/;
// /beads?bead=<id> opens a bead there. Pure.

const seg = (s: string) => encodeURIComponent(s);

/** The dashboard's home for a city. */
export function cityLink(dashboardUrl: string | null, city: string): string | null {
  return dashboardUrl === null ? null : `${dashboardUrl}/city/${seg(city)}/`;
}

/** A formula run in the runs dashboard (factory): /city/<city>/runs/<runId>. */
export function runLink(runsUrl: string | null, city: string, runId: string): string | null {
  return runsUrl === null ? null : `${runsUrl}/city/${seg(city)}/runs/${seg(runId)}`;
}

/** A bead in the dashboard. */
export function beadLink(dashboardUrl: string | null, city: string, bead: string): string | null {
  return dashboardUrl === null ? null : `${dashboardUrl}/city/${seg(city)}/beads?bead=${seg(bead)}`;
}

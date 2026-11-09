// A loopback proxy in front of gc that holds chosen requests without
// answering or forwarding them: a gc that has stopped answering one
// operation. The mod's request then meets herdr's 30 s fetch timeout.

/** A request the proxy holds instead of forwarding. */
export type HoldRule = (method: string, path: string) => boolean;

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate", "host", "content-length"]);

/** A running proxy: its URL, the requests it held, and stop(). */
export interface HoldingProxy {
  url: string;
  held: { at: number; method: string; path: string }[];
  stop(): void;
}

/** Starts a proxy on a free loopback port that forwards to `target`, holding the requests `hold` picks for `holdMs`, then dropping them. */
export function startHoldingProxy(target: string, hold: HoldRule, holdMs: number): HoldingProxy {
  const held: HoldingProxy["held"] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // Never close a held connection for idleness: herdr's fetch must be the one to give up.
    idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (hold(req.method, u.pathname)) {
        held.push({ at: Date.now(), method: req.method, path: u.pathname });
        await new Promise((r) => setTimeout(r, holdMs));
        return new Response("held by the integration proxy", { status: 504 });
      }
      const headers = new Headers();
      req.headers.forEach((v, k) => {
        if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
      });
      const init: RequestInit = { method: req.method, headers, redirect: "manual" };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
      const r = await fetch(`${target}${u.pathname}${u.search}`, init);
      const out = new Headers();
      r.headers.forEach((v, k) => {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") out.set(k, v);
      });
      return new Response(await r.arrayBuffer(), { status: r.status, headers: out });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, held, stop: () => void server.stop(true) };
}

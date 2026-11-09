// The gc drift check: gc main's spec compared with the pin, restricted to the
// operations and fields in api/used-surface.json. Each case drifts a copy of
// the committed pin the way an upstream change would.

import { describe, expect, test } from "bun:test";
import { PINNED_SPEC, ROOT, USED_SURFACE, operationsById, readJson, type Schema, type Spec, type UsedSurface } from "../../../scripts/gc-spec.ts";
import { annotations, diffUsedSurface, formatReport, type Finding } from "../../../scripts/used-surface-diff.ts";

const pinned = await readJson<Spec>(ROOT, PINNED_SPEC);
const used = await readJson<UsedSurface>(ROOT, USED_SURFACE);

/** A copy of the pin, changed by `edit`. */
function drifted(edit: (spec: Spec) => void): Spec {
  const copy = structuredClone(pinned);
  edit(copy);
  return copy;
}

function schema(spec: Spec, name: string): Schema {
  const s = spec.components.schemas[name];
  if (!s) throw new Error(`no ${name} in the fixture`);
  return s;
}

function prop(spec: Spec, model: string, field: string): Schema {
  const p = schema(spec, model).properties?.[field];
  if (!p) throw new Error(`no ${model}.${field} in the fixture`);
  return p;
}

function op(spec: Spec, id: string) {
  const located = operationsById(spec).get(id);
  if (!located) throw new Error(`no ${id} in the fixture`);
  return located;
}

const breaking = (findings: Finding[]) => findings.filter((f) => f.level === "breaking");
const compatible = (findings: Finding[]) => findings.filter((f) => f.level === "compatible");

test("the pin compared with itself has no findings", () => {
  expect(diffUsedSurface(pinned, pinned, used)).toEqual([]);
});

test("changes outside the used surface are ignored", () => {
  const upstream = drifted((s) => {
    const p = schema(s, "SessionResponse").properties!;
    p["brand_new"] = { type: "string" };
    delete p["model"]; // a field the mod does not list
    s.paths["/v0/city/{cityName}/brand-new"] = { get: { operationId: "get-brand-new", responses: {} } };
  });
  expect(diffUsedSurface(pinned, upstream, used)).toEqual([]);
});

describe("breaking changes to what the mod uses", () => {
  test("a used response field renamed", () => {
    const upstream = drifted((s) => {
      const p = schema(s, "SessionResponse").properties!;
      p["session_title"] = p["title"]!;
      delete p["title"];
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used))).toEqual([
      { level: "breaking", where: "SessionResponse.title", via: "get-v0-city-by-city-name-sessions", change: "removed" },
    ]);
  });

  test("a used operation removed", () => {
    const upstream = drifted((s) => {
      delete s.paths["/v0/city/{cityName}/pending"];
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used))).toEqual([
      { level: "breaking", where: "get-v0-city-by-city-name-pending", via: "get-v0-city-by-city-name-pending", change: "operation removed (or its operationId changed)" },
    ]);
  });

  test("a used operation moved to another path or method", () => {
    const upstream = drifted((s) => {
      s.paths["/v0/city/{cityName}/pending-v2"] = s.paths["/v0/city/{cityName}/pending"]!;
      delete s.paths["/v0/city/{cityName}/pending"];
      const item = s.paths["/v0/city/{cityName}/bead/{id}/close"]!;
      item["put"] = item["post"];
      delete item["post"];
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used)).map((f) => [f.where, f.change])).toEqual([
      ["get-v0-city-by-city-name-pending", "path changed: /v0/city/{cityName}/pending -> /v0/city/{cityName}/pending-v2"],
      ["post-v0-city-by-city-name-bead-by-id-close", "method changed: POST -> PUT"],
    ]);
  });

  test("a required response field made optional", () => {
    const upstream = drifted((s) => {
      const m = schema(s, "CityInfo");
      m.required = m.required!.filter((f) => f !== "running");
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used))).toEqual([
      { level: "breaking", where: "CityInfo.running", via: "get-v0-cities", change: "no longer required: gc may omit it" },
    ]);
  });

  test("a response field's type changed", () => {
    const upstream = drifted((s) => {
      prop(s, "SessionProgramStatus", "progress").type = "string";
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used)).map((f) => [f.where, f.change])).toEqual([
      ["SessionProgramStatus.progress", "type changed: integer -> string"],
    ]);
  });

  test("a response field becomes nullable", () => {
    const upstream = drifted((s) => {
      prop(s, "CityInfo", "name").type = ["string", "null"];
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used)).map((f) => [f.where, f.change])).toEqual([
      ["CityInfo.name", "type changed: string -> null|string"],
    ]);
  });

  test("a request model gains a required field the mod does not send", () => {
    const upstream = drifted((s) => {
      const m = schema(s, "BeadCloseBody");
      m.properties!["closed_by"] = { type: "string" };
      m.required = ["closed_by"];
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used))).toEqual([
      { level: "breaking", where: "BeadCloseBody.closed_by", via: "post-v0-city-by-city-name-bead-by-id-close", change: "new required request field the mod does not send" },
    ]);
  });

  test("a request field the mod sends removed", () => {
    const upstream = drifted((s) => {
      delete schema(s, "BeadCloseBody").properties!["reason"];
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used)).map((f) => [f.where, f.change])).toEqual([["BeadCloseBody.reason", "removed"]]);
  });

  test("a request enum loses a value the mod may send", () => {
    const upstream = drifted((s) => {
      const intent = prop(s, "SessionSubmitInputBody", "intent");
      const target = intent.$ref ? schema(s, intent.$ref.split("/").pop()!) : intent;
      target.enum = (target.enum as string[]).slice(1);
    });
    const found = breaking(diffUsedSurface(pinned, upstream, used));
    expect(found.map((f) => f.where)).toEqual(["SessionSubmitInputBody.intent"]);
    expect(found[0]!.change).toStartWith("enum values removed:");
  });

  test("a new required query parameter", () => {
    const upstream = drifted((s) => {
      op(s, "get-v0-city-by-city-name-rigs").op.parameters!.push({ name: "view", in: "query", required: true, schema: { type: "string" } });
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used))).toEqual([
      { level: "breaking", where: "get-v0-city-by-city-name-rigs query view", via: "get-v0-city-by-city-name-rigs", change: "new required parameter" },
    ]);
  });

  test("a used query parameter removed", () => {
    const upstream = drifted((s) => {
      const o = op(s, "get-v0-city-by-city-name-sessions").op;
      o.parameters = o.parameters!.filter((p) => p.name !== "cursor");
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used)).map((f) => [f.where, f.change])).toEqual([
      ["get-v0-city-by-city-name-sessions query cursor", "removed"],
    ]);
  });

  test("a different success status", () => {
    const upstream = drifted((s) => {
      const r = op(s, "create-bead").op.responses;
      const [code] = Object.keys(r).filter((c) => /^2/.test(c));
      r["200"] = r[code!]!;
      if (code !== "200") delete r[code!];
      else {
        r["201"] = r["200"];
        delete r["200"];
      }
    });
    const found = breaking(diffUsedSurface(pinned, upstream, used));
    expect(found.map((f) => f.where)).toEqual(["create-bead"]);
    expect(found[0]!.change).toStartWith("success status changed:");
  });

  test("the problem model used by every error changes", () => {
    const upstream = drifted((s) => {
      prop(s, "ErrorModel", "status").type = "string";
    });
    expect(breaking(diffUsedSurface(pinned, upstream, used)).map((f) => [f.where, f.change])).toEqual([
      ["ErrorModel.status", "type changed: integer -> string"],
    ]);
  });
});

describe("compatible changes are reported but do not fail", () => {
  test("a new value in a response enum decodes as unrecognized", () => {
    const upstream = drifted((s) => {
      const state = prop(s, "SessionProgramStatus", "state");
      const target = state.$ref ? schema(s, state.$ref.split("/").pop()!) : state;
      target.enum = [...(target.enum as string[]), "hibernating"];
    });
    const findings = diffUsedSurface(pinned, upstream, used);
    expect(breaking(findings)).toEqual([]);
    expect(compatible(findings).map((f) => [f.where, f.change])).toEqual([
      ["SessionProgramStatus.state", 'new enum values (decoded as unrecognized): "hibernating"'],
    ]);
  });

  test("a renamed model with the same fields", () => {
    const upstream = drifted((s) => {
      const c = s.components.schemas;
      c["CityInfoV2"] = c["CityInfo"]!;
      delete c["CityInfo"];
      const list = schema(s, "SupervisorCitiesOutputBody");
      list.properties!["items"]!.items = { $ref: "#/components/schemas/CityInfoV2" };
    });
    const findings = diffUsedSurface(pinned, upstream, used);
    expect(breaking(findings)).toEqual([]);
    expect(compatible(findings).map((f) => [f.where, f.change])).toEqual([["SupervisorCitiesOutputBody.items[]", "model renamed: CityInfo -> CityInfoV2"]]);
  });

  test("an optional response field made required", () => {
    const upstream = drifted((s) => {
      schema(s, "CityInfo").required!.push("status");
    });
    const findings = diffUsedSurface(pinned, upstream, used);
    expect(breaking(findings)).toEqual([]);
    expect(compatible(findings).map((f) => [f.where, f.change])).toEqual([["CityInfo.status", "now required"]]);
  });
});

test("the report names every breaking change and says what to do", () => {
  const upstream = drifted((s) => {
    delete schema(s, "SessionResponse").properties!["title"];
  });
  const findings = diffUsedSurface(pinned, upstream, used);
  const report = formatReport(findings, {
    pinned: { repo: "gastownhall/gascity", commit: "aaaa", committed: "2026-01-01T00:00:00Z", path: "internal/api/openapi.json", sha256: "x" },
    upstream: { ref: "main", commit: "bbbb" },
  });
  expect(report).toContain("1 breaking change");
  expect(report).toContain("| `SessionResponse.title` | removed | `get-v0-city-by-city-name-sessions` |");
  expect(report).toContain("gastownhall/gascity@bbbb");
  expect(formatReport([], { pinned: { repo: "r", commit: "a", committed: "c", path: "p", sha256: "s" }, upstream: { ref: "main", commit: "b" } }))
    .toContain("No change to the operations and fields this mod uses");
});

describe("text from the other spec cannot break out of the output", () => {
  // A new required parameter whose name carries a line break and a command.
  const upstream = drifted((s) => {
    op(s, "get-v0-city-by-city-name-rigs").op.parameters!.push({
      name: "x\n::add-mask::secret%",
      in: "query",
      required: true,
      schema: { type: "string" },
    });
  });
  const findings = diffUsedSurface(pinned, upstream, used);

  test("each annotation is one escaped line", () => {
    expect(annotations(findings)).toEqual([
      "::error title=gc drift::get-v0-city-by-city-name-rigs query x%0A::add-mask::secret%25: new required parameter (reached from get-v0-city-by-city-name-rigs)",
    ]);
  });

  test("the report keeps it inside its table cell", () => {
    const report = formatReport(findings, {
      pinned: { repo: "r", commit: "a", committed: "c", path: "p", sha256: "s" },
      upstream: { ref: "main", commit: "b" },
    });
    expect(report.split("\n").some((line) => line.startsWith("::"))).toBe(false);
    expect(report).toContain("| `get-v0-city-by-city-name-rigs query x ::add-mask::secret%` | new required parameter |");
  });
});

describe("value constraints on what the mod sends", () => {
  const param = (s: Spec, id: string, name: string) => {
    const p = op(s, id).op.parameters!.find((x) => x.name === name);
    if (!p) throw new Error(`no ${id} ${name} in the fixture`);
    return p;
  };
  const changes = (upstream: Spec) => diffUsedSurface(pinned, upstream, used).map((f) => [f.level, f.where, f.change]);

  test("a tighter length bound on a request field is breaking, a looser one compatible", () => {
    expect(changes(drifted((s) => {
      prop(s, "BeadCreateInputBody", "title").maxLength = 200;
    }))).toEqual([["breaking", "BeadCreateInputBody.title", "maxLength changed: none -> 200"]]);
    expect(changes(drifted((s) => {
      prop(s, "BeadCreateInputBody", "title").minLength = 3;
    }))).toEqual([["breaking", "BeadCreateInputBody.title", "minLength changed: 1 -> 3"]]);
    expect(changes(drifted((s) => {
      delete prop(s, "BeadCreateInputBody", "title").minLength;
    }))).toEqual([["compatible", "BeadCreateInputBody.title", "minLength changed: 1 -> none"]]);
  });

  test("a lower maximum on a query parameter is breaking", () => {
    expect(changes(drifted((s) => {
      param(s, "get-v0-city-by-city-name-sessions", "limit").schema!.maximum = 500;
    }))).toEqual([["breaking", "get-v0-city-by-city-name-sessions query limit", "maximum changed: 1000 -> 500"]]);
  });

  test("a new or changed pattern is breaking, a dropped one compatible", () => {
    expect(changes(drifted((s) => {
      prop(s, "BeadCloseBody", "reason").pattern = "^[a-z ]*$";
    }))).toEqual([["breaking", "BeadCloseBody.reason", 'pattern changed: none -> "^[a-z ]*$"']]);
    expect(changes(drifted((s) => {
      param(s, "get-request-outcome", "after_seq").schema!.pattern = "^[1-9][0-9]*$";
    }))).toEqual([["breaking", "get-request-outcome query after_seq", 'pattern changed: "^[0-9]+$" -> "^[1-9][0-9]*$"']]);
    expect(changes(drifted((s) => {
      delete param(s, "get-request-outcome", "after_seq").schema!.pattern;
    }))).toEqual([["compatible", "get-request-outcome query after_seq", 'pattern changed: "^[0-9]+$" -> none']]);
  });

  test("constraints on what gc sends are not the mod's to check", () => {
    expect(changes(drifted((s) => {
      prop(s, "CityInfo", "name").maxLength = 10;
      prop(s, "CityInfo", "name").pattern = "^x$";
    }))).toEqual([]);
  });

  test("a query parameter serialized differently is breaking", () => {
    expect(changes(drifted((s) => {
      param(s, "get-v0-city-by-city-name-work-ready", "exclude_label").explode = false;
    }))).toEqual([[
      "breaking", "get-v0-city-by-city-name-work-ready query exclude_label", "serialization changed: style=form explode=true -> style=form explode=false",
    ]]);
    expect(changes(drifted((s) => {
      param(s, "get-v0-city-by-city-name-work-ready", "exclude_label").style = "pipeDelimited";
    }))).toEqual([[
      "breaking", "get-v0-city-by-city-name-work-ready query exclude_label", "serialization changed: style=form explode=true -> style=pipeDelimited explode=true",
    ]]);
  });

  test("spelling out a default is no change", () => {
    expect(changes(drifted((s) => {
      param(s, "get-v0-city-by-city-name-work-ready", "exclude_label").style = "form";
    }))).toEqual([]);
  });
});

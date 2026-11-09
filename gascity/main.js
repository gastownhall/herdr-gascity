// herdr-gascity 0.0.0 - the Gas City mod for herdr-app. Built file: do not edit.
// Source: https://github.com/gastownhall/herdr-gascity (src/). `bun run build` rebuilds this file
// byte for byte; source digest sha256:4dff67826e52134cabb04aece8a28b73212e7b73bd9c98bba06de0b2908983ab over the git-tracked src/, build.ts, package.json, bun.lock and tsconfig.json.

// src/main.ts
import { View } from "gpui-kit";

// src/host.ts
import * as herdr from "herdr";

// src/result.ts
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}

// src/discovery/gcStatus.ts
var GC_STATUS_ARGS = ["supervisor", "status", "--json"];
var GC_STATUS_COMMAND = `gc ${GC_STATUS_ARGS.join(" ")}`;
function decodeError(path, issue2) {
  return { kind: "decode", operationId: GC_STATUS_COMMAND, path, issues: [issue2] };
}
function parseGcStatus(stdout) {
  let json;
  try {
    json = JSON.parse(stdout);
  } catch (cause) {
    return err(decodeError("", `(root): output is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`));
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return err(decodeError("", "(root): expected a JSON object"));
  }
  if (!Object.hasOwn(json, "api_url")) return ok(null);
  const url = json["api_url"];
  if (typeof url !== "string" || url === "") return err(decodeError("api_url", `api_url: expected a non-empty string, got ${JSON.stringify(url)}`));
  return ok(url);
}

// src/version.ts
var MOD_VERSION = "0.0.0";

// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a2;
  for (let i = start; i < issues.length; i++) {
    (_a2 = issues[i]).schema ?? (_a2.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a2;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a2 = iss).schema ?? (_a2.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err2) {
        delete this[key];
        broke = broke || outer;
        throw err2;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer2, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer2(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
function failure(Err, issues, ctx) {
  let error;
  return {
    success: false,
    get error() {
      if (!error) {
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error;
    },
    set error(e) {
      error = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);

// node_modules/zod/v4/core/regexes.js
var anyString = /^[\s\S]{0,}$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse2 = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse2(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[outKey] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}

// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}

// node_modules/zod/v4/mini/schemas.js
var ZodMiniType = /* @__PURE__ */ $constructor("ZodMiniType", (inst, def) => {
  if (!inst._zod)
    throw new Error("Uninitialized schema in ZodMiniType.");
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
}, {
  // `with` is an alias for `check`: the same function object, not a wrapper.
  get with() {
    return this.check;
  },
  set with(value) {
    own(this, "with", value);
  },
  parse(data, params) {
    return parse(this, data, params, { callee: this.parse });
  },
  parseAsync(data, params) {
    return parseAsync(this, data, params, { callee: this.parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  check(...checks) {
    const def = this.def;
    return this.clone({
      ...def,
      checks: [
        ...def.checks ?? [],
        ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }, { parent: true });
  },
  clone(_def, params) {
    return clone(this, _def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta2) {
    reg.add(this, meta2);
    return this;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  }
});
var ZodMiniString = /* @__PURE__ */ $constructor("ZodMiniString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function string2(params) {
  return _string(ZodMiniString, params);
}
var ZodMiniNumber = /* @__PURE__ */ $constructor("ZodMiniNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodMiniType.init(inst, def);
});
var ZodMiniNumberFormat = /* @__PURE__ */ $constructor("ZodMiniNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodMiniNumber.init(inst, def);
});
function int(params) {
  return _int(ZodMiniNumberFormat, params);
}
var ZodMiniBoolean = /* @__PURE__ */ $constructor("ZodMiniBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function boolean2(params) {
  return _boolean(ZodMiniBoolean, params);
}
var ZodMiniUnknown = /* @__PURE__ */ $constructor("ZodMiniUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function unknown() {
  return _unknown(ZodMiniUnknown);
}
var ZodMiniArray = /* @__PURE__ */ $constructor("ZodMiniArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function array(element, params) {
  return new ZodMiniArray({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
var ZodMiniObject = /* @__PURE__ */ $constructor("ZodMiniObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodMiniType.init(inst, def);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
});
// @__NO_SIDE_EFFECTS__
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodMiniObject(def);
}
var ZodMiniUnion = /* @__PURE__ */ $constructor("ZodMiniUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function union(options, params) {
  return new ZodMiniUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodMiniRecord = /* @__PURE__ */ $constructor("ZodMiniRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodMiniRecord({
      type: "record",
      keyType: /* @__PURE__ */ string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodMiniRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodMiniEnum = /* @__PURE__ */ $constructor("ZodMiniEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodMiniType.init(inst, def);
  inst.options = [...inst._zod.values];
});
// @__NO_SIDE_EFFECTS__
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodMiniEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodMiniTransform = /* @__PURE__ */ $constructor("ZodMiniTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function transform(fn) {
  return new ZodMiniTransform({
    type: "transform",
    transform: fn
  });
}
var ZodMiniOptional = /* @__PURE__ */ $constructor("ZodMiniOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function optional(innerType) {
  return new ZodMiniOptional({
    type: "optional",
    innerType
  });
}
var ZodMiniNullable = /* @__PURE__ */ $constructor("ZodMiniNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function nullable(innerType) {
  return new ZodMiniNullable({
    type: "nullable",
    innerType
  });
}
var ZodMiniPipe = /* @__PURE__ */ $constructor("ZodMiniPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function pipe(in_, out) {
  return new ZodMiniPipe({
    type: "pipe",
    in: in_,
    out
  });
}

// src/gc/zod.ts
config({ jitless: true });

// src/gc/decode.ts
function isUnrecognized(value) {
  return typeof value === "object" && value !== null && value.kind === "unrecognized" && typeof value.raw === "string";
}
function enumOf(values) {
  return union([
    _enum(values),
    pipe(string2(), transform((raw) => ({ kind: "unrecognized", raw })))
  ]);
}
function nullableList(item) {
  return pipe(nullable(array(item)), transform((list) => list ?? []));
}
function optionalNullableList(item) {
  return pipe(optional(nullable(array(item))), transform((list) => list ?? []));
}
var MAX_ISSUES = 20;
function formatPath(path) {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out;
}
function joinPath(base, rest) {
  if (base === "") return rest;
  if (rest === "" || rest.startsWith("[")) return base + rest;
  return `${base}.${rest}`;
}
function at(value, path) {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[key];
  }
  return cur;
}
function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function describe2(issue2, input) {
  const found = at(input, issue2.path);
  switch (issue2.code) {
    case "invalid_type":
      return found === void 0 ? `missing required ${issue2.expected ?? "value"}` : `expected ${issue2.expected ?? "?"}, got ${kindOf(found)}`;
    case "invalid_value":
      return `expected one of ${JSON.stringify(issue2.values ?? [])}, got ${JSON.stringify(found)}`;
    case "invalid_union":
      return `no accepted form matched ${kindOf(found)}`;
    default:
      return issue2.code;
  }
}
function toDecodeError(operationId, base, issues, input) {
  const lines = issues.slice(0, MAX_ISSUES).map((i) => `${joinPath(base, formatPath(i.path)) || "(root)"}: ${describe2(i, input)}`);
  if (issues.length > MAX_ISSUES) lines.push(`… ${issues.length - MAX_ISSUES} more`);
  const first = issues[0];
  return { kind: "decode", operationId, path: joinPath(base, first ? formatPath(first.path) : ""), issues: lines };
}
function decodeValue(schema, value, operationId, path = "") {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err(toDecodeError(operationId, path, parsed.error.issues, value));
}
function idOf(value) {
  if (value === null || typeof value !== "object") return null;
  const { id, name } = value;
  if (typeof id === "string") return id;
  if (typeof name === "string") return name;
  return null;
}
function decodeListed(envelope, item, value, operationId) {
  const outer = decodeValue(envelope, value, operationId);
  if (!outer.ok) return outer;
  const items = [];
  const unreadable = [];
  outer.value.items.forEach((raw, index) => {
    const decoded = decodeValue(item, raw, operationId, `items[${index}]`);
    if (decoded.ok) items.push(decoded.value);
    else unreadable.push({ index, id: idOf(raw), error: decoded.error });
  });
  return ok({ ...outer.value, items, unreadable });
}

// src/gc/schemas.gen.ts
var ErrorDetailSchema = object({
  location: optional(string2()),
  message: optional(string2()),
  value: optional(unknown())
});
var ErrorModelSchema = object({
  type: optional(string2()),
  title: optional(string2()),
  status: optional(int()),
  detail: optional(string2()),
  instance: optional(string2()),
  code: optional(string2()),
  errors: optionalNullableList(ErrorDetailSchema)
});
var SupervisorStartupSchema = object({
  ready: boolean2(),
  phase: optional(string2()),
  phases_completed: optionalNullableList(string2())
});
var SupervisorHealthOutputBodySchema = object({
  status: string2(),
  version: string2(),
  build_id: optional(string2()),
  uptime_sec: int(),
  cities_total: int(),
  cities_running: int(),
  startup: optional(SupervisorStartupSchema)
});
var CityInfoSchema = object({
  name: string2(),
  path: string2(),
  running: boolean2(),
  status: optional(string2()),
  error: optional(string2())
});
var SupervisorCitiesOutputBodySchema = object({
  items: nullableList(unknown()),
  total: int()
});
var RigResponseSchema = object({
  name: string2(),
  path: string2(),
  prefix: optional(string2()),
  suspended: boolean2(),
  agent_count: int(),
  running_count: int(),
  default_sling_target: optional(string2())
});
var ListBodyRigResponseSchema = object({
  items: nullableList(unknown()),
  total: int(),
  next_cursor: optional(string2()),
  partial: optional(boolean2()),
  partial_errors: optionalNullableList(string2())
});
var PoolLimitsSchema = object({
  min: int(),
  max: int()
});
var SessionProgramStatusSchema = object({
  state: enumOf(["idle", "working", "done", "blocked", "error"]),
  kind: optional(enumOf(["permission", "question", "auth"])),
  progress: optional(int()),
  app: optional(string2()),
  since: string2(),
  quiet_since: optional(string2()),
  working_children: int()
});
var SessionInfoSchema = object({
  name: string2(),
  attached: boolean2(),
  last_activity: optional(string2())
});
var AgentResponseSchema = object({
  name: string2(),
  display_name: optional(string2()),
  description: optional(string2()),
  rig: optional(string2()),
  pool: optional(string2()),
  pool_limits: optional(PoolLimitsSchema),
  state: string2(),
  suspended: boolean2(),
  running: boolean2(),
  available: boolean2(),
  unavailable_reason: optional(string2()),
  active_bead: optional(string2()),
  activity: optional(string2()),
  activity_source: optional(enumOf(["program", "transcript"])),
  program_status: optional(SessionProgramStatusSchema),
  provider: optional(string2()),
  session: optional(SessionInfoSchema)
});
var ListBodyAgentResponseSchema = object({
  items: nullableList(unknown()),
  total: int(),
  next_cursor: optional(string2()),
  partial: optional(boolean2()),
  partial_errors: optionalNullableList(string2())
});
var SubmissionCapabilitiesSchema = object({
  supports_follow_up: boolean2(),
  supports_interrupt_now: boolean2(),
  supports_steer: boolean2()
});
var SessionResponseSchema = object({
  id: string2(),
  alias: optional(string2()),
  title: string2(),
  display_name: optional(string2()),
  template: string2(),
  agent_name: optional(string2()),
  session_name: string2(),
  rig: optional(string2()),
  pool: optional(string2()),
  kind: optional(string2()),
  provider: string2(),
  transport: optional(string2()),
  state: string2(),
  reason: optional(string2()),
  running: boolean2(),
  attached: boolean2(),
  active_bead: optional(string2()),
  activity: optional(string2()),
  activity_source: optional(enumOf(["program", "transcript"])),
  program_status: optional(SessionProgramStatusSchema),
  submission_capabilities: optional(SubmissionCapabilitiesSchema),
  created_at: string2(),
  last_active: optional(string2()),
  last_output: optional(string2()),
  wake_reasons: optional(nullableList(string2()))
});
var ListBodySessionResponseSchema = object({
  items: nullableList(unknown()),
  total: int(),
  next_cursor: optional(string2()),
  partial: optional(boolean2()),
  partial_errors: optionalNullableList(string2())
});
var CityPendingEntrySchema = object({
  session_id: string2(),
  request_id: string2(),
  kind: string2()
});
var ListBodyCityPendingEntrySchema = object({
  items: nullableList(unknown()),
  total: int(),
  next_cursor: optional(string2()),
  partial: optional(boolean2()),
  partial_errors: optionalNullableList(string2())
});
var PendingInteractionSchema = object({
  request_id: string2(),
  kind: string2(),
  prompt: optional(string2()),
  options: optionalNullableList(string2()),
  metadata: optional(record(string2(), string2()))
});
var SessionPendingResponseSchema = object({
  supported: boolean2(),
  pending: optional(PendingInteractionSchema)
});
var ReadyBeadSchema = object({
  id: string2(),
  title: string2(),
  status: string2(),
  issue_type: string2(),
  priority: optional(int()),
  assignee: optional(string2()),
  labels: optionalNullableList(string2()),
  created_at: string2(),
  updated_at: optional(string2()),
  close_reason: optional(string2()),
  is_blocked: optional(boolean2())
});
var WorkReadyBodySchema = object({
  items: nullableList(unknown())
});
var BeadSchema = object({
  id: string2(),
  title: string2(),
  status: string2(),
  issue_type: string2(),
  priority: optional(int()),
  assignee: optional(string2()),
  labels: optionalNullableList(string2()),
  description: optional(string2()),
  created_at: string2(),
  updated_at: optional(string2()),
  close_reason: optional(string2())
});
var TypedEventStreamEnvelopeSchema = object({
  seq: int(),
  type: string2(),
  ts: string2(),
  actor: string2(),
  subject: optional(string2()),
  payload: unknown()
});
var ListBodyWireEventSchema = object({
  items: nullableList(unknown()),
  total: int(),
  next_cursor: optional(string2()),
  partial: optional(boolean2()),
  partial_errors: optionalNullableList(string2())
});
var RequestOutcomeSchema = object({
  request_id: string2(),
  operation: enumOf(["session.create", "session.message", "session.submit"]),
  state: enumOf(["pending", "succeeded", "failed", "outcome_unknown"]),
  event: optional(TypedEventStreamEnvelopeSchema)
});
var AsyncAcceptedBodySchema = object({
  request_id: string2(),
  status: string2(),
  event_cursor: string2(),
  idempotency_key: optional(string2()),
  replayed: optional(boolean2())
});
var SessionRespondOutputBodySchema = object({
  id: string2(),
  status: string2(),
  idempotency_key: optional(string2()),
  replayed: optional(boolean2())
});
var OKWithIDResponseBodySchema = object({
  status: string2(),
  id: optional(string2()),
  idempotency_key: optional(string2()),
  replayed: optional(boolean2())
});
var SessionCommandStatusBodySchema = object({
  status: string2(),
  idempotency_key: optional(string2()),
  replayed: optional(boolean2())
});
var OKResponseBodySchema = object({
  status: string2()
});
var RigActionBodySchema = object({
  rig: string2(),
  action: string2(),
  status: string2(),
  failed: optionalNullableList(string2()),
  killed: optionalNullableList(string2())
});
var SlingResponseSchema = object({
  status: enumOf(["slung", "partial"]),
  target: string2(),
  bead: optional(string2()),
  root_bead_id: optional(string2()),
  workflow_id: optional(string2()),
  convoy_id: optional(string2()),
  dashboard_url: optional(string2()),
  warnings: optionalNullableList(string2())
});
var RequestFailedPayloadSchema = object({
  request_id: string2(),
  operation: enumOf(["city.create", "city.unregister", "session.create", "session.message", "session.submit", "rig.create"]),
  error_code: string2(),
  error_message: string2(),
  session_id: optional(string2())
});

// src/gc/errors.ts
var CITY_NOT_RUNNING_PREFIX = "not_found: city not found or not running: ";
var RAW_LIMIT = 2e3;
function parseProblem(body) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const decoded = decodeValue(ErrorModelSchema, json, "problem");
  if (!decoded.ok) return null;
  const p = decoded.value;
  const isProblem = [p.type, p.title, p.status, p.detail, p.code].some((v) => v !== void 0);
  return isProblem ? p : null;
}
function rawText(body) {
  return body.trim().slice(0, RAW_LIMIT);
}
var CODE_CITY_NOT_FOUND = "city-not-found";
function httpError(operationId, status, body) {
  const problem = parseProblem(body);
  const detail = problem?.detail ?? "";
  const code = problem?.code;
  if ((status === 404 || status === 405) && problem === null) {
    const raw = rawText(body);
    return raw === "" || !raw.startsWith("{") ? { kind: "api-missing", operationId } : { kind: "api-missing", operationId, raw };
  }
  if (status === 404 && (code === CODE_CITY_NOT_FOUND || code === void 0 && detail.startsWith(CITY_NOT_RUNNING_PREFIX))) {
    return { kind: "city-not-running", city: detail.startsWith(CITY_NOT_RUNNING_PREFIX) ? detail.slice(CITY_NOT_RUNNING_PREFIX.length) : "" };
  }
  if (status === 401 && problem) {
    if (detail === "missing X-GC-City-Write grant") return { kind: "write-grant-required", status: 401, detail };
    if (detail === "missing X-GC-City-Read grant") return { kind: "read-grant-required", status: 401, detail };
  }
  if (status === 403 && problem) {
    if (detail.startsWith("csrf:")) return { kind: "csrf-rejected" };
    if (detail.startsWith("read_only:")) return { kind: "read-only", detail };
    if (detail === "write grant rejected" || detail.startsWith("workspace-service mutations are disabled")) {
      return { kind: "write-grant-required", status: 403, detail };
    }
    if (detail === "read grant rejected") return { kind: "read-grant-required", status: 403, detail };
  }
  if (problem) return { kind: "http", status, problem };
  return { kind: "http", status, problem: null, raw: rawText(body) };
}

// src/gc/operations.gen.ts
var OPERATIONS = {
  "get-health": {
    method: "GET",
    path: "/health",
    pathParams: [],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: SupervisorHealthOutputBodySchema,
    item: null
  },
  "get-v0-cities": {
    method: "GET",
    path: "/v0/cities",
    pathParams: [],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: SupervisorCitiesOutputBodySchema,
    item: CityInfoSchema
  },
  "get-v0-city-by-city-name-rigs": {
    method: "GET",
    path: "/v0/city/{cityName}/rigs",
    pathParams: ["cityName"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: ListBodyRigResponseSchema,
    item: RigResponseSchema
  },
  "get-v0-city-by-city-name-agents": {
    method: "GET",
    path: "/v0/city/{cityName}/agents",
    pathParams: ["cityName"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: ListBodyAgentResponseSchema,
    item: AgentResponseSchema
  },
  "get-v0-city-by-city-name-sessions": {
    method: "GET",
    path: "/v0/city/{cityName}/sessions",
    pathParams: ["cityName"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: ListBodySessionResponseSchema,
    item: SessionResponseSchema
  },
  "get-v0-city-by-city-name-session-by-id": {
    method: "GET",
    path: "/v0/city/{cityName}/session/{id}",
    pathParams: ["cityName", "id"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: SessionResponseSchema,
    item: null
  },
  "get-v0-city-by-city-name-pending": {
    method: "GET",
    path: "/v0/city/{cityName}/pending",
    pathParams: ["cityName"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: ListBodyCityPendingEntrySchema,
    item: CityPendingEntrySchema
  },
  "get-v0-city-by-city-name-session-by-id-pending": {
    method: "GET",
    path: "/v0/city/{cityName}/session/{id}/pending",
    pathParams: ["cityName", "id"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: SessionPendingResponseSchema,
    item: null
  },
  "get-v0-city-by-city-name-work-ready": {
    method: "GET",
    path: "/v0/city/{cityName}/work/ready",
    pathParams: ["cityName"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: WorkReadyBodySchema,
    item: ReadyBeadSchema
  },
  "get-v0-city-by-city-name-bead-by-id": {
    method: "GET",
    path: "/v0/city/{cityName}/bead/{id}",
    pathParams: ["cityName", "id"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: BeadSchema,
    item: null
  },
  "get-v0-city-by-city-name-events": {
    method: "GET",
    path: "/v0/city/{cityName}/events",
    pathParams: ["cityName"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: ListBodyWireEventSchema,
    item: TypedEventStreamEnvelopeSchema
  },
  "get-request-outcome": {
    method: "GET",
    path: "/v0/city/{cityName}/request/{requestId}",
    pathParams: ["cityName", "requestId"],
    csrf: false,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: RequestOutcomeSchema,
    item: null
  },
  "create-session": {
    method: "POST",
    path: "/v0/city/{cityName}/sessions",
    pathParams: ["cityName"],
    csrf: true,
    idempotencyKey: true,
    body: "SessionCreateBody",
    success: 202,
    response: AsyncAcceptedBodySchema,
    item: null
  },
  "submit-session": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/submit",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: "SessionSubmitInputBody",
    success: 202,
    response: AsyncAcceptedBodySchema,
    item: null
  },
  "send-session-message": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/messages",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: "SessionMessageInputBody",
    success: 202,
    response: AsyncAcceptedBodySchema,
    item: null
  },
  "respond-session": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/respond",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: "SessionRespondInputBody",
    success: 202,
    response: SessionRespondOutputBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-wake": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/wake",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: null,
    success: 200,
    response: OKWithIDResponseBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-suspend": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/suspend",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: null,
    success: 200,
    response: SessionCommandStatusBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-stop": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/stop",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: "SessionStopBody",
    success: 200,
    response: OKWithIDResponseBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-close": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/close",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: null,
    success: 200,
    response: SessionCommandStatusBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-kill": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/kill",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: true,
    body: null,
    success: 200,
    response: OKWithIDResponseBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-pin": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/pin",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: SessionResponseSchema,
    item: null
  },
  "post-v0-city-by-city-name-session-by-id-unpin": {
    method: "POST",
    path: "/v0/city/{cityName}/session/{id}/unpin",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: SessionResponseSchema,
    item: null
  },
  "post-v0-city-by-city-name-agent-by-base-by-action": {
    method: "POST",
    path: "/v0/city/{cityName}/agent/{base}/{action}",
    pathParams: ["cityName", "base", "action"],
    csrf: true,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: OKResponseBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-agent-by-dir-by-base-by-action": {
    method: "POST",
    path: "/v0/city/{cityName}/agent/{dir}/{base}/{action}",
    pathParams: ["cityName", "dir", "base", "action"],
    csrf: true,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: OKResponseBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-rig-by-name-by-action": {
    method: "POST",
    path: "/v0/city/{cityName}/rig/{name}/{action}",
    pathParams: ["cityName", "name", "action"],
    csrf: true,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: RigActionBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-sling": {
    method: "POST",
    path: "/v0/city/{cityName}/sling",
    pathParams: ["cityName"],
    csrf: true,
    idempotencyKey: false,
    body: "SlingInputBody",
    success: 200,
    response: SlingResponseSchema,
    item: null
  },
  "create-bead": {
    method: "POST",
    path: "/v0/city/{cityName}/beads",
    pathParams: ["cityName"],
    csrf: true,
    idempotencyKey: true,
    body: "BeadCreateInputBody",
    success: 201,
    response: BeadSchema,
    item: null
  },
  "post-v0-city-by-city-name-bead-by-id-close": {
    method: "POST",
    path: "/v0/city/{cityName}/bead/{id}/close",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: false,
    body: "BeadCloseBody",
    success: 200,
    response: OKResponseBodySchema,
    item: null
  },
  "post-v0-city-by-city-name-bead-by-id-reopen": {
    method: "POST",
    path: "/v0/city/{cityName}/bead/{id}/reopen",
    pathParams: ["cityName", "id"],
    csrf: true,
    idempotencyKey: false,
    body: null,
    success: 200,
    response: OKResponseBodySchema,
    item: null
  }
};

// src/gc/client.ts
var HERDR_FETCH_TIMEOUT_MS = 3e4;
var HERDR_FETCH_MAX_BODY_BYTES = 8 * 1024 * 1024;
var TIMEOUT_SLACK_MS = 1e3;
var X_GC_REQUEST = `herdr-gascity/${MOD_VERSION}`;
var ACCEPT = "application/json, application/problem+json";
var LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})\/?$/;
function isLoopbackApiUrl(url) {
  const m = LOOPBACK.exec(url);
  return m !== null && Number(m[2]) <= 65535;
}
function createGcClient(options) {
  if (!isLoopbackApiUrl(options.baseUrl)) return err({ kind: "not-loopback", url: options.baseUrl });
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const now = options.now ?? (() => Date.now());
  return ok({
    baseUrl,
    call: (op, args) => call(baseUrl, options.fetch, now, op, args)
  });
}
function originOf(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  if (!m) return "";
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  return `${scheme}://${scheme === "http" ? authority.replace(/:80$/, "") : authority}`;
}
function buildUrl(baseUrl, template, path, query) {
  const filled = template.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(path[name] ?? ""));
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0) continue;
    const values = typeof value === "object" ? value : [value];
    for (const v of values) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return `${baseUrl}${filled}${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}
function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) n += 1;
    else if (c < 2048) n += 2;
    else if (c >= 55296 && c <= 56319 && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
function messageOf(cause) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}
function hostElapsedMs(cause) {
  if (cause === null || typeof cause !== "object") return null;
  const v = cause.hostElapsedMs;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function transportFailure(url, cause, elapsedMs) {
  const message = messageOf(cause);
  if (/exceeded the \d+ byte limit/.test(message)) {
    return { kind: "too-large", url, direction: /request body/.test(message) ? "request" : "response", limitBytes: HERDR_FETCH_MAX_BODY_BYTES };
  }
  if (/timed out|timeout/i.test(message) || elapsedMs >= HERDR_FETCH_TIMEOUT_MS - TIMEOUT_SLACK_MS) {
    return { kind: "timeout", url, ms: HERDR_FETCH_TIMEOUT_MS };
  }
  return { kind: "unreachable", url, cause: message };
}
async function call(baseUrl, fetch2, now, op, args) {
  const meta2 = OPERATIONS[op];
  const mutation = meta2.method !== "GET";
  const loose = args;
  const url = buildUrl(baseUrl, meta2.path, loose.path, loose.query ?? {});
  const headers = { Accept: ACCEPT };
  if (mutation) headers["X-GC-Request"] = X_GC_REQUEST;
  if (meta2.idempotencyKey && loose.idempotencyKey !== void 0) headers["Idempotency-Key"] = loose.idempotencyKey;
  const init = { method: meta2.method, headers };
  if (loose.body !== void 0) {
    const body = JSON.stringify(loose.body);
    if (utf8Length(body) > HERDR_FETCH_MAX_BODY_BYTES) {
      return err({ kind: "too-large", url, direction: "request", limitBytes: HERDR_FETCH_MAX_BODY_BYTES });
    }
    headers["Content-Type"] = "application/json";
    init.body = body;
  }
  const started = now();
  let status;
  let text;
  let finalUrl;
  try {
    const response = await fetch2(url, init);
    status = response.status;
    finalUrl = response.url;
    text = await response.text();
  } catch (cause) {
    const failure2 = transportFailure(url, cause, hostElapsedMs(cause) ?? now() - started);
    if (mutation && !(failure2.kind === "too-large" && failure2.direction === "request")) {
      return err({ kind: "outcome-unknown", requestId: null, operationId: op, cause: failure2.kind });
    }
    return err(failure2);
  }
  if (originOf(finalUrl) !== originOf(baseUrl)) {
    if (mutation) {
      return err({ kind: "outcome-unknown", requestId: null, operationId: op, cause: "redirected", issues: [`answered from ${finalUrl}`] });
    }
    return err({ kind: "not-loopback", url: finalUrl });
  }
  if (status < 200 || status > 299) return err(httpError(op, status, text));
  let decoded;
  try {
    const json = JSON.parse(text);
    decoded = meta2.item ? decodeListed(meta2.response, meta2.item, json, op) : decodeValue(meta2.response, json, op);
  } catch (cause) {
    decoded = err({ kind: "decode", operationId: op, path: "", issues: [`(root): body is not JSON: ${messageOf(cause)}`] });
  }
  if (!decoded.ok && mutation) {
    return err({ kind: "outcome-unknown", requestId: null, operationId: op, cause: "unreadable-response", issues: decoded.error.issues });
  }
  return decoded;
}

// src/discovery/settings.ts
var SETTINGS_KEY = "gascity.settings";
var DEFAULT_GC_BIN = "gc";
var API = `shared("${SETTINGS_KEY}")`;
var GC_BIN = /^(gc|(\/[^\0-\x1f\x7f]*)?\/gc)$/;
function invalid(path, issue2) {
  return { kind: "host-decode", api: API, path, issues: [path === "" ? issue2 : `${path}: ${issue2}`] };
}
function gcBinIssue(gcBin) {
  return GC_BIN.test(gcBin) ? null : `must be "gc" or an absolute path to a program named gc, not ${JSON.stringify(gcBin)}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decodeSettings(raw) {
  if (raw === void 0 || raw === null) return ok({ apiUrl: null, gcBin: DEFAULT_GC_BIN });
  if (!isRecord(raw)) return err(invalid("", `expected an object, got ${JSON.stringify(raw)}`));
  const { apiUrl, gcBin } = raw;
  if (apiUrl !== void 0 && (typeof apiUrl !== "string" || apiUrl === "")) {
    return err(invalid("apiUrl", `expected a non-empty string, got ${JSON.stringify(apiUrl)}`));
  }
  if (gcBin !== void 0) {
    if (typeof gcBin !== "string") return err(invalid("gcBin", `expected a string, got ${JSON.stringify(gcBin)}`));
    const issue2 = gcBinIssue(gcBin);
    if (issue2) return err(invalid("gcBin", issue2));
  }
  return ok({ apiUrl: apiUrl ?? null, gcBin: gcBin ?? DEFAULT_GC_BIN });
}

// src/host.ts
var REQUIRED_HOST_EXPORTS = ["theme", "props", "shared", "home", "readTextFile", "exec", "fetch", "localStorage"];
function missingHostExports() {
  const present = {
    theme: typeof herdr.theme === "function",
    props: typeof herdr.props === "function",
    shared: typeof herdr.shared === "function",
    home: typeof herdr.home === "function",
    readTextFile: typeof herdr.readTextFile === "function",
    exec: typeof herdr.exec === "function",
    fetch: typeof fetch === "function",
    localStorage: typeof localStorage === "object" && localStorage !== null
  };
  return REQUIRED_HOST_EXPORTS.filter((name) => !present[name]);
}
function messageOf2(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function readProps() {
  return herdr.props();
}
function readSharedSettings() {
  return herdr.shared(SETTINGS_KEY);
}
var hostFetch = (url, init) => fetch(url, init);
var LAST_CITY_KEY = "city";
function readLastCity() {
  try {
    const value = localStorage.getItem(LAST_CITY_KEY);
    return ok(value === "" ? null : value);
  } catch (cause) {
    return err({ kind: "host-call", api: `localStorage.getItem("${LAST_CITY_KEY}")`, cause: messageOf2(cause) });
  }
}
function rememberCity(city) {
  try {
    localStorage.setItem(LAST_CITY_KEY, city);
    return ok(null);
  } catch (cause) {
    return err({ kind: "host-call", api: `localStorage.setItem("${LAST_CITY_KEY}")`, cause: messageOf2(cause) });
  }
}
function supervisorConfigPath() {
  return `${herdr.home().replace(/\/+$/, "")}/.gc/supervisor.toml`;
}
async function readSupervisorConfig() {
  const path = supervisorConfigPath();
  try {
    return ok({ path, text: await herdr.readTextFile(path) });
  } catch (cause) {
    return err({ kind: "host-call", api: `readTextFile(${path})`, cause: messageOf2(cause) });
  }
}
var GC_STATUS_TIMEOUT_MS = 1e4;
var STDERR_LIMIT = 2e3;
async function execGcStatus(gcBin) {
  const argv = [gcBin, ...GC_STATUS_ARGS];
  const refused = gcBinIssue(gcBin);
  if (refused) return err({ kind: "exec", argv, code: null, stderr: `not run: gcBin ${refused}` });
  return herdr.exec(gcBin, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS }).then(
    (result) => result.code === 0 ? ok(result.stdout) : err({ kind: "exec", argv, code: result.code, stderr: result.stderr.trim().slice(0, STDERR_LIMIT) }),
    (cause) => err({ kind: "exec", argv, code: null, stderr: messageOf2(cause) })
  );
}
var HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function isColor(value) {
  return HEX_COLOR.test(value);
}
function readTheme() {
  const theme2 = herdr.theme();
  const issues = [];
  const pick2 = (name) => {
    const value = Object.hasOwn(theme2, name) ? theme2[name] : void 0;
    if (value === void 0) {
      issues.push(`herdr theme has no colour "${name}"`);
      return void 0;
    }
    if (!isColor(value)) {
      issues.push(`herdr theme colour "${name}" is not a #rgb, #rrggbb or #rrggbbaa value: ${value}`);
      return void 0;
    }
    return value;
  };
  const colors = { background: pick2("background"), foreground: pick2("foreground"), muted: pick2("muted") };
  return { colors, issues };
}

// src/discovery/city.ts
var PROPS_API = "props()";
function decodeCopy(props2, lastSelection) {
  if (props2 === null || props2 === void 0) return ok({ pinned: null, lastSelection });
  if (typeof props2 !== "object" || Array.isArray(props2)) {
    return err({ kind: "host-decode", api: PROPS_API, path: "", issues: [`(root): expected an object or null, got ${JSON.stringify(props2)}`] });
  }
  if (!Object.hasOwn(props2, "city")) return ok({ pinned: null, lastSelection });
  const city = props2["city"];
  if (typeof city !== "string" || city === "") {
    return err({ kind: "host-decode", api: PROPS_API, path: "city", issues: [`city: expected a non-empty string, got ${JSON.stringify(city)}`] });
  }
  return ok({ pinned: city, lastSelection });
}
function initialMachine(copy) {
  return { copy, state: { phase: "discovering" } };
}
function selectedCity(state) {
  switch (state.phase) {
    case "city-running":
    case "city-stopped":
      return state.city.name;
    case "city-unknown":
      return state.city;
    case "cities-failed":
      return state.selected;
    default:
      return null;
  }
}
function noticesOf(state, city) {
  if ((state.phase === "city-running" || state.phase === "city-stopped") && state.city.name === city) return state.notices;
  return [];
}
function withCities(prev, copy, endpoint, cities, current) {
  const listed = (name2) => name2 === null ? void 0 : cities.items.find((c) => c.name === name2);
  let name = copy.pinned ?? current;
  if (name === null) name = listed(copy.lastSelection)?.name ?? null;
  if (name === null) {
    const running = cities.items.filter((c) => c.running);
    if (running.length === 1) name = running[0].name;
  }
  if (name === null) return { phase: "choose-city", endpoint, cities };
  const info = listed(name);
  if (!info) return { phase: "city-unknown", endpoint, cities, city: name };
  const notices = noticesOf(prev, name);
  if (info.running) return { phase: "city-running", endpoint, cities, city: info, notices };
  return { phase: "city-stopped", endpoint, cities, city: info, cause: "list", notices };
}
function endpointOf(state) {
  return "endpoint" in state ? state.endpoint : null;
}
function citiesOf(state) {
  return "cities" in state ? state.cities : null;
}
function noticeKey(n) {
  return n.kind === "api-missing" ? `api-missing:${n.operationId}` : n.kind;
}
function addNotice(notices, notice) {
  const key = noticeKey(notice);
  return notices.some((n) => noticeKey(n) === key) ? notices : [...notices, notice];
}
function onCityError(state, city, error) {
  if (state.phase !== "city-running" && state.phase !== "city-stopped" || state.city.name !== city) return state;
  switch (error.kind) {
    case "city-not-running":
      return {
        phase: "city-stopped",
        endpoint: state.endpoint,
        cities: state.cities,
        city: { ...state.city, running: false },
        cause: "api",
        notices: state.notices
      };
    case "write-grant-required":
      return { ...state, notices: addNotice(state.notices, { kind: "write-grant-required", detail: error.detail }) };
    case "read-grant-required":
      return { ...state, notices: addNotice(state.notices, { kind: "read-grant-required", detail: error.detail }) };
    case "read-only":
      return { ...state, notices: addNotice(state.notices, { kind: "read-only", detail: error.detail }) };
    case "api-missing":
      return { ...state, notices: addNotice(state.notices, { kind: "api-missing", operationId: error.operationId }) };
  }
}
function step(m, event) {
  const { copy, state } = m;
  switch (event.type) {
    case "discover":
      return { copy, state: { phase: "discovering" } };
    case "resolved":
      return {
        copy,
        state: event.result.ok ? { phase: "listing", endpoint: event.result.value } : { phase: "no-endpoint", failure: event.result.error }
      };
    case "cities": {
      const endpoint = endpointOf(state);
      if (endpoint === null) return m;
      const current = selectedCity(state);
      if (!event.result.ok) return { copy, state: { phase: "cities-failed", endpoint, error: event.result.error, selected: current } };
      return { copy, state: withCities(state, copy, endpoint, event.result.value, current) };
    }
    case "select": {
      const endpoint = endpointOf(state);
      const cities = citiesOf(state);
      if (copy.pinned !== null || endpoint === null || cities === null) return m;
      const next = { ...copy, lastSelection: event.city };
      return { copy: next, state: withCities(state, next, endpoint, cities, event.city) };
    }
    case "city-error": {
      const next = onCityError(state, event.city, event.error);
      return next === state ? m : { copy, state: next };
    }
  }
}

// src/gc/ops.ts
function getHealth(c) {
  return c.call("get-health", { path: {} });
}
function listCities(c) {
  return c.call("get-v0-cities", { path: {} });
}

// src/discovery/supervisorConfig.ts
var DEFAULT_SUPERVISOR_BIND = "127.0.0.1";
var DEFAULT_SUPERVISOR_PORT = 8372;
var MAX_PORT = 65535;
var BARE_KEY = /^[A-Za-z0-9_-]+$/;
var DECIMAL = /^(0|[1-9][0-9]*)$/;
var ParseFailure = class {
  constructor(line, issue2) {
    this.line = line;
    this.issue = issue2;
  }
  line;
  issue;
};
var Cursor = class {
  constructor(text) {
    this.text = text;
  }
  text;
  pos = 0;
  line = 1;
  get done() {
    return this.pos >= this.text.length;
  }
  peek(offset = 0) {
    return this.text.charAt(this.pos + offset);
  }
  startsWith(s) {
    return this.text.startsWith(s, this.pos);
  }
  advance(n = 1) {
    for (let i = 0; i < n && this.pos < this.text.length; i++) {
      if (this.text.charAt(this.pos) === "\n") this.line++;
      this.pos++;
    }
  }
  fail(issue2, line = this.line) {
    throw new ParseFailure(line, issue2);
  }
  /** Spaces and tabs (not newlines). */
  skipBlanks() {
    while (this.peek() === " " || this.peek() === "	") this.advance();
  }
  /** A comment, if one starts here, up to (not including) the newline. */
  skipComment() {
    if (this.peek() !== "#") return;
    while (!this.done && this.peek() !== "\n") this.advance();
  }
  /** Requires the rest of the line to be blanks and an optional comment, then consumes the newline. */
  endLine() {
    this.skipBlanks();
    this.skipComment();
    if (this.peek() === "\r") this.advance();
    if (this.done) return;
    if (this.peek() !== "\n") this.fail("unexpected text after the value");
    this.advance();
  }
};
function readQuotedKey(c) {
  const quote = c.peek();
  c.advance();
  let out = "";
  for (; ; ) {
    if (c.done || c.peek() === "\n") c.fail("unterminated quoted key");
    const ch = c.peek();
    if (ch === quote) {
      c.advance();
      return out;
    }
    if (quote === '"' && ch === "\\") c.fail("escapes are not supported in quoted keys");
    out += ch;
    c.advance();
  }
}
function readDottedKey(c, stop, what) {
  const parts = [];
  for (; ; ) {
    c.skipBlanks();
    const ch = c.peek();
    if (ch === '"' || ch === "'") {
      parts.push(readQuotedKey(c));
    } else {
      let bare = "";
      while (!c.done && BARE_KEY.test(c.peek())) {
        bare += c.peek();
        c.advance();
      }
      if (bare === "") c.fail(what);
      parts.push(bare);
    }
    c.skipBlanks();
    if (c.peek() === ".") {
      c.advance();
      continue;
    }
    if (c.peek() === stop) return parts;
    c.fail(what);
  }
}
function skipString(c) {
  const quote = c.peek();
  const startLine = c.line;
  const triple = quote.repeat(3);
  if (c.startsWith(triple)) {
    c.advance(3);
    for (; ; ) {
      if (c.done) c.fail("unterminated string", startLine);
      if (quote === '"' && c.peek() === "\\") {
        c.advance(2);
        continue;
      }
      if (c.startsWith(triple)) {
        c.advance(3);
        if (c.peek() === quote) c.advance();
        if (c.peek() === quote) c.advance();
        return;
      }
      c.advance();
    }
  }
  c.advance();
  for (; ; ) {
    if (c.done || c.peek() === "\n") c.fail("unterminated string", startLine);
    if (quote === '"' && c.peek() === "\\") {
      c.advance(2);
      continue;
    }
    if (c.peek() === quote) {
      c.advance();
      return;
    }
    c.advance();
  }
}
function skipValue(c) {
  const startLine = c.line;
  let depth = 0;
  for (; ; ) {
    if (c.done) {
      if (depth > 0) c.fail("unterminated array or inline table", startLine);
      return;
    }
    const ch = c.peek();
    if (ch === '"' || ch === "'") skipString(c);
    else if (ch === "#") c.skipComment();
    else if (ch === "[" || ch === "{") {
      depth++;
      c.advance();
    } else if (ch === "]" || ch === "}") {
      if (depth === 0) c.fail("unbalanced bracket");
      depth--;
      c.advance();
    } else if (ch === "\n" && depth === 0) {
      return;
    } else c.advance();
  }
}
function lineValue(c) {
  let out = "";
  while (!c.done && c.peek() !== "\n" && c.peek() !== "#") {
    out += c.peek();
    c.advance();
  }
  return out.replace(/\r$/, "").trim();
}
function readPort(c) {
  const line = c.line;
  const raw = lineValue(c);
  if (/^\d+\s+\S/.test(raw)) c.fail("unexpected text after the value", line);
  if (!DECIMAL.test(raw)) c.fail(`port must be a whole number from 0 to ${MAX_PORT}, written in decimal: ${raw}`, line);
  const port = Number(raw);
  if (port > MAX_PORT) c.fail(`port ${port} is out of range (0-${MAX_PORT})`, line);
  return port === 0 ? null : port;
}
function readBind(c) {
  const line = c.line;
  const quote = c.peek();
  if (quote !== '"' && quote !== "'" || c.startsWith(quote.repeat(3))) {
    c.fail(`bind must be a string on one line: ${lineValue(c)}`, line);
  }
  c.advance();
  let out = "";
  for (; ; ) {
    if (c.done || c.peek() === "\n") c.fail("unterminated string", line);
    const ch = c.peek();
    if (ch === quote) {
      c.advance();
      break;
    }
    if (quote === '"' && ch === "\\") c.fail("bind: escapes are not supported", line);
    out += ch;
    c.advance();
  }
  return out === "" ? null : out;
}
function samePath(a, b) {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}
function parseSupervisorConfig(text, path) {
  const c = new Cursor(text);
  const result = { bind: null, port: null };
  const seen = /* @__PURE__ */ new Set();
  let table = [];
  let supervisorHeaderSeen = false;
  try {
    while (!c.done) {
      c.skipBlanks();
      c.skipComment();
      if (c.peek() === "\r") c.advance();
      if (c.done) break;
      if (c.peek() === "\n") {
        c.advance();
        continue;
      }
      const line = c.line;
      if (c.peek() === "[") {
        const arrayOfTables = c.peek(1) === "[";
        c.advance(arrayOfTables ? 2 : 1);
        if (c.done || c.peek() === "\n") c.fail("unterminated table header", line);
        const name = readDottedKey(c, "]", "unterminated table header");
        c.advance();
        if (arrayOfTables) {
          if (c.peek() !== "]") c.fail("unterminated table header", line);
          c.advance();
        }
        if (name[0] === "supervisor" && name.length === 1) {
          if (arrayOfTables) c.fail("supervisor must be a [supervisor] table", line);
          if (supervisorHeaderSeen) c.fail("[supervisor] is defined twice", line);
          supervisorHeaderSeen = true;
        }
        table = name;
        c.endLine();
        continue;
      }
      const key = [...table, ...readDottedKey(c, "=", "expected `key = value` or a [table] header")];
      c.advance();
      c.skipBlanks();
      if (samePath(key, ["supervisor"])) c.fail("supervisor must be a [supervisor] table", line);
      const which = samePath(key, ["supervisor", "port"]) ? "port" : samePath(key, ["supervisor", "bind"]) ? "bind" : null;
      if (which === null) {
        skipValue(c);
      } else {
        if (seen.has(which)) c.fail(`${which} is set twice`, line);
        seen.add(which);
        if (which === "port") result.port = readPort(c);
        else result.bind = readBind(c);
      }
      c.endLine();
    }
  } catch (e) {
    if (e instanceof ParseFailure) return err({ kind: "supervisor-config", path, line: e.line, issue: e.issue });
    throw e;
  }
  return ok(result);
}
function supervisorApiUrl(listen) {
  let bind = listen.bind ?? DEFAULT_SUPERVISOR_BIND;
  if (bind === "0.0.0.0") bind = "127.0.0.1";
  else if (bind === "::" || bind === "[::]") bind = "::1";
  const host = bind.includes(":") && !bind.startsWith("[") ? `[${bind}]` : bind;
  return `http://${host}:${listen.port ?? DEFAULT_SUPERVISOR_PORT}`;
}

// src/discovery/resolve.ts
var DEFAULT_API_URL = "http://127.0.0.1:8372";
var HEALTH_PROBE_MS = 5e3;
var SOURCE_NAMES = {
  setting: "the apiUrl setting",
  "gc-reported": "gc supervisor status",
  "supervisor-config": "supervisor.toml",
  default: "the default"
};
async function probe(host, client) {
  const deadline = host.sleep(HEALTH_PROBE_MS).then(() => err({ kind: "timeout", url: `${client.baseUrl}/health`, ms: HEALTH_PROBE_MS }));
  return Promise.race([getHealth(client), deadline]);
}
async function resolveEndpoint(host) {
  const attempts = [];
  const settings = decodeSettings(host.settings());
  if (!settings.ok) return err({ reason: "invalid", source: "setting", error: settings.error, attempts });
  const { apiUrl, gcBin } = settings.value;
  const sources = [
    ["setting", async () => apiUrl === null ? { kind: "absent", detail: "no apiUrl setting" } : { kind: "url", url: apiUrl }],
    ["gc-reported", async () => {
      const ran = await host.gcStatus(gcBin);
      if (!ran.ok) return { kind: "unavailable", error: ran.error };
      const parsed = parseGcStatus(ran.value);
      if (!parsed.ok) return { kind: "unavailable", error: parsed.error };
      return parsed.value === null ? { kind: "absent", detail: `${GC_STATUS_COMMAND} reports no api_url` } : { kind: "url", url: parsed.value };
    }],
    ["supervisor-config", async () => {
      const read = await host.readSupervisorConfig();
      if (!read.ok) return { kind: "invalid", error: read.error };
      if (read.value.text === null) return { kind: "absent", detail: `${read.value.path} does not exist` };
      const listen = parseSupervisorConfig(read.value.text, read.value.path);
      return listen.ok ? { kind: "url", url: supervisorApiUrl(listen.value) } : { kind: "invalid", error: listen.error };
    }],
    ["default", async () => ({ kind: "url", url: DEFAULT_API_URL })]
  ];
  const probed = /* @__PURE__ */ new Map();
  for (const [source, candidate] of sources) {
    const c = await candidate();
    if (c.kind === "absent") {
      attempts.push({ source, outcome: "absent", detail: c.detail });
      continue;
    }
    if (c.kind === "unavailable") {
      attempts.push({ source, outcome: "unavailable", error: c.error });
      continue;
    }
    if (c.kind === "invalid") return err({ reason: "invalid", source, error: c.error, attempts });
    const client = createGcClient({ baseUrl: c.url, fetch: host.fetch });
    if (!client.ok) {
      attempts.push({ source, outcome: "refused", url: c.url, error: client.error });
      return err({ reason: "refused", source, error: client.error, attempts });
    }
    const url = client.value.baseUrl;
    const earlier = probed.get(url);
    if (earlier !== void 0) {
      attempts.push({ source, outcome: "absent", detail: `same URL as ${SOURCE_NAMES[earlier]}, already tried` });
      continue;
    }
    probed.set(url, source);
    const health = await probe(host, client.value);
    if (!health.ok) {
      attempts.push({ source, outcome: "unreachable", url, error: health.error });
      continue;
    }
    attempts.push({ source, outcome: "ok", url, version: health.value.version });
    return ok({ url, source, version: health.value.version, gcBin, attempts });
  }
  return err({ reason: "none-reachable", attempts });
}

// src/discovery/controller.ts
var HOST_ERROR_LIMIT = 20;
var DiscoveryController = class {
  constructor(host, copy) {
    this.host = host;
    this.machine = initialMachine(copy);
  }
  host;
  machine;
  /** Host calls that failed outside the machine (e.g. remembering the city); shown, newest last. */
  hostErrors = [];
  generation = 0;
  /** Applies one event. */
  apply(event) {
    this.machine = step(this.machine, event);
  }
  /**
   * Discovers from scratch: endpoint, then cities. A newer run supersedes an
   * older one; the older one's late results are not applied, since they
   * describe a discovery the person already replaced.
   */
  async run(task) {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.apply({ type: "discover" });
    task.notify();
    const resolved = await resolveEndpoint({ ...this.host, sleep: (ms) => task.sleep(ms) });
    if (!current()) return;
    this.apply({ type: "resolved", result: resolved });
    task.notify();
    if (!resolved.ok) return;
    const client = createGcClient({ baseUrl: resolved.value.url, fetch: this.host.fetch });
    const cities = client.ok ? await listCities(client.value) : client;
    if (!current()) return;
    this.apply({ type: "cities", result: cities });
    task.notify();
  }
  /** The person chose a city; an unpinned copy remembers it. */
  select(city) {
    const before = this.machine;
    this.apply({ type: "select", city });
    if (this.machine === before) return;
    const remembered = this.host.rememberCity(city);
    if (!remembered.ok) this.hostErrors = [...this.hostErrors, remembered.error].slice(-HOST_ERROR_LIMIT);
  }
};

// src/vm/errorText.ts
var LOOPBACK_ONLY = "only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed";
function seconds(ms) {
  return `${Math.round(ms / 1e3)} s`;
}
function drift(value) {
  return isUnrecognized(value) ? value.raw : String(value);
}
function errorText(e) {
  switch (e.kind) {
    case "unreachable":
      return `cannot reach ${e.url}: ${e.cause}`;
    case "timeout":
      return `no answer from ${e.url} within ${seconds(e.ms)}`;
    case "too-large":
      return `the ${e.direction} at ${e.url} is over herdr's ${e.limitBytes} byte limit`;
    case "http": {
      const detail = e.problem ? e.problem.detail ?? e.problem.title ?? "" : e.raw ?? "";
      return detail === "" ? `gc answered ${e.status}` : `gc answered ${e.status}: ${detail}`;
    }
    case "csrf-rejected":
      return "gc refused a change without X-GC-Request (a bug in the mod)";
    case "read-only":
      return `gc serves this API read-only (${e.detail})`;
    case "write-grant-required":
      return `this city requires a signed write grant (${e.detail})`;
    case "read-grant-required":
      return `this city requires a signed read grant (${e.detail})`;
    case "city-not-running":
      return `city "${e.city}" is not running`;
    case "api-missing":
      return `gc too old (needs ${e.operationId})`;
    case "decode":
      return `unreadable answer to ${e.operationId}${e.path === "" ? "" : ` at ${e.path}`}: ${e.issues.join("; ")}`;
    case "outcome-failed":
      return `request ${e.requestId} (${drift(e.operation)}) failed: ${e.payload.error_code}: ${e.payload.error_message}`;
    case "outcome-unknown":
      return `outcome of ${e.operationId} unknown (${e.cause})`;
    case "exec":
      return e.code === null ? `${e.argv.join(" ")} did not run: ${e.stderr}` : `${e.argv.join(" ")} exited with code ${e.code}: ${e.stderr}`;
    case "host-incompatible":
      return `this herdr-app lacks ${e.missing.join(", ")}`;
    case "host-decode":
      return `unreadable ${e.api}${e.path === "" ? "" : ` at ${e.path}`}: ${e.issues.join("; ")}`;
    case "host-call":
      return `${e.api} failed: ${e.cause}`;
    case "supervisor-config":
      return `${e.path} line ${e.line}: ${e.issue}`;
    case "attach-not-started":
      return `terminal for ${e.sessionId} not opened (${e.reason}): ${e.detail}`;
    case "not-loopback":
      return LOOPBACK_ONLY;
  }
}

// src/vm/header.ts
var SOURCE_LABELS = {
  setting: "apiUrl setting",
  "gc-reported": "gc supervisor status",
  "supervisor-config": "~/.gc/supervisor.toml",
  default: "built-in default"
};
function cityLabel(c) {
  return c.running ? "running" : c.status ?? "stopped";
}
function attemptLine(a) {
  const label = SOURCE_LABELS[a.source];
  switch (a.outcome) {
    case "absent":
      return `${label}: ${a.detail}`;
    case "unavailable":
      return `${label}: ${errorText(a.error)}`;
    case "refused":
      return `${label}: ${a.url} refused: ${errorText(a.error)}`;
    case "unreachable":
      return `${label}: ${a.url} unreachable: ${errorText(a.error)}`;
    case "ok":
      return `${label}: ${a.url} ok (gc ${a.version})`;
  }
}
function noEndpointChip(failure2) {
  if (failure2.reason === "refused") {
    const url = failure2.error.kind === "not-loopback" ? failure2.error.url : "";
    return `refusing ${url} (${SOURCE_LABELS[failure2.source]}): ${LOOPBACK_ONLY}`;
  }
  if (failure2.reason === "invalid") {
    const what = failure2.source === "setting" ? "gascity.settings" : SOURCE_LABELS[failure2.source];
    return `cannot use ${what}: ${errorText(failure2.error)}`;
  }
  const tried = failure2.attempts.filter((a) => a.outcome === "unreachable");
  const first = tried[0];
  if (!first) return "gc not reachable";
  const more = tried.length > 1 ? `; ${tried.length - 1} more tried` : "";
  return `gc not reachable at ${first.url} (${SOURCE_LABELS[first.source]})${more}`;
}
function isTransport(e) {
  return e.kind === "unreachable" || e.kind === "timeout";
}
function noticeBanner(n, version2) {
  switch (n.kind) {
    case "write-grant-required":
      return `This city requires signed write grants; the Herdr mod does not mint them, so it is read-only here (gc: ${n.detail}).`;
    case "read-grant-required":
      return `This city requires signed read grants; the Herdr mod does not mint them, so it cannot show this city's data (gc: ${n.detail}).`;
    case "read-only":
      return `gc serves this API read-only (${n.detail}).`;
    case "api-missing":
      return `gc ${version2} lacks ${n.operationId}: update gc.`;
  }
}
function runningChip(notices) {
  if (notices.some((n) => n.kind === "read-grant-required")) return { tone: "error", text: "read grant required" };
  const readOnly = notices.find((n) => n.kind === "read-only");
  if (readOnly) return { tone: "warn", text: "read-only server" };
  const missing = notices.find((n) => n.kind === "api-missing");
  if (missing) return { tone: "warn", text: `gc too old (needs ${missing.operationId})` };
  if (notices.some((n) => n.kind === "write-grant-required")) return { tone: "warn", text: "connected, read-only" };
  return { tone: "ok", text: "connected" };
}
function chipOf(state) {
  switch (state.phase) {
    case "discovering":
      return { tone: "busy", text: "looking for gc" };
    case "no-endpoint":
      return { tone: "error", text: noEndpointChip(state.failure) };
    case "listing":
      return { tone: "busy", text: `loading cities from ${state.endpoint.url}` };
    case "cities-failed": {
      const e = state.error;
      if (isTransport(e)) return { tone: "error", text: `gc not reachable at ${state.endpoint.url} (${SOURCE_LABELS[state.endpoint.source]})` };
      return { tone: "error", text: errorText(e) };
    }
    case "choose-city":
      return { tone: "warn", text: state.cities.items.length === 0 ? "gc manages no cities" : "choose a city" };
    case "city-unknown":
      return { tone: "error", text: `city "${state.city}" is not registered with gc at ${state.endpoint.url}` };
    case "city-stopped": {
      const status = state.cause === "api" ? "gc answered: not running" : state.city.status ?? "not running";
      const error = state.city.error ? `: ${state.city.error}` : "";
      return { tone: "warn", text: `city stopped (${status})${error}` };
    }
    case "city-running":
      return runningChip(state.notices);
  }
}
function headerModel(m, hostErrors = []) {
  const { state, copy } = m;
  const endpoint = "endpoint" in state ? state.endpoint : null;
  const cities = "cities" in state ? state.cities : null;
  const cityName = state.phase === "city-running" || state.phase === "city-stopped" ? state.city.name : state.phase === "city-unknown" ? state.city : null;
  const banners = [];
  if ((state.phase === "city-running" || state.phase === "city-stopped") && endpoint) {
    for (const n of state.notices) banners.push(noticeBanner(n, endpoint.version));
  }
  if (cities && cities.unreadable.length > 0) {
    const n = cities.unreadable.length;
    banners.push(`${n} city ${n === 1 ? "entry" : "entries"} from gc could not be read (see diagnostics).`);
  }
  for (const e of hostErrors) banners.push(`Herdr: ${errorText(e)}.`);
  const attempts = endpoint ? endpoint.attempts : state.phase === "no-endpoint" ? state.failure.attempts : [];
  const diagnostics = attempts.map(attemptLine);
  if (state.phase === "no-endpoint" && state.failure.reason === "invalid") {
    diagnostics.push(`${SOURCE_LABELS[state.failure.source]}: ${errorText(state.failure.error)}`);
  }
  for (const u of cities?.unreadable ?? []) {
    diagnostics.push(`unreadable city ${u.id ?? "(no name)"} (items[${u.index}]): ${errorText(u.error)}`);
  }
  const offerChoice = copy.pinned === null && cities !== null && (state.phase === "choose-city" || state.phase === "city-unknown" || state.phase === "city-running" || state.phase === "city-stopped");
  const choices = offerChoice ? cities.items.filter((c) => c.name !== cityName).map((c) => ({ name: c.name, label: cityLabel(c) })) : null;
  return {
    chip: chipOf(state),
    endpoint: endpoint ? `gc ${endpoint.version} at ${endpoint.url} (from ${SOURCE_LABELS[endpoint.source]})` : null,
    city: cityName === null ? null : copy.pinned !== null ? `${cityName} (pinned)` : cityName,
    others: (cities?.items ?? []).filter((c) => c.name !== cityName).map((c) => ({ name: c.name, running: c.running, label: cityLabel(c) })),
    banners,
    choices,
    canRetry: state.phase !== "discovering" && state.phase !== "listing",
    diagnostics
  };
}

// src/view/panel.ts
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
var TITLE = "Gas City";
function hostIncompatibleText(missing) {
  return `This herdr-app is too old for the Gas City mod: it lacks ${missing.join(", ")}.`;
}
function copyInvalidText(error) {
  return `This copy of the Gas City mod was opened with props it cannot read: ${error}`;
}
function tinted(el, color, apply) {
  return color === void 0 ? el : apply(el, color);
}
function muted(el, theme2) {
  return tinted(el, theme2.colors.muted, (e, c) => e.text_color(c));
}
function themedRoot(theme2) {
  const root = v_flex().id("gascity-root").size_full().p(12).gap(8);
  const { colors } = theme2;
  return tinted(tinted(root, colors.background, (el, c) => el.bg(c)), colors.foreground, (el, c) => el.text_color(c));
}
function themeIssues(el, theme2) {
  return el.when(theme2.issues.length > 0, (e) => e.child(div().id("gascity-host-decode").child(theme2.issues.join("; "))));
}
function header(model) {
  const { header: h, theme: theme2, actions } = model;
  const out = [];
  const status = h_flex().id("gascity-status").gap(8).child(div().id("gascity-chip").child(h.chip.text));
  out.push(h.canRetry ? status.child(div().id("gascity-retry").on_click((_, cx) => actions.retry(cx)).child("Retry now")) : status);
  if (h.endpoint !== null) out.push(muted(div().id("gascity-endpoint"), theme2).child(h.endpoint));
  if (h.city !== null) out.push(div().id("gascity-city").child(`City: ${h.city}`));
  h.banners.forEach((text, i) => out.push(div().id(`gascity-banner-${i}`).child(text)));
  if (h.others.length > 0) {
    const others = h.others.map((o) => `${o.name} (${o.label})`).join(", ");
    out.push(muted(div().id("gascity-others"), theme2).child(`Other cities: ${others}`));
  }
  if (h.choices !== null && h.choices.length > 0) {
    const heading = h.city === null ? "Choose a city:" : "Switch to:";
    const list = v_flex().id("gascity-choices").gap(4).child(div().id("gascity-choices-heading").child(heading));
    out.push(list.children(h.choices.map((c, i) => div().id(`gascity-choose-${i}`).on_click((_, cx) => actions.select(c.name, cx)).child(`${c.name} (${c.label})`))));
  }
  if (h.diagnostics.length > 0) {
    const lines = h.diagnostics.map((line, i) => muted(div().id(`gascity-diagnostic-${i}`), theme2).child(line));
    out.push(v_flex().id("gascity-diagnostics").gap(2).child(div().id("gascity-diagnostics-heading").child("Discovery:")).children(lines));
  }
  return out;
}
function renderPanel(model) {
  const title = div().id("gascity-title").text_size(16).font_semibold().child(TITLE);
  if (model.kind === "host-incompatible") {
    const root2 = v_flex().id("gascity-root").size_full().p(12).gap(8);
    return root2.child(title).child(div().id("gascity-host-incompatible").child(hostIncompatibleText(model.missing)));
  }
  const root = themedRoot(model.theme).child(title);
  if (model.kind === "copy-invalid") {
    return themeIssues(root.child(div().id("gascity-copy-invalid").child(copyInvalidText(model.error))), model.theme);
  }
  return themeIssues(root.children(header(model)), model.theme);
}

// src/main.ts
function discover(discovery, cx) {
  cx.spawn((task) => discovery.run({ notify: () => task.notify(), sleep: (ms) => task.sleep(ms) }));
}
function setUp() {
  const missing = missingHostExports();
  if (missing.length > 0) return { kind: "host-incompatible", missing };
  const last = readLastCity();
  const copy = decodeCopy(readProps(), last.ok ? last.value : null);
  if (!copy.ok) return { kind: "copy-invalid", error: errorText(copy.error) };
  const discovery = new DiscoveryController({
    settings: readSharedSettings,
    gcStatus: execGcStatus,
    readSupervisorConfig,
    fetch: hostFetch,
    rememberCity
  }, copy.value);
  if (!last.ok) discovery.hostErrors.push(last.error);
  return { kind: "ready", discovery };
}
var GasCity = class extends View {
  copy = { kind: "copy-invalid", error: "init has not run" };
  init(_props, cx) {
    this.copy = setUp();
    if (this.copy.kind === "ready") discover(this.copy.discovery, cx);
  }
  render(_cx) {
    const copy = this.copy;
    if (copy.kind === "host-incompatible") return renderPanel({ kind: "host-incompatible", missing: copy.missing });
    const theme2 = readTheme();
    if (copy.kind === "copy-invalid") return renderPanel({ kind: "copy-invalid", theme: theme2, error: copy.error });
    const { discovery } = copy;
    return renderPanel({
      kind: "city",
      theme: theme2,
      header: headerModel(discovery.machine, discovery.hostErrors),
      actions: {
        retry: (cx) => discover(discovery, cx),
        select: (city, cx) => {
          discovery.select(city);
          cx.notify();
        }
      }
    });
  }
};
export {
  GasCity as default
};

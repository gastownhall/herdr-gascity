// herdr-gascity 0.0.0 - the Gas City mod for herdr-app. Built file: do not edit.
// Source: https://github.com/gastownhall/herdr-gascity (src/). `bun run build` rebuilds this file
// byte for byte; source digest sha256:9b321d4e1bf3f62c9ac393fb661e36a9df2fa51ff8d1b961b6ffd9076c9a450c over the git-tracked src/, build.ts, package.json, bun.lock and tsconfig.json.

// src/main.ts
import { View } from "gpui-kit";
import { InputState } from "gpui-base";

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
      const field2 = shape[key]._zod;
      if (field2.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field2.values)
          propValues[key].add(v);
        if (field2.optin !== void 0)
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
  const { id: id2, name } = value;
  if (typeof id2 === "string") return id2;
  if (typeof name === "string") return name;
  return null;
}
function decodeListed(envelope, item, value, operationId) {
  const outer = decodeValue(envelope, value, operationId);
  if (!outer.ok) return outer;
  const items = [];
  const unreadable2 = [];
  outer.value.items.forEach((raw, index) => {
    const decoded = decodeValue(item, raw, operationId, `items[${index}]`);
    if (decoded.ok) items.push(decoded.value);
    else unreadable2.push({ index, id: idOf(raw), error: decoded.error });
  });
  return ok({ ...outer.value, items, unreadable: unreadable2 });
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
var BeadEventPayloadSchema = object({
  bead: BeadSchema
});
var SessionCreateSucceededPayloadSchema = object({
  request_id: string2(),
  session: SessionResponseSchema
});
var SessionSubmitSucceededPayloadSchema = object({
  request_id: string2(),
  session_id: string2(),
  queued: boolean2(),
  intent: string2()
});
var SessionMessageSucceededPayloadSchema = object({
  request_id: string2(),
  session_id: string2(),
  queued: boolean2()
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
var CODE_SESSION_CONFLICT = "session-conflict";
function httpError(operationId, status2, body) {
  const problem = parseProblem(body);
  const detail = problem?.detail ?? "";
  const code = problem?.code;
  if ((status2 === 404 || status2 === 405) && problem === null) {
    const raw = rawText(body);
    return raw === "" || !raw.startsWith("{") ? { kind: "api-missing", operationId } : { kind: "api-missing", operationId, raw };
  }
  if (status2 === 404 && (code === CODE_CITY_NOT_FOUND || code === void 0 && detail.startsWith(CITY_NOT_RUNNING_PREFIX))) {
    return { kind: "city-not-running", city: detail.startsWith(CITY_NOT_RUNNING_PREFIX) ? detail.slice(CITY_NOT_RUNNING_PREFIX.length) : "" };
  }
  if (status2 === 401 && problem) {
    if (detail === "missing X-GC-City-Write grant") return { kind: "write-grant-required", status: 401, detail };
    if (detail === "missing X-GC-City-Read grant") return { kind: "read-grant-required", status: 401, detail };
  }
  if (status2 === 403 && problem) {
    if (detail.startsWith("csrf:")) return { kind: "csrf-rejected" };
    if (detail.startsWith("read_only:")) return { kind: "read-only", detail };
    if (detail === "write grant rejected" || detail.startsWith("workspace-service mutations are disabled")) {
      return { kind: "write-grant-required", status: 403, detail };
    }
    if (detail === "read grant rejected") return { kind: "read-grant-required", status: 403, detail };
  }
  if (problem) return { kind: "http", status: status2, problem };
  return { kind: "http", status: status2, problem: null, raw: rawText(body) };
}
function problemHint(error) {
  if (error.kind !== "http" || error.status !== 409 || !error.problem) return null;
  const { code, detail } = error.problem;
  if (code !== void 0 && code !== CODE_SESSION_CONFLICT) return null;
  return detail?.startsWith("pending_interaction:") ? "answer-pending-prompt" : null;
}
var OUTCOME_OP = "get-request-outcome";
function outcomeFailure(outcome) {
  if (outcome.state === "outcome_unknown") {
    return { kind: "outcome-unknown", requestId: outcome.request_id, operationId: OUTCOME_OP, cause: "reported-by-gc" };
  }
  if (isUnrecognized(outcome.state)) {
    return {
      kind: "outcome-unknown",
      requestId: outcome.request_id,
      operationId: OUTCOME_OP,
      cause: "unrecognized-state",
      issues: [`state: ${outcome.state.raw}`]
    };
  }
  if (outcome.state !== "failed") return null;
  const event = outcome.event;
  if (!event || event.type !== "request.failed") {
    return { kind: "decode", operationId: OUTCOME_OP, path: "event", issues: ["event: a failed outcome must carry a request.failed event"] };
  }
  const payload = decodeValue(RequestFailedPayloadSchema, event.payload, OUTCOME_OP, "event.payload");
  if (!payload.ok) return payload.error;
  return { kind: "outcome-failed", requestId: outcome.request_id, operation: outcome.operation, payload: payload.value };
}
var CODE_IDEMPOTENCY_IN_FLIGHT = "idempotency-in-flight";
function uncertainMutationAnswer(operationId, status2, error) {
  const detail = error.kind === "http" ? error.problem?.detail ?? error.problem?.title ?? error.raw ?? "" : "";
  const issue2 = detail === "" ? `gc answered ${status2}` : `gc answered ${status2}: ${detail}`;
  if (status2 === 409 && error.kind === "http" && error.problem?.code === CODE_IDEMPOTENCY_IN_FLIGHT) {
    return { kind: "outcome-unknown", requestId: null, operationId, cause: "idempotency-in-flight", issues: [issue2] };
  }
  if (status2 >= 500 && status2 !== 501) return { kind: "outcome-unknown", requestId: null, operationId, cause: "server-error", issues: [issue2] };
  return null;
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
function utf8Length(text2) {
  let n = 0;
  for (let i = 0; i < text2.length; i++) {
    const c = text2.charCodeAt(i);
    if (c < 128) n += 1;
    else if (c < 2048) n += 2;
    else if (c >= 55296 && c <= 56319 && i + 1 < text2.length) {
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
function cancelReason(cause) {
  if (cause === null || typeof cause !== "object") return null;
  const v = cause.cancelled;
  return v === "copy-closed" || v === "abandoned" ? v : null;
}
function transportFailure(url, cause, elapsedMs) {
  const cancelled = cancelReason(cause);
  if (cancelled !== null) return { kind: "cancelled", url, reason: cancelled };
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
  let status2;
  let text2;
  let finalUrl;
  try {
    const response = await fetch2(url, init);
    status2 = response.status;
    finalUrl = response.url;
    text2 = await response.text();
  } catch (cause) {
    const failure2 = transportFailure(url, cause, hostElapsedMs(cause) ?? now() - started);
    const neverSent = failure2.kind === "too-large" && failure2.direction === "request" || failure2.kind === "cancelled" && failure2.reason === "abandoned";
    if (mutation && !neverSent) {
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
  if (status2 < 200 || status2 > 299) {
    const e = httpError(op, status2, text2);
    return err((mutation ? uncertainMutationAnswer(op, status2, e) : null) ?? e);
  }
  let decoded;
  try {
    const json = JSON.parse(text2);
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

// src/host.schemas.ts
var TerminalSchema = object({
  address: string2(),
  argv: array(string2()),
  labels: record(string2(), string2()),
  state: enumOf(["live", "finished"]),
  program: object({ shell: boolean2() })
});
var PaneSchema = object({
  pane: string2(),
  tab: string2(),
  terminal: optional(nullable(string2())),
  mod: optional(string2())
});
var SpaceSchema = object({
  id: string2(),
  machine: nullable(string2()),
  active: boolean2(),
  tabs: array(object({ id: string2(), active: boolean2() }))
});
var FocusSchema = nullable(object({ space: string2(), tab: string2() }));
function hostDecode(api, schema, value, path = "") {
  const r = decodeValue(schema, value, api, path);
  return r.ok ? r : err({ kind: "host-decode", api, path: r.error.path, issues: r.error.issues });
}
function hostList(api, schema, value) {
  const list = hostDecode(api, array(unknown()), value);
  if (!list.ok) return list;
  const out = { items: [], errors: [] };
  list.value.forEach((entry, i) => {
    const r = hostDecode(api, schema, entry, `[${i}]`);
    if (r.ok) out.items.push(r.value);
    else out.errors.push(r.error);
  });
  return ok(out);
}
function decodeTerminals(value) {
  return hostList("terminals", TerminalSchema, value);
}
function decodePanes(value) {
  return hostList("panes", PaneSchema, value);
}
function decodeSpaces(value) {
  return hostList("spaces", SpaceSchema, value);
}
function decodeScene(raw) {
  const spaces2 = decodeSpaces(raw.spaces);
  if (!spaces2.ok) return spaces2;
  const panes2 = decodePanes(raw.panes);
  if (!panes2.ok) return panes2;
  const terminals2 = decodeTerminals(raw.terminals);
  if (!terminals2.ok) return terminals2;
  const first = spaces2.value.errors[0] ?? panes2.value.errors[0] ?? terminals2.value.errors[0];
  if (first) return err(first);
  return ok({ spaces: spaces2.value.items, panes: panes2.value.items, terminals: terminals2.value.items });
}
function decodeFocused(value) {
  return hostDecode("focused", FocusSchema, value);
}
function layoutModNames(layout2) {
  const out = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const walk = (v) => {
    if (v === null || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const content = v.content;
    if (content !== null && typeof content === "object" && typeof content.mod === "string") {
      out.add(content.mod);
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(layout2);
  return [...out];
}

// src/hostGuards.ts
function probeDir(appHome2) {
  return `${appHome2.replace(/\/+$/, "")}/data/gascity-probe`;
}
function probePathIssue(path, appHome2) {
  const dir = `${probeDir(appHome2)}/`;
  const name = path.startsWith(dir) ? path.slice(dir.length) : null;
  if (name === null || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name)) return `refused: the mod writes only files in ${dir}, not ${JSON.stringify(path)}`;
  return null;
}

// src/notify/focus.ts
var FOCUS_KEY = "gascity.focus";
var FOCUS_MAX_AGE_MS = 10 * 6e4;
var isText = (v) => typeof v === "string" && v !== "";
var isCount = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function decodeFocus(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value;
  const { city, session, seq, at: at3 } = v;
  if (!isText(city) || !isText(session) || !isCount(seq) || !isCount(at3)) return null;
  return { city, session, seq, at: at3 };
}
function nextFocus(current, city, session, now) {
  return { city, session, seq: (decodeFocus(current)?.seq ?? 0) + 1, at: now };
}
function focusToApply(current, appliedSeq, now) {
  const t = decodeFocus(current);
  if (t === null || t.seq <= appliedSeq) return null;
  if (now - t.at > FOCUS_MAX_AGE_MS || t.at - now > FOCUS_MAX_AGE_MS) return null;
  return t;
}

// src/vm/sanitize.ts
var ESCAPES = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]?|(?:\u001b[\]PX^_]|[\u0090\u009d\u0098\u009e\u009f])[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?|\u001b[@-Z\\-_]?/g;
var CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|\udb40[\udc00-\udc7f]/g;
var BREAKS = /\r\n?|[\u2028\u2029]/g;
function cleanText(text2) {
  return text2.replace(BREAKS, "\n").replace(ESCAPES, "").replace(CONTROLS, "");
}
function cleanLine(text2) {
  return cleanText(text2).replace(/[\n\t]+/g, " ");
}

// src/notify/needsYou.ts
var TOAST_INTERVAL_MS = 3e4;
var BURST_LIMIT = 3;
var SEEN_LIMIT = 1e3;
function toastText(n) {
  return { title: `${n.label} needs you`, body: cleanLine(`${n.kind} · session ${n.session} · city ${n.city}`) };
}
function summaryText(city, more) {
  return { title: `${more} more sessions need you`, body: cleanLine(`city ${city}`) };
}
var keyOf = (n) => `${n.session}\0${n.requestId}`;
var NeedsYouNotifier = class {
  constructor(city) {
    this.city = city;
  }
  city;
  baseline = false;
  lastList = null;
  /** Pairs posted, covered by a summary, or in the baseline. */
  posted = /* @__PURE__ */ new Set();
  /** Pairs to post once their session's window has passed, oldest first. */
  waiting = /* @__PURE__ */ new Map();
  lastToast = /* @__PURE__ */ new Map();
  /**
   * What to post now, given the store's current pending list (null: not
   * fetched yet) and session list. Call on every tick: a waiting prompt
   * becomes due with time alone.
   */
  observe(pending, sessions, now) {
    const batch = { city: this.city, toasts: [], more: 0 };
    if (pending === null) return batch;
    if (pending !== this.lastList) {
      this.lastList = pending;
      this.take(pending, sessions);
    }
    const due = [];
    const taken = /* @__PURE__ */ new Set();
    for (const [key, n] of this.waiting) {
      if (taken.has(n.session)) continue;
      const last = this.lastToast.get(n.session);
      if (last !== void 0 && now - last < TOAST_INTERVAL_MS) continue;
      taken.add(n.session);
      due.push([key, n]);
    }
    for (const [key, n] of due) {
      this.waiting.delete(key);
      this.remember(key);
      this.lastToast.set(n.session, now);
    }
    batch.toasts = due.slice(0, BURST_LIMIT).map(([, n]) => n);
    batch.more = Math.max(0, due.length - BURST_LIMIT);
    return batch;
  }
  /** Toasts the host could not post: tried again once their session's window has passed. */
  failed(items, now) {
    for (const n of items) {
      const key = keyOf(n);
      this.posted.delete(key);
      this.waiting.set(key, n);
      this.lastToast.set(n.session, now);
    }
  }
  take(pending, sessions) {
    const present = /* @__PURE__ */ new Set();
    for (const p of pending.items) {
      const key = keyOf({ session: p.session_id, requestId: p.request_id });
      present.add(key);
      if (this.posted.has(key) || this.waiting.has(key)) continue;
      if (!this.baseline) {
        this.remember(key);
        continue;
      }
      const s = sessions?.items.find((x) => x.id === p.session_id);
      const label2 = cleanLine(s?.alias || s?.template || p.session_id);
      this.waiting.set(key, { city: this.city, session: p.session_id, requestId: p.request_id, label: label2, kind: cleanLine(p.kind) });
    }
    if (!pending.partial && (pending.unreadable?.length ?? 0) === 0) {
      for (const key of [...this.waiting.keys()]) if (!present.has(key)) this.waiting.delete(key);
    }
    this.baseline = true;
  }
  remember(key) {
    this.posted.add(key);
    if (this.posted.size <= SEEN_LIMIT) return;
    const oldest = this.posted.values().next().value;
    if (oldest !== void 0) this.posted.delete(oldest);
  }
};

// src/notify/window.ts
function overlayOf(props2) {
  if (typeof props2 !== "object" || props2 === null || Array.isArray(props2)) return null;
  const v = props2["overlay"];
  return typeof v === "string" && v !== "" ? v : null;
}
var WINDOW_REFRESH_MS = 5e3;
var WINDOW_TTL_MS = 15e3;
function windowFlag(now) {
  return { open: true, at: now };
}
function windowOpenAt(value, now) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value;
  const at3 = v["at"];
  return v["open"] === true && typeof at3 === "number" && Number.isFinite(at3) && Math.abs(now - at3) <= WINDOW_TTL_MS;
}

// src/terminal/argv.ts
var HC_SCRUB = ["env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET"];
var NO_START_FLAG = "--no-start";
var NO_START_MIN_GC = "1.6.0";
var RELEASE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
function release(version2) {
  const m = RELEASE.exec(version2);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function supportsNoStart(version2) {
  const have = release(version2);
  const need = release(NO_START_MIN_GC);
  if (have === null || need === null) return false;
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
var SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function sessionIdIssue(id2) {
  return SESSION_ID.test(id2) ? null : `session id ${JSON.stringify(id2)} is not a gc session id`;
}
function cityPathIssue(path) {
  if (!path.startsWith("/")) return `city path ${JSON.stringify(path)} is not absolute`;
  if (/[\u0000-\u001f\u007f]/.test(path)) return `city path ${JSON.stringify(path)} has a control character`;
  if (path.split("/").includes("..")) return `city path ${JSON.stringify(path)} has a ".." segment`;
  return null;
}
function attachTail(t) {
  return [t.gcBin, "--city", t.cityPath, "session", "attach", t.sessionId];
}
function attachArgv(t, noStart) {
  return [...HC_SCRUB, ...attachTail(t), ...noStart ? [NO_START_FLAG] : []];
}
function endsWith(argv, tail) {
  if (argv.length < tail.length) return false;
  const start = argv.length - tail.length;
  return tail.every((w, i) => argv[start + i] === w);
}
function isAttachOf(argv, t) {
  const tail = [...HC_SCRUB, ...attachTail(t)];
  return endsWith(argv, tail) || endsWith(argv, [...tail, NO_START_FLAG]);
}
function attachArgvIssue(argv) {
  const n = HC_SCRUB.length;
  if (!HC_SCRUB.every((w, i) => argv[i] === w)) return `the argv does not start with ${HC_SCRUB.join(" ")}`;
  const [gcBin, city, path, verb, sub, id2, ...rest] = argv.slice(n);
  if (gcBin === void 0 || city !== "--city" || path === void 0 || verb !== "session" || sub !== "attach" || id2 === void 0) {
    return "the argv is not <gc> --city <path> session attach <id> after the env prefix";
  }
  if (rest.length > 1 || rest.length === 1 && rest[0] !== NO_START_FLAG) return `unexpected arguments after the session id: ${JSON.stringify(rest)}`;
  return gcBinIssue(gcBin) ?? cityPathIssue(path) ?? sessionIdIssue(id2);
}

// src/sync/visibility.ts
var MOD_NAME = "gascity";
function mayBeOnScreen(input) {
  if (input.windowOpen) return true;
  if (input.layoutMods.includes(MOD_NAME)) return true;
  const focus = input.focus;
  if (focus === null) return false;
  return input.panes.some((p) => p.mod === MOD_NAME && p.tab === focus.tab);
}

// src/host.ts
var REQUIRED_HOST_EXPORTS = [
  "theme",
  "props",
  "shared",
  "home",
  "readTextFile",
  "exec",
  "fetch",
  "localStorage",
  "panes",
  "focused",
  "layout",
  "appHome",
  "writeTextFile",
  "setShared",
  "notify",
  "nextCommand",
  "run",
  "closeOverlay",
  "terminals",
  "spaces"
];
function missingHostExports() {
  const present = {
    theme: typeof herdr.theme === "function",
    props: typeof herdr.props === "function",
    shared: typeof herdr.shared === "function",
    home: typeof herdr.home === "function",
    readTextFile: typeof herdr.readTextFile === "function",
    exec: typeof herdr.exec === "function",
    fetch: typeof fetch === "function",
    localStorage: typeof localStorage === "object" && localStorage !== null,
    panes: typeof herdr.panes === "function",
    focused: typeof herdr.focused === "function",
    layout: typeof herdr.layout === "function",
    appHome: typeof herdr.appHome === "function",
    writeTextFile: typeof herdr.writeTextFile === "function",
    setShared: typeof herdr.setShared === "function",
    notify: typeof herdr.notify === "function",
    nextCommand: typeof herdr.nextCommand === "function",
    run: typeof herdr.run === "function",
    closeOverlay: typeof herdr.closeOverlay === "function",
    terminals: typeof herdr.terminals === "function",
    spaces: typeof herdr.spaces === "function"
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
var WINDOW_KEY = "gascity.window";
var PROBE_KEY = "gascity.probe";
function readVisibility() {
  const panes2 = decodePanes(herdr.panes());
  if (!panes2.ok) return panes2;
  const focus = decodeFocused(herdr.focused());
  if (!focus.ok) return focus;
  const first = panes2.value.errors[0];
  if (first) return err(first);
  return ok({ windowOpen: readWindowOpen(), layoutMods: layoutModNames(herdr.layout()), panes: panes2.value.items, focus: focus.value });
}
function readProbeEnabled() {
  return herdr.shared(PROBE_KEY) === true;
}
function setProbeEnabled(on) {
  herdr.setShared(PROBE_KEY, on);
}
function readWindowOpen() {
  return windowOpenAt(herdr.shared(WINDOW_KEY), Date.now());
}
function setWindowOpen(open) {
  herdr.setShared(WINDOW_KEY, open ? windowFlag(Date.now()) : false);
}
function readFocusTarget() {
  return herdr.shared(FOCUS_KEY);
}
function postToast(title, body) {
  if (readWindowOpen()) {
    herdr.notify({ title, body, level: "warning" });
    logRecord("notify", []);
  } else {
    herdr.notify({ title, body, level: "warning", action: { name: "mod.open", args: { name: "gascity" } } });
    logRecord("notify", ["mod.open", MOD_NAME]);
  }
}
function postNeedsYou(batch) {
  const failed = [];
  const errors = [];
  for (const n of batch.toasts) {
    try {
      herdr.setShared(FOCUS_KEY, nextFocus(herdr.shared(FOCUS_KEY), n.city, n.session, Date.now()));
      const { title, body } = toastText(n);
      postToast(title, body);
    } catch (cause) {
      failed.push(n);
      errors.push(`toast for session ${n.session} not posted: ${messageOf2(cause)}`);
    }
  }
  if (batch.more > 0) {
    try {
      const { title, body } = summaryText(batch.city, batch.more);
      postToast(title, body);
    } catch (cause) {
      errors.push(`summary toast for ${batch.more} sessions not posted: ${messageOf2(cause)}`);
    }
  }
  for (const e of errors) logError(`gascity: ${e}`);
  return { failed, errors };
}
function selectTab(id2) {
  logRecord("run", ["tab.select", id2]);
  try {
    herdr.run("tab.select", { id: id2 });
    return ok(null);
  } catch (cause) {
    return err({ kind: "host-call", api: "run(tab.select)", cause: messageOf2(cause) });
  }
}
function readTerminalScene() {
  let raw;
  try {
    raw = { spaces: herdr.spaces(), panes: herdr.panes(), terminals: herdr.terminals() };
  } catch (cause) {
    return err({ kind: "host-call", api: "spaces()/panes()/terminals()", cause: messageOf2(cause) });
  }
  return decodeScene(raw);
}
var TAB_NAME_LIMIT = 60;
function openAttachTab(tab) {
  const issue2 = attachArgvIssue(tab.argv) ?? (tab.space === "" ? "no space given" : null);
  if (issue2 !== null) return err({ kind: "host-call", api: "run(tab.new)", cause: `refused: ${issue2}` });
  const name = cleanLine(tab.name).slice(0, TAB_NAME_LIMIT);
  const argv = [...tab.argv];
  logRecord("run", ["tab.new", ...argv]);
  try {
    herdr.run("tab.new", { space: tab.space, name, argv });
    return ok(null);
  } catch (cause) {
    return err({ kind: "host-call", api: "run(tab.new)", cause: messageOf2(cause) });
  }
}
function closeWindow(overlay) {
  herdr.closeOverlay(overlay);
}
function nextCommand2() {
  return herdr.nextCommand();
}
function readHerdrVersion() {
  if (typeof herdr.updates !== "function") return ok(null);
  try {
    const v = herdr.updates()?.app?.version;
    return ok(typeof v === "string" ? v : null);
  } catch (cause) {
    return err({ kind: "host-call", api: "updates()", cause: messageOf2(cause) });
  }
}
var probeIo = {
  path: () => `${probeDir(herdr.appHome())}/probe.json`,
  read: async (path) => {
    try {
      return ok(await herdr.readTextFile(path));
    } catch (cause) {
      return err({ kind: "host-call", api: `readTextFile(${path})`, cause: messageOf2(cause) });
    }
  },
  write: async (path, text2, expected) => {
    const refused = probePathIssue(path, herdr.appHome());
    if (refused !== null) return err({ kind: "host-call", api: `writeTextFile(${path})`, cause: refused });
    try {
      await herdr.writeTextFile(path, text2, expected);
      return ok(null);
    } catch (cause) {
      return err({ kind: "host-call", api: `writeTextFile(${path})`, cause: messageOf2(cause) });
    }
  }
};
var EXEC_LOG_LIMIT = 50;
var execLog = [];
function readExecLog() {
  return execLog;
}
function logRecord(kind, argv) {
  execLog = [...execLog, { at: Date.now(), kind, argv }].slice(-EXEC_LOG_LIMIT);
}
var GC_STATUS_TIMEOUT_MS = 1e4;
var STDERR_LIMIT = 2e3;
async function execGcStatus(gcBin) {
  const argv = [gcBin, ...GC_STATUS_ARGS];
  const refused = gcBinIssue(gcBin);
  if (refused) return err({ kind: "exec", argv, code: null, stderr: `not run: gcBin ${refused}` });
  logRecord("exec", argv);
  return herdr.exec(gcBin, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS }).then(
    (result) => result.code === 0 ? ok(result.stdout) : err({ kind: "exec", argv, code: result.code, stderr: result.stderr.trim().slice(0, STDERR_LIMIT) }),
    (cause) => err({ kind: "exec", argv, code: null, stderr: messageOf2(cause) })
  );
}
function logError(line) {
  const c = globalThis.console;
  if (c !== void 0 && typeof c.error === "function") c.error(cleanLine(line));
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

// src/commandBook.ts
var DUPLICATE_WINDOW_MS = 2e3;
var NONCE_WINDOW_MS = 10 * 6e4;
var COMMAND_LOG_LIMIT = 20;
var CommandBook = class {
  claims = /* @__PURE__ */ new Map();
  log = [];
  /** Claims delivery `text` at `now`; false when a copy already claimed it within its window. */
  claim(text2, nonce, now) {
    for (const [k, until] of this.claims) if (until <= now) this.claims.delete(k);
    if (this.claims.has(text2)) return false;
    this.claims.set(text2, now + (nonce ? NONCE_WINDOW_MS : DUPLICATE_WINDOW_MS));
    return true;
  }
  /** Gives up a claim: the copy that claimed `text` refused it. */
  release(text2) {
    this.claims.delete(text2);
  }
  record(entry) {
    this.log = [...this.log, entry].slice(-COMMAND_LOG_LIMIT);
  }
  /** The log, oldest first. */
  entries() {
    return this.log;
  }
};
var shared2 = null;
function sharedCommandBook() {
  shared2 ??= new CommandBook();
  return shared2;
}

// src/gc/ops.ts
var INFRASTRUCTURE_BEAD_TYPES = ["session", "message", "molecule", "gate"];
function getHealth(c) {
  return c.call("get-health", { path: {} });
}
function listCities(c) {
  return c.call("get-v0-cities", { path: {} });
}
function listRigs(c, city) {
  return c.call("get-v0-city-by-city-name-rigs", { path: { cityName: city } });
}
function listAgents(c, city) {
  return c.call("get-v0-city-by-city-name-agents", { path: { cityName: city } });
}
function listSessions(c, city, query) {
  return c.call("get-v0-city-by-city-name-sessions", { path: { cityName: city }, query });
}
function getSession(c, city, id2, query = {}) {
  return c.call("get-v0-city-by-city-name-session-by-id", { path: { cityName: city, id: id2 }, query });
}
function listPending(c, city) {
  return c.call("get-v0-city-by-city-name-pending", { path: { cityName: city } });
}
function getSessionPending(c, city, id2) {
  return c.call("get-v0-city-by-city-name-session-by-id-pending", { path: { cityName: city, id: id2 } });
}
function listWork(c, city, query) {
  return c.call("get-v0-city-by-city-name-work-ready", { path: { cityName: city }, query });
}
function getBead(c, city, id2) {
  return c.call("get-v0-city-by-city-name-bead-by-id", { path: { cityName: city, id: id2 } });
}
function pollEvents(c, city, query) {
  return c.call("get-v0-city-by-city-name-events", { path: { cityName: city }, query: { limit: query.limit } });
}
function getRequestOutcome(c, city, requestId, afterSeq) {
  return c.call("get-request-outcome", { path: { cityName: city, requestId }, query: { after_seq: afterSeq } });
}
function createSession(c, city, body, idempotencyKey) {
  return c.call("create-session", { path: { cityName: city }, body, idempotencyKey });
}
function submitSession(c, city, id2, body, idempotencyKey) {
  return c.call("submit-session", { path: { cityName: city, id: id2 }, body, idempotencyKey });
}
function sendSessionMessage(c, city, id2, body, idempotencyKey) {
  return c.call("send-session-message", { path: { cityName: city, id: id2 }, body, idempotencyKey });
}
function respondSession(c, city, id2, body, idempotencyKey) {
  return c.call("respond-session", { path: { cityName: city, id: id2 }, body, idempotencyKey });
}
function wakeSession(c, city, id2, idempotencyKey) {
  return c.call("post-v0-city-by-city-name-session-by-id-wake", { path: { cityName: city, id: id2 }, idempotencyKey });
}
function suspendSession(c, city, id2, idempotencyKey) {
  return c.call("post-v0-city-by-city-name-session-by-id-suspend", { path: { cityName: city, id: id2 }, idempotencyKey });
}
function stopSession(c, city, id2, idempotencyKey, body) {
  return c.call("post-v0-city-by-city-name-session-by-id-stop", { path: { cityName: city, id: id2 }, body, idempotencyKey });
}
function closeSession(c, city, id2, idempotencyKey, query = {}) {
  return c.call("post-v0-city-by-city-name-session-by-id-close", { path: { cityName: city, id: id2 }, query, idempotencyKey });
}
function killSession(c, city, id2, idempotencyKey, query = {}) {
  return c.call("post-v0-city-by-city-name-session-by-id-kill", { path: { cityName: city, id: id2 }, query, idempotencyKey });
}
function pinSession(c, city, id2) {
  return c.call("post-v0-city-by-city-name-session-by-id-pin", { path: { cityName: city, id: id2 } });
}
function unpinSession(c, city, id2) {
  return c.call("post-v0-city-by-city-name-session-by-id-unpin", { path: { cityName: city, id: id2 } });
}
function agentAction(c, city, agent, action) {
  const slash = agent.lastIndexOf("/");
  if (slash < 0) {
    return c.call("post-v0-city-by-city-name-agent-by-base-by-action", { path: { cityName: city, base: agent, action } });
  }
  return c.call("post-v0-city-by-city-name-agent-by-dir-by-base-by-action", {
    path: { cityName: city, dir: agent.slice(0, slash), base: agent.slice(slash + 1), action }
  });
}
function rigAction(c, city, rig, action) {
  return c.call("post-v0-city-by-city-name-rig-by-name-by-action", { path: { cityName: city, name: rig, action } });
}
function sling(c, city, body) {
  return c.call("post-v0-city-by-city-name-sling", { path: { cityName: city }, body });
}
function createBead(c, city, body, idempotencyKey) {
  return c.call("create-bead", { path: { cityName: city }, body, idempotencyKey });
}
function closeBead(c, city, id2, body) {
  return c.call("post-v0-city-by-city-name-bead-by-id-close", { path: { cityName: city, id: id2 }, body });
}
function reopenBead(c, city, id2) {
  return c.call("post-v0-city-by-city-name-bead-by-id-reopen", { path: { cityName: city, id: id2 } });
}

// src/actions/answers.ts
function statusDetail(body) {
  return `gc: ${body.status}${body.replayed ? " (replayed: gc had already done it)" : ""}`;
}
function sessionDetail(s) {
  return `gc: session ${s.id} ${s.state}${s.running ? ", running" : ""}`;
}
function rigDetail(body) {
  const parts = [`gc: ${body.status}`];
  if (body.killed.length > 0) parts.push(`stopped ${body.killed.join(", ")}`);
  if (body.failed.length > 0) parts.push(`failed ${body.failed.join(", ")}`);
  return parts.join("; ");
}
function accepted(body) {
  return { kind: "accepted", requestId: body.request_id, afterSeq: body.event_cursor };
}

// src/actions/agent.ts
function operationFor(name) {
  return name.includes("/") ? "post-v0-city-by-city-name-agent-by-dir-by-base-by-action" : "post-v0-city-by-city-name-agent-by-base-by-action";
}
function agentAction2(name, action) {
  const operationId = operationFor(name);
  return {
    kind: action === "suspend" ? "agent.suspend" : "agent.resume",
    verb: action === "suspend" ? "Suspend agent" : "Resume agent",
    target: { kind: "agent", name },
    operationId,
    idempotent: OPERATIONS[operationId].idempotencyKey,
    confirm: action === "suspend" ? { question: `Suspend agent ${name}?`, detail: "gc suspends the agent and does not run its sessions until it is resumed." } : null,
    refresh: ["agents", "sessions"],
    send: async (c, city) => {
      const r = await agentAction(c, city, name, action);
      return r.ok ? ok({ kind: "done", detail: statusDetail(r.value) }) : r;
    }
  };
}
function agentSuspend(name) {
  return agentAction2(name, "suspend");
}
function agentResume(name) {
  return agentAction2(name, "resume");
}

// src/actions/rig.ts
var OP = "post-v0-city-by-city-name-rig-by-name-by-action";
function rigAction2(name, action) {
  return {
    kind: action === "suspend" ? "rig.suspend" : "rig.resume",
    verb: action === "suspend" ? "Suspend rig" : "Resume rig",
    target: { kind: "rig", name },
    operationId: OP,
    idempotent: OPERATIONS[OP].idempotencyKey,
    confirm: action === "suspend" ? { question: `Suspend rig ${name}?`, detail: "gc suspends the rig and may stop its running sessions; they do not run again until the rig is resumed." } : null,
    refresh: ["rigs", "agents", "sessions"],
    send: async (c, city) => {
      const r = await rigAction(c, city, name, action);
      return r.ok ? ok({ kind: "done", detail: rigDetail(r.value) }) : r;
    }
  };
}
function rigSuspend(name) {
  return rigAction2(name, "suspend");
}
function rigResume(name) {
  return rigAction2(name, "resume");
}

// src/actions/session.ts
var LIFECYCLE = ["sessions", "agents"];
var INPUT = ["sessions"];
var ANSWER = ["pending", "sessions"];
function spec(kind, verb, id2, operationId, refresh, confirm, send) {
  return { kind, verb, target: { kind: "session", id: id2 }, operationId, idempotent: OPERATIONS[operationId].idempotencyKey, confirm, refresh, send };
}
async function then(answer, read) {
  const r = await answer;
  return r.ok ? ok(read(r.value)) : r;
}
function sessionNew(agent, alias) {
  const body = { kind: "agent", name: agent };
  if (alias !== null && alias !== "") body.alias = alias;
  return {
    kind: "session.new",
    verb: "New session",
    target: { kind: "agent", name: agent },
    operationId: "create-session",
    idempotent: OPERATIONS["create-session"].idempotencyKey,
    confirm: null,
    refresh: LIFECYCLE,
    send: (c, city, key) => then(createSession(c, city, body, key), accepted)
  };
}
function sessionWake(id2) {
  return spec(
    "session.wake",
    "Wake",
    id2,
    "post-v0-city-by-city-name-session-by-id-wake",
    LIFECYCLE,
    null,
    (c, city, key) => then(wakeSession(c, city, id2, key), (b) => ({ kind: "done", detail: statusDetail(b) }))
  );
}
function sessionSuspend(id2) {
  return spec(
    "session.suspend",
    "Suspend",
    id2,
    "post-v0-city-by-city-name-session-by-id-suspend",
    LIFECYCLE,
    null,
    (c, city, key) => then(suspendSession(c, city, id2, key), (b) => ({ kind: "done", detail: statusDetail(b) }))
  );
}
function sessionStop(id2) {
  return spec(
    "session.stop",
    "Stop turn",
    id2,
    "post-v0-city-by-city-name-session-by-id-stop",
    LIFECYCLE,
    null,
    (c, city, key) => then(stopSession(c, city, id2, key), (b) => ({ kind: "done", detail: statusDetail(b) }))
  );
}
function sessionClose(id2) {
  return spec("session.close", "Close", id2, "post-v0-city-by-city-name-session-by-id-close", LIFECYCLE, {
    question: `Close session ${id2}?`,
    detail: "gc ends the session permanently: it stops its runtime and closes its session bead. A closed session cannot be woken again."
  }, (c, city, key) => then(closeSession(c, city, id2, key), (b) => ({ kind: "done", detail: statusDetail(b) })));
}
function sessionKill(id2, force) {
  const confirm = force ? {
    question: `Force kill session ${id2}?`,
    detail: "gc kills its runtime now, even with live background subagents or a hung runtime lease. Its work is kept and the session is left asleep."
  } : {
    question: `Kill session ${id2}?`,
    detail: "gc kills its runtime now, without waiting for the current turn. Its work is kept and the session is left asleep."
  };
  return spec(
    force ? "session.kill-force" : "session.kill",
    force ? "Force kill" : "Kill",
    id2,
    "post-v0-city-by-city-name-session-by-id-kill",
    LIFECYCLE,
    confirm,
    (c, city, key) => {
      const answer = force ? killSession(c, city, id2, key, { force: true }) : killSession(c, city, id2, key);
      return then(answer, (b) => ({ kind: "done", detail: statusDetail(b) }));
    }
  );
}
function sessionPin(id2) {
  return spec(
    "session.pin",
    "Pin",
    id2,
    "post-v0-city-by-city-name-session-by-id-pin",
    LIFECYCLE,
    null,
    (c, city) => then(pinSession(c, city, id2), (s) => ({ kind: "done", detail: sessionDetail(s) }))
  );
}
function sessionUnpin(id2) {
  return spec(
    "session.unpin",
    "Unpin",
    id2,
    "post-v0-city-by-city-name-session-by-id-unpin",
    LIFECYCLE,
    null,
    (c, city) => then(unpinSession(c, city, id2), (s) => ({ kind: "done", detail: sessionDetail(s) }))
  );
}
function sessionSubmit(id2, message, intent) {
  const interrupt = intent === "interrupt_now";
  return spec(
    interrupt ? "session.interrupt" : "session.submit",
    interrupt ? "Interrupt and send" : "Send",
    id2,
    "submit-session",
    INPUT,
    null,
    (c, city, key) => then(submitSession(c, city, id2, { message, intent }, key), accepted)
  );
}
function sessionMessage(id2, message) {
  return spec(
    "session.message",
    "Send as message",
    id2,
    "send-session-message",
    INPUT,
    null,
    (c, city, key) => then(sendSessionMessage(c, city, id2, { message }, key), accepted)
  );
}
function sessionRespond(id2, requestId, option) {
  return spec(
    "session.respond",
    option,
    id2,
    "respond-session",
    ANSWER,
    null,
    (c, city, key) => then(
      respondSession(c, city, id2, { action: option, request_id: requestId }, key),
      (b) => ({ kind: "done", detail: statusDetail(b) })
    )
  );
}

// src/commands.ts
var id = (name) => ({ name, kind: "id" });
var text = (name) => ({ name, kind: "text" });
var CITY = id("city");
var CONFIRM = "confirm";
var NONCE = /^nonce=([A-Za-z0-9._-]{1,64})$/;
var MAX_COMMAND_LENGTH = 8192;
var at2 = (a, i) => a[i] ?? "";
var GRAMMAR = {
  focus: {
    mutating: false,
    args: [],
    optional: [id("city"), id("session")],
    summary: "bare: take the keyboard; with a city and a session: select the city and open the session's detail",
    build: (a) => a.length === 0 ? { verb: "focus" } : { verb: "focus-session", city: at2(a, 0), session: at2(a, 1) }
  },
  city: {
    mutating: false,
    args: [id("city")],
    summary: "select a city (as the header's city list does; refused by a pinned copy)",
    build: (a) => ({ verb: "city", city: at2(a, 0) })
  },
  session: { mutating: false, args: [id("session")], summary: "open a session's detail (as clicking its row does)", build: (a) => ({ verb: "session", session: at2(a, 0) }) },
  bead: { mutating: false, args: [id("bead")], summary: "open a bead's detail (as clicking its card does)", build: (a) => ({ verb: "bead", bead: at2(a, 0) }) },
  refresh: { mutating: false, args: [], summary: "refetch everything now (Retry now; the r key)", build: () => ({ verb: "refresh" }) },
  probe: {
    mutating: false,
    args: [id("on-or-off")],
    summary: "turn the probe file on or off (shared for every copy)",
    build: (a) => ({ verb: "probe", on: at2(a, 0) === "on" })
  },
  cancel: { mutating: false, args: [], summary: "close the open question or form without acting (Cancel)", build: () => ({ verb: "cancel" }) },
  "session-new": {
    mutating: true,
    args: [id("agent")],
    optional: [text("alias")],
    summary: "start a session of an agent, with an optional alias (New session…, then Start session)",
    build: (a) => ({ verb: "session-new", city: at2(a, 0), agent: at2(a, 1), alias: a.length > 2 && at2(a, 2) !== "" ? at2(a, 2) : null })
  },
  wake: { mutating: true, args: [id("session")], summary: "wake a session (Wake)", build: (a) => ({ verb: "wake", city: at2(a, 0), session: at2(a, 1) }) },
  suspend: { mutating: true, args: [id("session")], summary: "suspend a session (Suspend)", build: (a) => ({ verb: "suspend", city: at2(a, 0), session: at2(a, 1) }) },
  stop: { mutating: true, args: [id("session")], summary: "stop a session's current turn (Stop turn)", build: (a) => ({ verb: "stop", city: at2(a, 0), session: at2(a, 1) }) },
  pin: { mutating: true, args: [id("session")], summary: "pin a session awake (Pin)", build: (a) => ({ verb: "pin", city: at2(a, 0), session: at2(a, 1) }) },
  unpin: { mutating: true, args: [id("session")], summary: "clear a session's pin (Unpin)", build: (a) => ({ verb: "unpin", city: at2(a, 0), session: at2(a, 1) }) },
  close: {
    mutating: true,
    args: [id("session")],
    confirm: true,
    summary: "close a session (Close…, then Close)",
    build: (a, confirm) => ({ verb: "close", city: at2(a, 0), session: at2(a, 1), confirm })
  },
  kill: {
    mutating: true,
    args: [id("session")],
    confirm: true,
    summary: "kill a session's runtime (Kill…, then Kill)",
    build: (a, confirm) => ({ verb: "kill", city: at2(a, 0), session: at2(a, 1), confirm })
  },
  "kill-force": {
    mutating: true,
    args: [id("session")],
    confirm: true,
    summary: "force-kill a session's runtime (Kill…, then Force kill)",
    build: (a, confirm) => ({ verb: "kill-force", city: at2(a, 0), session: at2(a, 1), confirm })
  },
  submit: {
    mutating: true,
    args: [id("session"), text("text")],
    summary: "send input to a session (Send)",
    build: (a) => ({ verb: "submit", city: at2(a, 0), session: at2(a, 1), text: at2(a, 2) })
  },
  interrupt: {
    mutating: true,
    args: [id("session"), text("text")],
    summary: "interrupt the turn and send input (Interrupt and send)",
    build: (a) => ({ verb: "interrupt", city: at2(a, 0), session: at2(a, 1), text: at2(a, 2) })
  },
  message: {
    mutating: true,
    args: [id("session"), text("text")],
    summary: "send a queued message to a session (Send as message)",
    build: (a) => ({ verb: "message", city: at2(a, 0), session: at2(a, 1), text: at2(a, 2) })
  },
  answer: {
    mutating: true,
    args: [id("session"), id("request"), id("option")],
    summary: "answer a session's pending prompt with one of gc's options (its answer button); the session's detail must show that prompt",
    build: (a) => ({ verb: "answer", city: at2(a, 0), session: at2(a, 1), requestId: at2(a, 2), option: at2(a, 3) })
  },
  attach: {
    mutating: true,
    args: [id("session")],
    summary: "open a session's terminal in a herdr tab, waking it through gc first (Open terminal; the t key)",
    build: (a) => ({ verb: "attach", city: at2(a, 0), session: at2(a, 1) })
  },
  "agent-suspend": {
    mutating: true,
    args: [id("agent")],
    confirm: true,
    summary: "suspend an agent (Suspend agent…, then Suspend agent)",
    build: (a, confirm) => ({ verb: "agent-suspend", city: at2(a, 0), name: at2(a, 1), confirm })
  },
  "agent-resume": {
    mutating: true,
    args: [id("agent")],
    summary: "resume an agent (Resume agent)",
    build: (a) => ({ verb: "agent-resume", city: at2(a, 0), name: at2(a, 1) })
  },
  "rig-suspend": {
    mutating: true,
    args: [id("rig")],
    confirm: true,
    summary: "suspend a rig (Suspend rig…, then Suspend rig)",
    build: (a, confirm) => ({ verb: "rig-suspend", city: at2(a, 0), name: at2(a, 1), confirm })
  },
  "rig-resume": {
    mutating: true,
    args: [id("rig")],
    summary: "resume a rig (Resume rig)",
    build: (a) => ({ verb: "rig-resume", city: at2(a, 0), name: at2(a, 1) })
  },
  "bead-new": {
    mutating: true,
    args: [text("title")],
    optional: [id("agent")],
    confirm: true,
    summary: "create a bead (+ New bead, then Create); with an agent it is also slung there, which needs confirm (else the form opens filled in)",
    build: (a, confirm) => ({ verb: "bead-new", city: at2(a, 0), title: at2(a, 1), slingTo: a.length > 2 ? at2(a, 2) : null, confirm })
  },
  sling: {
    mutating: true,
    args: [id("bead"), id("agent")],
    confirm: true,
    summary: "sling a bead to an agent (Sling…, then the agent)",
    build: (a, confirm) => ({ verb: "sling", city: at2(a, 0), bead: at2(a, 1), agent: at2(a, 2), confirm })
  },
  "bead-close": {
    mutating: true,
    args: [id("bead"), text("reason")],
    confirm: true,
    summary: "close a bead with a reason, which may be empty (Close…, then Close bead)",
    build: (a, confirm) => ({ verb: "bead-close", city: at2(a, 0), bead: at2(a, 1), reason: at2(a, 2), confirm })
  },
  "bead-reopen": {
    mutating: true,
    args: [id("bead")],
    summary: "reopen a closed bead (Reopen)",
    build: (a) => ({ verb: "bead-reopen", city: at2(a, 0), bead: at2(a, 1) })
  }
};
function isMutating(c) {
  const spec2 = GRAMMAR[c.verb];
  return spec2?.mutating === true;
}
function shownCommand(raw) {
  const line = cleanLine(raw);
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
function decode2(part, index) {
  try {
    return ok(decodeURIComponent(part));
  } catch {
    return err(`argument ${index} has a bad percent escape`);
  }
}
function counts(verb, spec2) {
  const lead = spec2.mutating ? 1 : 0;
  if (verb === "focus") return [0, 2];
  const required2 = lead + spec2.args.length;
  return Array.from({ length: (spec2.optional?.length ?? 0) + 1 }, (_, k) => required2 + k);
}
function parseCommand(raw) {
  if (raw.length > MAX_COMMAND_LENGTH) return err(`longer than ${MAX_COMMAND_LENGTH} characters`);
  const [verb = "", ...rest] = raw.split(":");
  const spec2 = Object.hasOwn(GRAMMAR, verb) ? GRAMMAR[verb] : void 0;
  if (!spec2) return err(`unknown command "${shownCommand(verb)}"`);
  let parts = rest;
  let nonce = null;
  const last = NONCE.exec(parts.at(-1) ?? "");
  if (last) {
    nonce = last[1] ?? null;
    parts = parts.slice(0, -1);
  }
  const args = [];
  for (const [i, part] of parts.entries()) {
    const d = decode2(part, i + 1);
    if (!d.ok) return d;
    args.push(d.value);
  }
  const allowed = counts(verb, spec2);
  const most = Math.max(...allowed);
  let confirm = false;
  if (spec2.confirm && args.length === most + 1) {
    if (args[most] !== CONFIRM) return err(`${verb}: the argument after ${placeholders(verb)} can only be "${CONFIRM}"`);
    confirm = true;
    args.pop();
  }
  if (!allowed.includes(args.length)) return err(`${verb}: expected ${usage(verb)}`);
  const kinds = [...spec2.mutating ? [CITY] : [], ...spec2.args, ...spec2.optional ?? []];
  for (const [i, value] of args.entries()) {
    const arg = kinds[i];
    if (arg?.kind === "id" && value.trim() === "") return err(`${verb}: <${arg.name}> is empty`);
  }
  if (verb === "probe" && args[0] !== "on" && args[0] !== "off") return err(`probe: expected "on" or "off", got "${shownCommand(args[0] ?? "")}"`);
  return ok({ command: spec2.build(args, confirm), nonce });
}
function placeholders(verb) {
  const spec2 = GRAMMAR[verb];
  if (!spec2) return "";
  return [...spec2.mutating ? [CITY] : [], ...spec2.args, ...spec2.optional ?? []].map((a) => `<${a.name}>`).join(":");
}
function usage(verb) {
  const spec2 = GRAMMAR[verb];
  if (!spec2) return verb;
  const req = [...spec2.mutating ? [CITY] : [], ...spec2.args].map((a) => `:<${a.name}>`).join("");
  if (verb === "focus") return "focus[:<city>:<session>]";
  if (verb === "bead-new") return `bead-new${req}[:<agent>[:${CONFIRM}]]`;
  const opt = (spec2.optional ?? []).map((a) => `[:<${a.name}>]`).join("");
  return `${verb}${req}${opt}${spec2.confirm ? `[:${CONFIRM}]` : ""}`;
}

// src/keys.ts
var KEY_MAP = {
  j: "next-session",
  down: "next-session",
  k: "prev-session",
  up: "prev-session",
  r: "refresh",
  t: "open-terminal",
  escape: "back"
};
function keyAction(keystroke) {
  return Object.hasOwn(KEY_MAP, keystroke) ? KEY_MAP[keystroke] ?? null : null;
}
function moveIn(order, current, delta) {
  if (order.length === 0) return null;
  const at3 = current === null ? -1 : order.indexOf(current);
  if (at3 < 0) return delta === 1 ? order[0] ?? null : order[order.length - 1] ?? null;
  return order[(at3 + delta + order.length) % order.length] ?? null;
}

// src/actions/work.ts
var SLING_MAY_ROUTE_TWICE = "gc cannot deduplicate a sling: if its outcome is unknown, a retry may route the bead twice. Check the board first.";
var CREATED = ["ready"];
var SLUNG = ["ready", "inProgress", "sessions"];
var MOVED = ["ready", "inProgress"];
function beadCreate(bead, slingTo) {
  const body = { title: bead.title };
  if (bead.description.trim() !== "") body.description = bead.description;
  if (bead.priority !== null) body.priority = bead.priority;
  if (bead.labels.length > 0) body.labels = [...bead.labels];
  const spec2 = {
    kind: "bead.create",
    verb: "New bead",
    target: { kind: "new-bead", title: bead.title },
    operationId: "create-bead",
    idempotent: OPERATIONS["create-bead"].idempotencyKey,
    confirm: null,
    refresh: CREATED,
    send: async (c, city, key) => {
      const r = await createBead(c, city, body, key);
      return r.ok ? ok({ kind: "done", detail: `gc: created bead ${r.value.id}`, created: r.value.id }) : r;
    }
  };
  if (slingTo === null) return spec2;
  return { ...spec2, then: { verb: slingVerb(slingTo), spec: (created) => beadSling(created, slingTo) } };
}
function slingVerb(agent) {
  return `Sling to ${agent}`;
}
function slingDetail(r, bead) {
  const status2 = isUnrecognized(r.status) ? r.status.raw : r.status;
  const parts = [`gc: ${status2} bead ${r.bead ?? bead} to ${r.target}`];
  if (r.workflow_id !== void 0) parts.push(`workflow ${r.workflow_id}`);
  if (r.convoy_id !== void 0) parts.push(`convoy ${r.convoy_id}`);
  if (r.warnings.length > 0) parts.push(`warnings: ${r.warnings.join("; ")}`);
  return parts.join("; ");
}
function beadSling(id2, agent) {
  return {
    kind: "bead.sling",
    verb: slingVerb(agent),
    target: { kind: "bead", id: id2 },
    operationId: "post-v0-city-by-city-name-sling",
    idempotent: OPERATIONS["post-v0-city-by-city-name-sling"].idempotencyKey,
    confirm: {
      question: `Sling bead ${id2} to ${agent}?`,
      detail: `gc routes the bead to ${agent} (and applies the agent's default formula, if it has one). ${SLING_MAY_ROUTE_TWICE}`
    },
    refresh: SLUNG,
    send: async (c, city) => {
      const r = await sling(c, city, { target: agent, bead: id2 });
      return r.ok ? ok({ kind: "done", detail: slingDetail(r.value, id2) }) : r;
    }
  };
}
function beadClose(id2, reason) {
  const why = reason.trim();
  return {
    kind: "bead.close",
    verb: "Close",
    target: { kind: "bead", id: id2 },
    operationId: "post-v0-city-by-city-name-bead-by-id-close",
    idempotent: OPERATIONS["post-v0-city-by-city-name-bead-by-id-close"].idempotencyKey,
    confirm: {
      question: `Close bead ${id2}?`,
      detail: why === "" ? "gc closes the bead, with no reason. Reopen brings it back." : `gc closes the bead with the reason "${why}". Reopen brings it back.`
    },
    refresh: MOVED,
    send: async (c, city) => {
      const r = why === "" ? await closeBead(c, city, id2) : await closeBead(c, city, id2, { reason: why });
      return r.ok ? ok({ kind: "done", detail: statusDetail(r.value) }) : r;
    }
  };
}
function beadReopen(id2) {
  return {
    kind: "bead.reopen",
    verb: "Reopen",
    target: { kind: "bead", id: id2 },
    operationId: "post-v0-city-by-city-name-bead-by-id-reopen",
    idempotent: OPERATIONS["post-v0-city-by-city-name-bead-by-id-reopen"].idempotencyKey,
    confirm: null,
    refresh: MOVED,
    send: async (c, city) => {
      const r = await reopenBead(c, city, id2);
      return r.ok ? ok({ kind: "done", detail: statusDetail(r.value) }) : r;
    }
  };
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

// src/sync/invalidate.ts
var ALL_DOMAINS = ["rigs", "agents", "sessions", "pending", "ready", "inProgress"];
var SESSION_REFRESH = /* @__PURE__ */ new Set(["request.failed", "worker.operation"]);
var BOARD_CHANGES = /* @__PURE__ */ new Set(["bead.created", "bead.updated", "bead.closed", "bead.deleted", "bead.dead_assignee_reopened"]);
var PENDING = /* @__PURE__ */ new Set(["session.pending", "session.pending_cleared"]);
function invalidationFor(events, known) {
  const inv = { domains: /* @__PURE__ */ new Set(), cities: false };
  for (const e of events) {
    const t = e.type;
    const subject = e.subject;
    if (PENDING.has(t)) {
      inv.domains.add("pending");
    } else if (t.startsWith("session.") || t.startsWith("request.result.session.") || SESSION_REFRESH.has(t)) {
      inv.domains.add("sessions");
      inv.domains.add("agents");
    } else if (t.startsWith("bead.")) {
      if (subject !== void 0 && known.sessionIds.has(subject)) inv.domains.add("sessions");
      if (BOARD_CHANGES.has(t)) {
        inv.domains.add("ready");
        inv.domains.add("inProgress");
      }
    } else if (t.startsWith("city.")) {
      inv.cities = true;
      inv.domains.add("rigs");
      inv.domains.add("agents");
    }
  }
  return inv;
}

// src/actions/activity.ts
function isPending(state) {
  return state.kind === "sending" || state.kind === "polling" || state.kind === "watching";
}
function targetKey(t) {
  switch (t.kind) {
    case "session":
    case "bead":
      return `${t.kind}:${t.id}`;
    case "new-bead":
      return `new-bead:${t.title}`;
    default:
      return `${t.kind}:${t.name}`;
  }
}
function targetText(t) {
  switch (t.kind) {
    case "session":
    case "bead":
      return `${t.kind} ${t.id}`;
    case "new-bead":
      return `new bead "${t.title}"`;
    default:
      return `${t.kind} ${t.name}`;
  }
}

// src/vm/errorText.ts
var LOOPBACK_ONLY = "only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed";
function seconds(ms) {
  return `${Math.round(ms / 1e3)} s`;
}
function drift(value) {
  return isUnrecognized(value) ? value.raw : String(value);
}
function errorText(e) {
  return cleanLine(rawText2(e));
}
function rawText2(e) {
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
      return `gc too old (needs ${e.operationId})${e.raw === void 0 ? "" : `: ${e.raw}`}`;
    case "decode":
      return `unreadable answer to ${e.operationId}${e.path === "" ? "" : ` at ${e.path}`}: ${e.issues.join("; ")}`;
    case "outcome-failed":
      return `request ${e.requestId} (${drift(e.operation)}) failed: ${e.payload.error_code}: ${e.payload.error_message}`;
    case "outcome-unknown": {
      const why = e.requestId === null ? e.cause : `${e.cause}, request ${e.requestId}`;
      const issues = e.issues && e.issues.length > 0 ? `: ${e.issues.join("; ")}` : "";
      return `outcome of ${e.operationId} unknown (${why})${issues}`;
    }
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
    case "cancelled":
      return e.reason === "copy-closed" ? `request to ${e.url} was cancelled: the Gas City view that started it closed` : `request to ${e.url} was dropped before it was sent: nothing waits for its answer any more`;
  }
}

// src/sync/backoff.ts
var BACKOFF_BASE_MS = 1e3;
var BACKOFF_CAP_MS = 6e4;
function backoffCeiling(attempt) {
  const exp = Math.min(Math.max(attempt, 1) - 1, 16);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exp);
}
function backoffDelay(attempt, random) {
  const ceiling = backoffCeiling(attempt);
  return BACKOFF_BASE_MS + Math.floor(random() * (ceiling - BACKOFF_BASE_MS));
}
function failBackoff(state, now, cause, random) {
  const attempt = (state?.attempt ?? 0) + 1;
  return { attempt, retryAt: now + backoffDelay(attempt, random), cause };
}
function retryBackoffNow(state, now) {
  return { ...state, retryAt: now };
}
function backsOff(error) {
  switch (error.kind) {
    case "unreachable":
    case "timeout":
    case "not-loopback":
      return true;
    case "http":
      return error.status >= 500;
    default:
      return false;
  }
}

// src/sync/budget.ts
var PRIORITIES = ["mutation", "events", "snapshot", "peek", "sweep"];
var MAX_IN_FLIGHT = 2;
var DEGRADED_IN_FLIGHT = 1;
var RECLAIM_AFTER_MS = HERDR_FETCH_TIMEOUT_MS + 5e3;
function messageOf3(cause) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
}
function timedRejection(cause, hostElapsedMs2, cancelled) {
  const e = new Error(messageOf3(cause));
  e.hostElapsedMs = hostElapsedMs2;
  if (cancelled !== void 0) e.cancelled = cancelled;
  return e;
}
var FetchBudget = class {
  constructor(hostFetch2, clock) {
    this.hostFetch = hostFetch2;
    this.clock = clock;
  }
  hostFetch;
  clock;
  queue = [];
  running = /* @__PURE__ */ new Set();
  degraded = /* @__PURE__ */ new Set();
  highWater = 0;
  seq = 0;
  /**
   * A fetch for `endpoint` (an API base URL) at `priority`, for a GcClient.
   * Requests made with a `group` can be dropped together while still queued.
   * `onStart` runs when a request leaves the queue and is handed to herdr.
   */
  fetchFor(endpoint, priority, group = null, onStart = null) {
    const rank = PRIORITIES.indexOf(priority);
    return (url, init) => new Promise((resolve, reject) => {
      this.queue.push({
        endpoint,
        rank,
        seq: this.seq++,
        group,
        start: () => {
          onStart?.();
          this.start(endpoint, url, init, resolve, reject);
        },
        drop: () => reject(timedRejection(`gascity: request to ${url} dropped before it was sent`, 0, "abandoned"))
      });
      this.reclaim();
    });
  }
  /** Enters or leaves degraded mode for an endpoint; leaving it starts what now fits. */
  setDegraded(endpoint, degraded) {
    if (degraded) {
      this.degraded.add(endpoint);
      return;
    }
    this.degraded.delete(endpoint);
    this.pump();
  }
  /**
   * Forgets an endpoint nobody uses any more (the last store on it went, from
   * a copy's close): leaves degraded mode without starting anything. Whatever
   * that frees starts at the next reclaim or settled request.
   */
  forgetEndpoint(endpoint) {
    this.degraded.delete(endpoint);
  }
  /**
   * Drops the group's queued requests: each rejects as cancelled
   * ("abandoned") and is never sent. In-flight requests are untouched (their
   * slots stay taken until herdr settles them). Starts nothing. Returns how
   * many were dropped.
   */
  dropQueued(group) {
    const dropped = this.queue.filter((q) => q.group === group);
    if (dropped.length === 0) return 0;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].group === group) this.queue.splice(i, 1);
    for (const q of dropped) q.drop();
    return dropped.length;
  }
  /** Frees every slot older than RECLAIM_AFTER_MS (its copy closed), then starts what fits. */
  reclaim() {
    const now = this.clock.now();
    for (const r of [...this.running]) {
      if (now - r.startedAt >= RECLAIM_AFTER_MS) {
        const error = `gascity: request cancelled: no answer after ${now - r.startedAt} ms, so herdr cancelled it with the copy that started it`;
        r.end({ error, cancelled: "copy-closed" });
      }
    }
    this.pump();
  }
  /** Requests in flight to one endpoint. */
  inFlightTo(endpoint) {
    let n = 0;
    for (const r of this.running) if (r.endpoint === endpoint) n++;
    return n;
  }
  stats() {
    return { inFlight: this.running.size, queued: this.queue.length, maxInFlight: this.highWater };
  }
  start(endpoint, url, init, resolve, reject) {
    const startedAt = this.clock.now();
    let ended = false;
    const slot = {
      endpoint,
      startedAt,
      end: (outcome) => {
        if (ended) return false;
        ended = true;
        this.running.delete(slot);
        if ("response" in outcome) resolve(outcome.response);
        else reject(timedRejection(outcome.error, this.clock.now() - startedAt, outcome.cancelled));
        this.pump();
        return true;
      }
    };
    this.running.add(slot);
    this.highWater = Math.max(this.highWater, this.running.size);
    let pending;
    try {
      pending = this.hostFetch(url, init);
    } catch (cause) {
      pending = Promise.reject(cause);
    }
    pending.then((response) => slot.end({ response }), (error) => slot.end({ error }));
  }
  startable(q) {
    return !this.degraded.has(q.endpoint) || this.inFlightTo(q.endpoint) < DEGRADED_IN_FLIGHT;
  }
  pump() {
    while (this.running.size < MAX_IN_FLIGHT) {
      let best = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i];
        if (!this.startable(q)) continue;
        const b = best < 0 ? void 0 : this.queue[best];
        if (!b || q.rank < b.rank || q.rank === b.rank && q.seq < b.seq) best = i;
      }
      if (best < 0) return;
      const [next] = this.queue.splice(best, 1);
      next.start();
    }
  }
};

// src/actions/outcome.ts
var OUTCOME_POLL_DELAYS_MS = [500, 1e3, 2e3];
var OUTCOME_POLL_EVERY_MS = 2e3;
var OUTCOME_POLL_LIMIT_MS = 12e4;
var SEND_DEADLINE_MS = 2 * RECLAIM_AFTER_MS;
var ACTIVITY_LIMIT = 50;
function retryGate(entry, snapshot) {
  const s = entry.state;
  if (isPending(s)) return { allowed: false, reason: "the action is still under way" };
  if (s.kind === "done") return { allowed: false, reason: "the action is done" };
  if (s.kind === "failed" || s.kind === "not-sent") return { allowed: true };
  for (const d of entry.spec.refresh) {
    const startedAt = snapshot.fetchStarts[d];
    if (startedAt === void 0 || startedAt < s.at) return { allowed: false, reason: `refreshing ${d} before a retry` };
  }
  return { allowed: true };
}
function successDetail(outcome) {
  const op = outcome.operation;
  const payload = outcome.event?.payload;
  if (isUnrecognized(op)) return "succeeded";
  if (op === "session.create") {
    const p2 = decodeValue(SessionCreateSucceededPayloadSchema, payload, "get-request-outcome", "event.payload");
    if (!p2.ok) return unreadable(p2.error);
    const alias = p2.value.session.alias;
    return `created session ${p2.value.session.id}${alias !== void 0 && alias !== "" ? ` (${alias})` : ""}`;
  }
  const p = op === "session.submit" ? decodeValue(SessionSubmitSucceededPayloadSchema, payload, "get-request-outcome", "event.payload") : decodeValue(SessionMessageSucceededPayloadSchema, payload, "get-request-outcome", "event.payload");
  if (!p.ok) return unreadable(p.error);
  return p.value.queued ? "queued: the session gets it when it next runs" : "delivered";
}
function unreadable(e) {
  return `succeeded (gc's result could not be read: ${e.issues.join("; ")})`;
}
function newIdempotencyKey(random = Math.random) {
  const c = globalThis.crypto;
  if (c !== void 0 && typeof c.randomUUID === "function") return c.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join("");
  const variant = "89ab"[Math.floor(random() * 4)] ?? "8";
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
function unknown2(requestId, operationId, cause, issues) {
  const e = { kind: "outcome-unknown", requestId, operationId, cause };
  if (issues !== void 0) e.issues = issues;
  return e;
}
function pollDelay(polls) {
  return OUTCOME_POLL_DELAYS_MS[polls] ?? OUTCOME_POLL_EVERY_MS;
}
var ActionLedger = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  records = [];
  seq = 0;
  tokens = 0;
  rev = 0;
  snap = { rev: 0, entries: [] };
  disposed = false;
  /** The activity log. */
  snapshot() {
    return this.snap;
  }
  /** Sends a new action now, in the turn of `owner` (the caller's copy), with `key` or a fresh Idempotency-Key. Returns its id. */
  start(owner, spec2, key) {
    const now = this.deps.clock.now();
    const rec = {
      id: ++this.seq,
      spec: spec2,
      key: key ?? this.deps.newKey(),
      attempt: 1,
      startedAt: now,
      state: { kind: "sending", since: now },
      owner,
      group: {},
      token: 0,
      keyPinned: false,
      followUp: spec2.then ? { kind: "waiting" } : null
    };
    this.records.push(rec);
    this.trim();
    this.send(rec, owner);
    return rec.id;
  }
  /**
   * The person retries an action, in the turn of `owner`. Refused while it is
   * under way, once it is done, and after an unknown outcome until its state
   * has been refetched (retryGate).
   */
  retry(owner, id2, snapshot) {
    const rec = this.records.find((r) => r.id === id2);
    if (!rec) return err("the action is no longer in the activity log");
    const gate = retryGate(this.entry(rec), snapshot);
    if (!gate.allowed) return err(gate.reason);
    if (!(rec.keyPinned && rec.spec.idempotent)) rec.key = this.deps.newKey();
    rec.attempt++;
    rec.startedAt = this.deps.clock.now();
    this.send(rec, owner);
    return ok(rec.id);
  }
  /** Refetches what an action changes now ("refresh before retry"). */
  refreshFor(id2) {
    const rec = this.records.find((r) => r.id === id2);
    if (rec) this.refreshAfter(rec);
  }
  /**
   * Called from a copy's own periodic tick: resolves actions past their
   * deadlines, and polls the outcomes of the actions this copy started.
   */
  tick(owner) {
    if (this.disposed) return;
    const now = this.deps.clock.now();
    for (const rec of [...this.records]) {
      const s = rec.state;
      if (s.kind === "sending" && now - s.since > SEND_DEADLINE_MS) {
        const secs = Math.round(SEND_DEADLINE_MS / 1e3);
        if (this.deps.dropQueued(rec.group) > 0) this.resolve(rec, { kind: "not-sent", at: now, reason: `the fetch queue did not reach it within ${secs} s` });
        else this.resolve(rec, { kind: "unknown", at: now, error: unknown2(null, rec.spec.operationId, "timeout", [`no answer within ${secs} s`]) });
      } else if (s.kind === "polling" && now - s.acceptedAt >= OUTCOME_POLL_LIMIT_MS) {
        this.resolve(rec, { kind: "unknown", at: now, error: unknown2(s.requestId, rec.spec.operationId, "outcome-poll-expired") });
      } else if (s.kind === "polling" && (rec.owner === owner || rec.owner === null) && !s.inFlight && now >= s.nextAt) {
        rec.owner = owner;
        this.poll(rec, s);
      } else if (s.kind === "watching" && now >= s.watch.deadline) {
        this.end(rec, s.watch.expired);
      } else if (s.kind === "watching" && rec.owner === owner && !s.inFlight && now >= s.watch.nextAt) {
        this.step(rec, s);
      }
    }
  }
  /**
   * The copy `owner` closed: its actions still under way can no longer learn
   * their outcome (herdr never settles its requests), so they become unknown
   * now. Their queued requests are dropped and never sent. Starts nothing.
   */
  ownerGone(owner) {
    const now = this.deps.clock.now();
    for (const rec of this.records) {
      if (rec.owner !== owner) continue;
      const s = rec.state;
      if (s.kind === "polling") {
        this.deps.dropQueued(rec.group);
        rec.owner = null;
        rec.group = {};
        rec.token = ++this.tokens;
        rec.state = { ...s, inFlight: false, nextAt: now };
        this.commit();
      } else if (s.kind === "watching") {
        this.deps.dropQueued(rec.group);
        this.end(rec, s.watch.abandoned);
      } else if (s.kind === "sending") {
        if (this.deps.dropQueued(rec.group) > 0) {
          this.resolve(rec, { kind: "not-sent", at: now, reason: "the Gas City view that started it closed before it was sent" });
        } else {
          this.resolve(rec, {
            kind: "unknown",
            at: now,
            error: unknown2(null, rec.spec.operationId, "cancelled", ["the Gas City view that started it closed before gc's answer arrived"])
          });
        }
      }
    }
  }
  /** The store went away: late answers are ignored. */
  dispose() {
    this.disposed = true;
  }
  // ---- internals ------------------------------------------------------------------
  send(rec, owner) {
    rec.owner = owner;
    rec.group = {};
    const token = ++this.tokens;
    rec.token = token;
    rec.state = { kind: "sending", since: this.deps.clock.now() };
    this.commit();
    let answer;
    try {
      answer = rec.spec.send(this.deps.client("mutation", rec.group), this.deps.city, rec.key);
    } catch (cause) {
      answer = Promise.reject(cause);
    }
    answer.then(
      (r) => this.sent(rec, token, r),
      (cause) => this.sent(rec, token, err(unknown2(null, rec.spec.operationId, "unreadable-response", [`the action threw: ${String(cause)}`])))
    );
  }
  live(rec, token) {
    return !this.disposed && rec.token === token;
  }
  sent(rec, token, r) {
    if (!this.live(rec, token)) return;
    const now = this.deps.clock.now();
    if (!r.ok) {
      if (r.error.kind === "outcome-unknown") this.resolve(rec, { kind: "unknown", at: now, error: r.error });
      else this.resolve(rec, { kind: "failed", at: now, error: r.error });
      return;
    }
    const sent = r.value;
    if (sent.kind === "watch") {
      this.watch(rec, sent.watch);
      return;
    }
    if (sent.kind === "done") {
      this.resolve(rec, { kind: "done", at: now, detail: sent.detail, requestId: null });
      this.startFollowUp(rec, sent.created);
      return;
    }
    rec.state = {
      kind: "polling",
      requestId: sent.requestId,
      afterSeq: sent.afterSeq,
      acceptedAt: now,
      polls: 0,
      nextAt: now + pollDelay(0),
      inFlight: false,
      lastError: null
    };
    this.commit();
  }
  poll(rec, s) {
    const token = rec.token;
    rec.state = { ...s, inFlight: true };
    this.commit();
    getRequestOutcome(this.deps.client("events", rec.group), this.deps.city, s.requestId, s.afterSeq).then(
      (r) => this.polled(rec, token, r),
      (cause) => this.polled(rec, token, err(unknown2(s.requestId, "get-request-outcome", "unreadable-response", [String(cause)])))
    );
  }
  polled(rec, token, r) {
    const s = rec.state;
    if (!this.live(rec, token) || s.kind !== "polling") return;
    const now = this.deps.clock.now();
    const next = { ...s, inFlight: false, polls: s.polls + 1, nextAt: now + pollDelay(s.polls + 1) };
    if (!r.ok) {
      const e = r.error;
      if (e.kind === "cancelled" || backsOff(e)) {
        rec.state = { ...next, lastError: e };
        this.commit();
        return;
      }
      this.resolve(rec, { kind: "unknown", at: now, error: unknown2(s.requestId, rec.spec.operationId, "outcome-poll-failed", [describe3(e)]) });
      return;
    }
    const outcome = r.value;
    const failure2 = outcomeFailure(outcome);
    if (failure2?.kind === "outcome-failed") {
      this.resolve(rec, { kind: "failed", at: now, error: failure2 });
    } else if (failure2?.kind === "outcome-unknown") {
      this.resolve(rec, { kind: "unknown", at: now, error: { ...failure2, operationId: rec.spec.operationId } });
    } else if (failure2 !== null) {
      this.resolve(rec, { kind: "unknown", at: now, error: unknown2(s.requestId, rec.spec.operationId, "unreadable-response", [describe3(failure2)]) });
    } else if (outcome.state === "succeeded") {
      this.resolve(rec, { kind: "done", at: now, detail: successDetail(outcome), requestId: s.requestId });
      this.startFollowUp(rec, void 0);
    } else {
      rec.state = { ...next, lastError: null };
      this.commit();
    }
  }
  /** The action goes on as `watch` (from its request's answer, or from its previous step). */
  watch(rec, watch) {
    const s = rec.state;
    rec.state = { kind: "watching", since: s.kind === "watching" ? s.since : this.deps.clock.now(), watch, inFlight: false };
    this.commit();
  }
  /** Runs a watched action's next step, in the turn of the copy that started it. */
  step(rec, s) {
    const token = rec.token;
    rec.state = { ...s, inFlight: true };
    this.commit();
    let next;
    try {
      next = s.watch.step(this.deps.client("mutation", rec.group), this.deps.city);
    } catch (cause) {
      next = Promise.reject(cause);
    }
    next.then(
      (r) => {
        if (!this.live(rec, token) || rec.state.kind !== "watching") return;
        if ("step" in r) this.watch(rec, r);
        else this.end(rec, r);
      },
      (cause) => {
        if (!this.live(rec, token) || rec.state.kind !== "watching") return;
        this.end(rec, { kind: "failed", error: { kind: "host-call", api: rec.spec.verb, cause: String(cause) } });
      }
    );
  }
  /** Ends a watched action as its Watch says. */
  end(rec, e) {
    const at3 = this.deps.clock.now();
    switch (e.kind) {
      case "done":
        this.resolve(rec, { kind: "done", at: at3, detail: e.detail, requestId: null });
        return;
      case "failed":
        this.resolve(rec, { kind: "failed", at: at3, error: e.error });
        return;
      case "not-sent":
        this.resolve(rec, { kind: "not-sent", at: at3, reason: e.reason });
        return;
    }
  }
  /** Ends an action and refetches what it changed (a done one too: rig and agent changes are not evented). */
  resolve(rec, state) {
    rec.token = ++this.tokens;
    rec.state = state;
    if (state.kind === "unknown") rec.keyPinned = true;
    this.refreshAfter(rec);
    this.trim();
    this.commit();
  }
  /**
   * The first action is done: sends its follow-up now, in this turn (the
   * owner's), for the id gc gave what it created. Once only.
   */
  startFollowUp(rec, created) {
    const then2 = rec.spec.then;
    if (!then2 || rec.followUp?.kind !== "waiting") return;
    const owner = rec.owner;
    if (created === void 0 || owner === null) {
      rec.followUp = {
        kind: "not-sent",
        reason: created === void 0 ? "gc's answer did not name what it created" : "no Gas City view was left to send it"
      };
      this.commit();
      return;
    }
    rec.followUp = { kind: "started", id: this.start(owner, then2.spec(created)) };
    this.commit();
  }
  refreshAfter(rec) {
    this.deps.refresh(rec.spec.refresh);
    const t = rec.spec.target;
    if (t.kind === "session") this.deps.refreshDetail(t.id);
    if (t.kind === "bead") this.deps.refreshBead(t.id);
  }
  /** Drops the oldest finished actions beyond ACTIVITY_LIMIT. */
  trim() {
    let excess = this.records.length - ACTIVITY_LIMIT;
    for (let i = 0; i < this.records.length && excess > 0; ) {
      if (isPending(this.records[i].state)) {
        i++;
        continue;
      }
      this.records.splice(i, 1);
      excess--;
    }
  }
  entry(rec) {
    return {
      id: rec.id,
      spec: rec.spec,
      key: rec.key,
      attempt: rec.attempt,
      startedAt: rec.startedAt,
      state: rec.state,
      keyPinned: rec.keyPinned,
      followUp: rec.spec.then && rec.followUp ? { verb: rec.spec.then.verb, state: rec.followUp } : null
    };
  }
  commit() {
    this.snap = { rev: ++this.rev, entries: this.records.map((r) => this.entry(r)) };
  }
};
function describe3(e) {
  return errorText(e);
}

// src/vm/activity.ts
var SAME_KEY_RETRY = "Retry (same key: gc deduplicates it within 30 min, not across a gc restart)";
var MAY_REPEAT_RETRY = "Retry (gc cannot deduplicate this: it may happen twice)";
var REPEATABLE = /* @__PURE__ */ new Set(["session.submit", "session.interrupt", "session.message"]);
function busyKey(spec2) {
  return `${spec2.kind}|${targetKey(spec2.target)}`;
}
function isBusy(model, spec2) {
  return model !== null && !REPEATABLE.has(spec2.kind) && model.busy.has(busyKey(spec2));
}
function seconds2(ms) {
  return `${Math.max(0, Math.round(ms / 1e3))} s`;
}
function pinnedNote(e) {
  if (!e.keyPinned) return "";
  return e.spec.idempotent ? ". An earlier attempt may have landed, so a retry keeps its key." : ". An earlier attempt may have landed, and gc cannot deduplicate this: a retry may make it happen twice.";
}
function retryLabel(e) {
  if (!e.keyPinned) return "Retry";
  return e.spec.idempotent ? SAME_KEY_RETRY : MAY_REPEAT_RETRY;
}
function followUpText(e) {
  const f = e.followUp;
  if (f === null) return null;
  let where;
  if (f.state.kind === "started") where = `sent (action ${f.state.id})`;
  else if (f.state.kind === "not-sent") where = `not sent, ${f.state.reason}`;
  else {
    switch (e.state.kind) {
      case "sending":
      case "polling":
      case "watching":
      case "done":
        where = "sent once the bead is created";
        break;
      case "unknown":
        where = "not sent, the bead may not exist; a retry of the create sends it once gc confirms the bead";
        break;
      case "failed":
      case "not-sent":
        where = "not sent, the bead was not created";
        break;
    }
  }
  return cleanLine(`then ${f.verb}: ${where}`);
}
function row(e, city, now) {
  const r = stateRow(e, city, now);
  const then2 = followUpText(e);
  return then2 === null ? r : { ...r, detail: `${r.detail.replace(/\.$/, "")}; ${then2}` };
}
function stateRow(e, city, now) {
  const s = e.state;
  const base = {
    id: e.id,
    kind: e.spec.kind,
    title: cleanLine(`${e.spec.verb} · ${targetText(e.spec.target)}`),
    attempt: e.attempt,
    refresh: false,
    retry: { kind: "none" }
  };
  switch (s.kind) {
    case "sending":
      return { ...base, tone: "pending", detail: `sending (${seconds2(now - s.since)})`, requestId: null };
    case "polling": {
      const last = s.lastError ? `; last poll: ${errorText(s.lastError)}` : "";
      return {
        ...base,
        tone: "pending",
        requestId: cleanLine(s.requestId),
        detail: cleanLine(`accepted, waiting for gc's outcome of request ${s.requestId} (${seconds2(now - s.acceptedAt)})${last}`)
      };
    }
    case "watching":
      return { ...base, tone: "pending", detail: cleanLine(`${s.watch.detail} (${seconds2(now - s.since)})`), requestId: null };
    case "done":
      return { ...base, tone: "done", detail: cleanLine(s.detail), requestId: s.requestId === null ? null : cleanLine(s.requestId) };
    case "failed": {
      const hint = problemHint(s.error) === "answer-pending-prompt" ? " (answer the pending prompt first)" : "";
      return {
        ...base,
        tone: "failed",
        detail: `${errorText(s.error)}${hint}${pinnedNote(e)}`,
        requestId: s.error.kind === "outcome-failed" ? cleanLine(s.error.requestId) : null,
        retry: { kind: "retry", label: retryLabel(e) }
      };
    }
    case "unknown": {
      const gate = city ? retryGate(e, city) : { allowed: false, reason: "no city data" };
      const twice = e.spec.idempotent ? SAME_KEY_RETRY : MAY_REPEAT_RETRY;
      return {
        ...base,
        tone: "unknown",
        refresh: true,
        requestId: s.error.requestId === null ? null : cleanLine(s.error.requestId),
        detail: gate.allowed ? `${errorText(s.error)}. The state has been refreshed: check it before retrying.` : `${errorText(s.error)}. Refreshing the state before a retry is offered.`,
        retry: gate.allowed ? { kind: "retry", label: twice } : { kind: "wait", reason: gate.reason }
      };
    }
    case "not-sent":
      return { ...base, tone: "not-sent", detail: cleanLine(`not sent: ${s.reason}${pinnedNote(e)}`), requestId: null, retry: { kind: "retry", label: retryLabel(e) } };
  }
}
function activityModel(activity, city, now) {
  const busy = /* @__PURE__ */ new Set();
  for (const e of activity.entries) if (isPending(e.state)) busy.add(busyKey(e.spec));
  return { rows: [...activity.entries].reverse().map((e) => row(e, city, now)), busy };
}

// src/gc/events.ts
var BEAD_PAYLOAD_EVENTS = /* @__PURE__ */ new Set(["bead.created", "bead.updated", "bead.closed", "bead.deleted"]);
function eventBead(e) {
  if (!BEAD_PAYLOAD_EVENTS.has(e.type)) return ok(null);
  const r = decodeValue(BeadEventPayloadSchema, e.payload, "get-v0-city-by-city-name-events", `event ${e.seq} ${e.type} payload`);
  return r.ok ? ok(r.value.bead) : r;
}

// src/sync/closedList.ts
var INFRASTRUCTURE = new Set(INFRASTRUCTURE_BEAD_TYPES);
var CLOSED = "closed";
var ClosedList = class {
  constructor(limit) {
    this.limit = limit;
  }
  limit;
  list = [];
  droppedIds = /* @__PURE__ */ new Set();
  /** Distinct infrastructure beads among the newest closes, oldest first. */
  infrastructure = [];
  /** Newest close first. */
  recent() {
    return this.list;
  }
  /** Infrastructure beads among the newest closes (at most `limit`): hidden, not listed. */
  hidden() {
    return this.infrastructure.length;
  }
  /** gc said this bead is not closed (any more) or gone: the seed must not list it either. */
  dropped(id2) {
    return this.droppedIds.has(id2);
  }
  /** A freshly fetched seed lists these beads as closed now: gc's newest word, so they are no longer dropped. */
  reaffirm(ids) {
    for (const id2 of ids) this.droppedIds.delete(id2);
  }
  /** Is the bead on the list? */
  has(id2) {
    return this.list.some((c) => c.bead.id === id2);
  }
  /** gc reported a close at `seq`, with the bead as gc has it now. */
  closed(seq, bead) {
    if (INFRASTRUCTURE.has(bead.issue_type)) {
      this.infrastructure = [...this.infrastructure.filter((id2) => id2 !== bead.id), bead.id].slice(-this.limit);
      return;
    }
    if (bead.status !== CLOSED) {
      this.remove(bead.id);
      return;
    }
    const cur = this.list.find((c) => c.bead.id === bead.id);
    if (cur && cur.seq > seq) return;
    this.droppedIds.delete(bead.id);
    this.list = [...this.list.filter((c) => c.bead.id !== bead.id), { seq, bead }].sort((a, b) => b.seq - a.seq).slice(0, this.limit);
  }
  /** The bead as gc has it now (an update): dropped unless still closed; a listed one is updated in place. */
  current(bead) {
    if (bead.status !== CLOSED) {
      this.remove(bead.id);
      return;
    }
    this.list = this.list.map((c) => c.bead.id === bead.id ? { seq: c.seq, bead } : c);
  }
  /** The bead was deleted, or gc no longer has it. */
  remove(id2) {
    this.list = this.list.filter((c) => c.bead.id !== id2);
    this.droppedIds.add(id2);
  }
};

// src/sync/scheduler.ts
var TASKS = ["events", "sessions", "peek", "sweep"];
var CADENCE = {
  events: { onScreenMs: 2e3, hiddenMs: 1e4 },
  sessions: { onScreenMs: 5e3, hiddenMs: 3e4 },
  peek: { onScreenMs: 2e3, hiddenMs: null },
  sweep: { onScreenMs: 6e4, hiddenMs: 6e4 }
};
var DEBOUNCE_MS = 300;
function intervalOf(task, onScreen) {
  const c = CADENCE[task];
  return onScreen ? c.onScreenMs : c.hiddenMs;
}
function plan(last, now, input) {
  const due = [];
  let wakeAt = input.extraWakeAt ?? Infinity;
  for (const task of TASKS) {
    if (task === "peek" && !input.peek) continue;
    const interval = intervalOf(task, input.onScreen);
    if (interval === null) continue;
    const ran = last[task];
    const at3 = ran === null ? now : ran + interval;
    if (at3 <= now) {
      due.push(task);
      wakeAt = Math.min(wakeAt, now + interval);
    } else {
      wakeAt = Math.min(wakeAt, at3);
    }
  }
  return { due, wakeAt };
}

// src/sync/staleness.ts
var STALE_FLOOR_MS = 1e4;
function staleAfterMs(intervalMs) {
  return Math.max(3 * intervalMs, STALE_FLOOR_MS);
}
function freshness(slot, now, input) {
  if (slot.fetchedAt === null) return { kind: "never", error: slot.error };
  const confirmed = !slot.dirty && input.confirmedAt !== null ? Math.max(slot.fetchedAt, input.confirmedAt) : slot.fetchedAt;
  const ageMs = now - confirmed;
  if (slot.error !== null) return { kind: "stale", ageMs, reason: "error", error: slot.error };
  if (ageMs > staleAfterMs(input.intervalMs)) return { kind: "stale", ageMs, reason: "overdue", error: null };
  return { kind: "fresh", ageMs };
}

// src/sync/watcher.ts
var EVENT_PAGE_LIMIT = 50;
function readEventPage(cursor, page) {
  if (page.total < cursor) return { cursor: page.total, newer: [], resync: "reset" };
  const unreadable2 = new Set(page.unreadable);
  const length = page.items.length + unreadable2.size;
  let next = 0;
  let above = null;
  let unreadableNew = false;
  for (let position = 0; position < length; position++) {
    if (unreadable2.has(position)) {
      const isOld = above === null ? page.total <= cursor : above <= cursor + 1;
      if (!isOld) unreadableNew = true;
      continue;
    }
    above = page.items[next++]?.seq ?? above;
  }
  const newer = page.items.filter((e) => e.seq > cursor).sort((a, b) => a.seq - b.seq);
  const newest = newer.at(-1)?.seq ?? cursor;
  const hole = newer.length > 0 && (newer[0]?.seq ?? 0) > cursor + 1;
  if (unreadableNew) return { cursor: Math.max(newest, page.total), newer, resync: "gap" };
  return { cursor: newest, newer, resync: hole ? "gap" : null };
}

// src/sync/store.ts
var SESSION_PAGE = 500;
var MAX_SESSION_ROWS = 2e3;
var BOARD_LIMIT = 50;
var MAX_CLOSED_RECENT = 20;
var BEAD_FETCHES_PER_STEP = 10;
var ERROR_RING = 100;
var PEEK_LINES = 40;
var STEP_STALL_MS = 4 * RECLAIM_AFTER_MS;
var EMPTY_SLOT = { value: null, fetchedAt: null, error: null, dirty: true, held: false };
var EVENT_DRIVEN = /* @__PURE__ */ new Set(["rigs", "agents", "ready", "inProgress"]);
var PRIORITY_RANK = { mutation: 0, events: 1, snapshot: 2, peek: 3, sweep: 4 };
function freshSlot() {
  return { value: null, fetchedAt: null, error: null, held: false };
}
function isCancelled(error) {
  return error.kind === "cancelled";
}
function holds(error) {
  return !backsOff(error) && !isCancelled(error);
}
function onDemand() {
  return { ...freshSlot(), due: true };
}
function messageOf4(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function domainFreshness(s, domain, now) {
  if (EVENT_DRIVEN.has(domain)) {
    return freshness(s[domain], now, { intervalMs: intervalOf("events", s.onScreen) ?? 0, confirmedAt: s.events.error ? null : s.events.polledAt });
  }
  return freshness(s[domain], now, { intervalMs: intervalOf("sessions", s.onScreen) ?? 0, confirmedAt: null });
}
var CityStore = class {
  constructor(key, deps) {
    this.key = key;
    this.deps = deps;
    this.onScreen = deps.onScreen;
    for (const d of ALL_DOMAINS) this.mark(d, 0, "snapshot");
    this.snap = this.build(0);
    deps.endpoint.addListener(this);
  }
  key;
  deps;
  snap;
  slots = {
    rigs: freshSlot(),
    agents: freshSlot(),
    sessions: freshSlot(),
    pending: freshSlot(),
    ready: freshSlot(),
    inProgress: freshSlot()
  };
  due = /* @__PURE__ */ new Map();
  /** Beads to fetch by id for the closed list: a close (`seq`) whose event carried no readable bead, or a recheck (`seq` null). */
  closedQueue = [];
  peeks = /* @__PURE__ */ new Map();
  lookups = /* @__PURE__ */ new Map();
  /** Watched beads (open bead details) and how many watches each has. */
  beadWatches = /* @__PURE__ */ new Map();
  seed = { ...freshSlot(), due: true };
  closed = new ClosedList(MAX_CLOSED_RECENT);
  incomplete = false;
  events = {
    cursor: null,
    polledAt: null,
    error: null,
    held: false,
    resyncs: 0
  };
  errors = [];
  fetchStarts = {};
  last = { events: null, sessions: null, peek: null, sweep: null };
  onScreen;
  step = null;
  generation = 0;
  disposed = false;
  /** The current snapshot. */
  snapshot() {
    return this.snap;
  }
  /**
   * Called by a subscribed copy, in its own turn (its periodic timer): starts
   * a step if one is due and none is running, and abandons a stalled one.
   */
  tick(starter) {
    if (this.disposed) return;
    const now = this.deps.clock.now();
    if (this.step) {
      const idleMs = now - this.step.progressAt;
      if (idleMs <= STEP_STALL_MS) return;
      this.record("step", { kind: "step-stalled", idleMs });
      this.abandon();
      this.commit();
    }
    if (!this.wantsStep(now)) return;
    const step2 = { gen: ++this.generation, starter, progressAt: now, probe: null };
    this.step = step2;
    this.runStep(step2).then(
      () => this.endStep(step2),
      (cause) => {
        if (this.step === step2) this.record("step", { kind: "step-crashed", message: messageOf4(cause) });
        this.endStep(step2);
        this.commit();
      }
    );
  }
  /** The copy `starter` closes: drop the step it started (its requests may never settle). Starts nothing. */
  abandonStartedBy(starter) {
    if (this.step?.starter === starter) this.abandon();
  }
  /** Switches cadence; the next tick polls at once if a gascity view appeared. */
  setOnScreen(onScreen) {
    if (this.onScreen === onScreen) return;
    this.onScreen = onScreen;
    this.commit();
  }
  /** "Retry now": re-arms held domains and, if the endpoint is backing off, makes the probe due. */
  retryNow() {
    this.rearmHeld(this.deps.clock.now(), "snapshot");
    for (const b of this.lookups.values()) b.due = true;
    this.deps.endpoint.retryNow();
    this.commit();
  }
  /** Refetches `domains` at the next tick, held or not. */
  refresh(domains) {
    const now = this.deps.clock.now();
    for (const d of domains) {
      this.slots[d].held = false;
      this.mark(d, now, "snapshot");
    }
    this.commit();
  }
  /** Starts (or joins) watching a session's detail: output, wake reasons, pending prompt; returns the release. */
  watchPeek(sessionId) {
    const p = this.peeks.get(sessionId);
    if (p) p.refs++;
    else {
      this.peeks.set(sessionId, {
        ...freshSlot(),
        refs: 1,
        due: true,
        wake: onDemand(),
        pending: { ...onDemand(), key: this.pendingKey(sessionId) }
      });
      this.commit();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const q = this.peeks.get(sessionId);
      if (!q) return;
      q.refs--;
      if (q.refs <= 0) {
        this.peeks.delete(sessionId);
        this.commit();
      }
    };
  }
  /** Starts (or joins) watching a bead: fetched by id, and again on an event about it or at the sweep; returns the release. */
  watchBead(beadId) {
    this.beadWatches.set(beadId, (this.beadWatches.get(beadId) ?? 0) + 1);
    this.syncLookups();
    this.commit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.beadWatches.get(beadId) ?? 0) - 1;
      if (n > 0) this.beadWatches.set(beadId, n);
      else this.beadWatches.delete(beadId);
      this.syncLookups();
      this.commit();
    };
  }
  /** Refetches a watched session's output, wake reasons and pending prompt at the next tick. */
  refreshDetail(sessionId) {
    const w = this.peeks.get(sessionId);
    if (!w) return;
    for (const part of [w, w.wake, w.pending]) {
      part.held = false;
      part.due = true;
    }
    this.commit();
  }
  /** Refetches a bead fetched by id (a watched or active bead) at the next tick; a bead the store does not fetch by id is left alone. */
  refreshBead(beadId) {
    const b = this.lookups.get(beadId);
    if (!b) return;
    b.held = false;
    b.due = true;
    this.commit();
  }
  /** Ends the store: a running step's late results are dropped. */
  dispose() {
    this.abandon();
    this.disposed = true;
    this.deps.endpoint.removeListener(this);
  }
  get isDisposed() {
    return this.disposed;
  }
  // ---- EndpointListener -------------------------------------------------------
  endpointChanged(recovered) {
    if (recovered) {
      const now = this.deps.clock.now();
      for (const d of ALL_DOMAINS) this.mark(d, now, "snapshot");
      for (const b of this.lookups.values()) b.due = true;
      this.incomplete = true;
      this.recheckClosed();
    }
    this.commit();
  }
  // ---- steps --------------------------------------------------------------------
  abandon() {
    const step2 = this.step;
    if (!step2) return;
    this.step = null;
    this.generation++;
    if (step2.probe !== null) this.deps.endpoint.endProbe(step2.probe);
    this.deps.endpoint.dropQueued(step2);
  }
  endStep(step2) {
    if (step2.probe !== null) this.deps.endpoint.endProbe(step2.probe);
    if (this.step === step2) this.step = null;
  }
  current(step2) {
    return !this.disposed && this.step === step2;
  }
  progress(step2) {
    step2.progressAt = this.deps.clock.now();
  }
  sweepDue(now) {
    return this.last.sweep === null || now >= this.last.sweep + (intervalOf("sweep", this.onScreen) ?? 0);
  }
  wantsStep(now) {
    const gate = this.deps.endpoint.peekGate(now);
    if (gate.kind === "wait") return false;
    if (gate.kind === "probe") return true;
    if (this.events.cursor === null) return !this.events.held || this.sweepDue(now);
    if (plan(this.last, now, { onScreen: this.onScreen, peek: this.peeks.size > 0, extraWakeAt: null }).due.length > 0) return true;
    for (const d of this.due.values()) if (d.at <= now) return true;
    if (this.closedQueue.length > 0) return true;
    if (this.seed.due && !this.seed.held) return true;
    if ([...this.lookups.values()].some((b) => b.due && !b.held)) return true;
    for (const [id2, w] of this.peeks) {
      if (w.wake.due && !w.wake.held && this.templateOf(id2) !== void 0 || w.pending.due && !w.pending.held) return true;
    }
    return this.onScreen && [...this.peeks.values()].some((q) => q.due && !q.held);
  }
  async runStep(step2) {
    const now = this.deps.clock.now();
    const gate = this.deps.endpoint.gate(now);
    if (gate.kind === "wait") return;
    if (gate.kind === "probe") {
      step2.probe = gate.token;
      this.last.events = now;
      await this.pollEvents(step2, this.events.cursor === null ? 1 : EVENT_PAGE_LIMIT);
      return;
    }
    if (this.events.cursor === null) {
      if (this.sweepDue(now)) {
        this.last.sweep = now;
        this.rearmHeld(now, "sweep");
      }
      if (this.events.held) return;
      this.last.events = now;
      if (!await this.pollEvents(step2, 1)) return;
    }
    const p = plan(this.last, now, { onScreen: this.onScreen, peek: this.peeks.size > 0, extraWakeAt: null });
    for (const task of p.due) {
      if (task === "events") {
        this.last.events = now;
        if (!this.events.held && !await this.pollEvents(step2, EVENT_PAGE_LIMIT)) return;
      } else if (task === "sessions") {
        this.last.sessions = now;
        this.mark("sessions", now, "snapshot");
        this.mark("pending", now, "snapshot");
      } else if (task === "sweep") {
        this.last.sweep = now;
        this.rearmHeld(now, "sweep");
        for (const d of ALL_DOMAINS) this.mark(d, now, "sweep");
        for (const id2 of this.beadWatches.keys()) {
          const b = this.lookups.get(id2);
          if (b) b.due = true;
        }
      } else {
        this.last.peek = now;
        for (const q of this.peeks.values()) q.due = true;
      }
    }
    if (!this.current(step2)) return;
    await this.fetchDue(step2);
  }
  gateOpen(step2) {
    return this.current(step2) && this.deps.endpoint.peekGate(this.deps.clock.now()).kind === "open";
  }
  async fetchDue(step2) {
    for (const d of ALL_DOMAINS) {
      const due = this.due.get(d);
      if (!due || due.at > this.deps.clock.now()) continue;
      if (!this.gateOpen(step2)) return;
      await this.fetchDomain(step2, d, due.priority);
    }
    if (this.seed.due && !this.seed.held) {
      if (!this.gateOpen(step2)) return;
      await this.fetchSeed(step2);
    }
    await this.fetchClosed(step2);
    await this.fetchLookups(step2);
    for (const [id2, w] of [...this.peeks]) {
      if (w.wake.due && !w.wake.held && this.templateOf(id2) !== void 0) {
        if (!this.gateOpen(step2)) return;
        await this.fetchWake(step2, id2);
      }
      if (w.pending.due && !w.pending.held) {
        if (!this.gateOpen(step2)) return;
        await this.fetchSessionPending(step2, id2);
      }
    }
    if (this.onScreen) {
      for (const [id2, q] of [...this.peeks]) {
        if (!q.due || q.held) continue;
        if (!this.gateOpen(step2)) return;
        await this.fetchPeek(step2, id2);
      }
    }
  }
  // ---- bookkeeping --------------------------------------------------------------
  mark(d, at3, priority) {
    if (this.slots[d].held) return;
    const cur = this.due.get(d);
    if (!cur) {
      this.due.set(d, { at: at3, priority });
      return;
    }
    this.due.set(d, {
      at: Math.min(cur.at, at3),
      priority: PRIORITY_RANK[priority] < PRIORITY_RANK[cur.priority] ? priority : cur.priority
    });
  }
  rearmHeld(now, priority) {
    for (const d of ALL_DOMAINS) {
      if (this.slots[d].held) {
        this.slots[d].held = false;
        this.mark(d, now, priority);
      }
    }
    this.events.held = false;
    for (const p of this.peeks.values()) {
      if (p.held) {
        p.held = false;
        p.due = true;
      }
    }
    if (this.seed.value === null) this.seed.due = true;
    this.seed.held = false;
    for (const b of this.lookups.values()) {
      if (b.held) {
        b.held = false;
        b.due = true;
      }
    }
    for (const w of this.peeks.values()) {
      for (const part of [w.wake, w.pending]) {
        if (part.held) {
          part.held = false;
          part.due = true;
        }
      }
    }
  }
  /**
   * Reports a read's outcome to the endpoint; returns true if it succeeded. A
   * cancelled request says nothing about gc: it is recorded, nothing more.
   */
  settle(r, source) {
    if (r.ok) {
      this.deps.endpoint.succeeded();
      return true;
    }
    this.record(source, r.error);
    if (isCancelled(r.error)) return false;
    if (backsOff(r.error)) this.deps.endpoint.failed(r.error);
    else this.deps.endpoint.succeeded();
    return false;
  }
  /** Records a failure of app-wide work on this city's data (a toast that could not be posted) in its diagnostics. */
  noteError(source, error) {
    this.record(source, error);
  }
  record(source, error) {
    const entry = { at: this.deps.clock.now(), source, error };
    this.errors = [...this.errors, entry].slice(-ERROR_RING);
    try {
      this.deps.onError(this.key, entry);
    } catch (cause) {
      const hookFailed = { at: entry.at, source: "onError", error: { kind: "listener-failed", message: messageOf4(cause) } };
      this.errors = [...this.errors, hookFailed].slice(-ERROR_RING);
    }
  }
  // ---- reads --------------------------------------------------------------------
  async pollEvents(step2, limit) {
    const r = await pollEvents(this.deps.endpoint.client("events", step2), this.key.city, { limit });
    if (!this.current(step2)) return false;
    this.progress(step2);
    const now = this.deps.clock.now();
    if (!this.settle(r, "events")) {
      if (!r.ok && !isCancelled(r.error)) {
        this.events.error = r.error;
        if (holds(r.error)) this.events.held = true;
      }
      this.commit();
      return false;
    }
    if (!r.ok) return false;
    for (const u of r.value.unreadable) this.record("events", u.error);
    const page = r.value;
    this.events.error = null;
    this.events.polledAt = now;
    if (this.events.cursor === null) {
      this.events.cursor = page.items.reduce((max, e) => Math.max(max, e.seq), page.items.length > 0 ? 0 : page.total);
      this.commit();
      return true;
    }
    const reading = readEventPage(this.events.cursor, { items: page.items, unreadable: page.unreadable.map((u) => u.index), total: page.total });
    this.events.cursor = reading.cursor;
    const at3 = now + DEBOUNCE_MS;
    if (reading.resync) {
      this.events.resyncs++;
      this.incomplete = true;
      this.recheckClosed();
      for (const d of ALL_DOMAINS) this.mark(d, at3, "events");
    }
    const inv = invalidationFor(reading.newer, this.known());
    for (const d of inv.domains) this.mark(d, at3, "events");
    for (const e of reading.newer) {
      const looked = e.type.startsWith("bead.") && e.subject !== void 0 ? this.lookups.get(e.subject) : void 0;
      if (looked) looked.due = true;
    }
    if (reading.resync) for (const b of this.lookups.values()) b.due = true;
    this.beadEvents(reading.newer);
    if (reading.newer.length > 0 || reading.resync) {
      const batch = { key: this.key, events: reading.newer, resync: reading.resync, citiesChanged: inv.cities };
      try {
        this.deps.emit(batch);
      } catch (cause) {
        this.record("listener", { kind: "listener-failed", message: messageOf4(cause) });
      }
    }
    this.commit();
    return true;
  }
  known() {
    const sessionIds = new Set((this.slots.sessions.value?.items ?? []).map((s) => s.id));
    return { sessionIds };
  }
  workQuery(extra) {
    const q = {
      exclude_type: INFRASTRUCTURE_BEAD_TYPES,
      limit: extra.limit
    };
    if (extra.sort) q.sort = extra.sort;
    if (extra.status) q.status = extra.status;
    return q;
  }
  async load(step2, d, priority) {
    const c = this.deps.endpoint.client(priority, step2);
    const city = this.key.city;
    switch (d) {
      case "rigs":
        return await listRigs(c, city);
      case "agents":
        return await listAgents(c, city);
      case "pending":
        return await listPending(c, city);
      case "ready":
        return await listWork(c, city, this.workQuery({ limit: BOARD_LIMIT }));
      case "inProgress":
        return await listWork(c, city, this.workQuery({ limit: BOARD_LIMIT, status: "in_progress" }));
      default:
        return await this.loadSessions(step2, priority);
    }
  }
  async loadSessions(step2, priority) {
    const c = this.deps.endpoint.client(priority, step2);
    const out = { items: [], unreadable: [], total: 0, truncated: false, partial: false, partialErrors: [] };
    let cursor;
    for (; ; ) {
      const r = await listSessions(c, this.key.city, cursor === void 0 ? { limit: SESSION_PAGE } : { limit: SESSION_PAGE, cursor });
      this.progress(step2);
      if (!r.ok) return r;
      const offset = out.items.length + out.unreadable.length;
      out.items.push(...r.value.items);
      out.unreadable.push(...r.value.unreadable.map((u) => ({ ...u, index: u.index + offset })));
      out.total = r.value.total;
      out.partial ||= r.value.partial === true;
      out.partialErrors.push(...r.value.partial_errors);
      const rows = out.items.length + out.unreadable.length;
      if (!r.value.next_cursor) break;
      if (rows >= MAX_SESSION_ROWS) {
        out.truncated = true;
        break;
      }
      if (!this.current(step2)) break;
      cursor = r.value.next_cursor;
    }
    return { ok: true, value: out };
  }
  async fetchDomain(step2, d, priority) {
    const startedAt = this.deps.clock.now();
    const r = await this.load(step2, d, priority);
    if (!this.current(step2)) return;
    this.progress(step2);
    const slot = this.slots[d];
    if (this.settle(r, d) && r.ok) {
      slot.value = r.value;
      slot.fetchedAt = this.deps.clock.now();
      this.fetchStarts[d] = startedAt;
      slot.error = null;
      slot.held = false;
      this.due.delete(d);
      if (d === "pending") this.pendingChanged();
      this.syncLookups();
    } else if (!r.ok && !isCancelled(r.error)) {
      slot.error = r.error;
      if (holds(r.error)) {
        slot.held = true;
        this.due.delete(d);
      }
    }
    this.commit();
  }
  async fetchSeed(step2) {
    const r = await listWork(this.deps.endpoint.client("snapshot", step2), this.key.city, this.workQuery({ limit: MAX_CLOSED_RECENT, status: "closed", sort: "newest" }));
    if (!this.current(step2)) return;
    this.progress(step2);
    if (this.settle(r, "closed-seed") && r.ok) {
      this.seed = { value: r.value, fetchedAt: this.deps.clock.now(), error: null, held: false, due: false };
      this.closed.reaffirm(r.value.items.filter((b) => b.status === "closed").map((b) => b.id));
      this.syncLookups();
    } else if (!r.ok && !isCancelled(r.error)) {
      this.seed.error = r.error;
      if (holds(r.error)) {
        this.seed.held = true;
        this.seed.due = false;
      }
    }
    this.commit();
  }
  /** Follows the closed list through bead events, oldest first. */
  beadEvents(events) {
    for (const e of events) {
      if (!e.type.startsWith("bead.") || e.subject === void 0) continue;
      const decoded = eventBead(e);
      if (!decoded.ok) this.record("events", decoded.error);
      const bead = decoded.ok ? decoded.value : null;
      if (e.type === "bead.closed") {
        if (bead) this.closed.closed(e.seq, bead);
        else this.queueClosed(e.subject, e.seq);
      } else if (this.closed.has(e.subject) || this.seeded(e.subject)) {
        if (e.type === "bead.deleted") this.closed.remove(e.subject);
        else if (bead) this.closed.current(bead);
        else this.queueClosed(e.subject, null);
      }
    }
  }
  /** The seed shows this bead (and gc has not said since that it is no longer closed). */
  seeded(id2) {
    return !this.closed.dropped(id2) && (this.seed.value?.items.some((b) => b.id === id2) ?? false);
  }
  /** Queues a fetch by id: a close at `seq`, or (null) a recheck of a listed bead. A close supersedes a recheck. */
  queueClosed(id2, seq) {
    const cur = this.closedQueue.find((c) => c.id === id2);
    if (cur && (seq === null || cur.seq !== null && cur.seq >= seq)) return;
    this.closedQueue = [...this.closedQueue.filter((c) => c.id !== id2), { id: id2, seq }];
  }
  /** Events may have been missed: fetch every listed bead again, and the seed once. */
  recheckClosed() {
    for (const c of this.closed.recent()) this.queueClosed(c.bead.id, null);
    if (!this.seed.held) this.seed.due = true;
  }
  async fetchClosed(step2) {
    if (this.closedQueue.length === 0) return;
    const rechecks = this.closedQueue.filter((c) => c.seq === null);
    let closes = this.closedQueue.filter((c) => c.seq !== null).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    if (closes.length > BEAD_FETCHES_PER_STEP) {
      this.incomplete = true;
      closes = closes.slice(0, BEAD_FETCHES_PER_STEP);
    }
    this.closedQueue = [...rechecks, ...closes];
    for (const ref of this.closedQueue.slice(0, BEAD_FETCHES_PER_STEP)) {
      if (!this.gateOpen(step2)) return;
      const r = await getBead(this.deps.endpoint.client("snapshot", step2), this.key.city, ref.id);
      if (!this.current(step2)) return;
      this.progress(step2);
      if (!r.ok && isCancelled(r.error)) {
        this.record(`closed:${ref.id}`, r.error);
        this.commit();
        return;
      }
      this.closedQueue = this.closedQueue.filter((c) => c !== ref);
      if (this.settle(r, `closed:${ref.id}`) && r.ok) {
        if (ref.seq === null) this.closed.current(r.value);
        else this.closed.closed(ref.seq, r.value);
        this.syncLookups();
      } else if (!r.ok && r.error.kind === "http" && r.error.status === 404) {
        this.closed.remove(ref.id);
      } else {
        this.incomplete = true;
      }
      this.commit();
    }
  }
  async fetchPeek(step2, id2) {
    const r = await getSession(this.deps.endpoint.client("peek", step2), this.key.city, id2, { peek: true, peek_lines: PEEK_LINES });
    if (!this.current(step2)) return;
    this.progress(step2);
    const ok2 = this.settle(r, `peek:${id2}`);
    const q = this.peeks.get(id2);
    if (!q) return;
    q.due = false;
    if (ok2 && r.ok) {
      q.value = r.value;
      q.fetchedAt = this.deps.clock.now();
      q.error = null;
    } else if (!r.ok) {
      this.failOnDemand(q, r.error);
    }
    this.commit();
  }
  /** A failed on-demand read: kept due on backoff or cancellation, held (until sweep / retry) otherwise. */
  failOnDemand(part, error) {
    if (isCancelled(error)) {
      part.due = true;
      return;
    }
    part.error = error;
    if (backsOff(error)) part.due = true;
    else {
      part.due = false;
      part.held = true;
    }
  }
  /** A session's template from the session list: wake reasons are asked per template, so until it is known there is nothing to ask. */
  templateOf(id2) {
    return this.slots.sessions.value?.items.find((x) => x.id === id2)?.template;
  }
  async fetchWake(step2, id2) {
    const template = this.templateOf(id2);
    if (template === void 0) return;
    const r = await listSessions(this.deps.endpoint.client("peek", step2), this.key.city, { limit: SESSION_PAGE, template, wake_reasons: true });
    if (!this.current(step2)) return;
    this.progress(step2);
    const ok2 = this.settle(r, `wake-reasons:${id2}`);
    const w = this.peeks.get(id2);
    if (!w) return;
    w.wake.due = false;
    if (ok2 && r.ok) {
      const listed = r.value.items.find((x) => x.id === id2);
      w.wake.value = { listed: listed !== void 0, reasons: listed?.wake_reasons ?? [] };
      w.wake.fetchedAt = this.deps.clock.now();
      w.wake.error = null;
    } else if (!r.ok) {
      this.failOnDemand(w.wake, r.error);
    }
    this.commit();
  }
  async fetchSessionPending(step2, id2) {
    const r = await getSessionPending(this.deps.endpoint.client("peek", step2), this.key.city, id2);
    if (!this.current(step2)) return;
    this.progress(step2);
    const ok2 = this.settle(r, `pending:${id2}`);
    const w = this.peeks.get(id2);
    if (!w) return;
    w.pending.due = false;
    if (ok2 && r.ok) {
      w.pending.value = r.value;
      w.pending.fetchedAt = this.deps.clock.now();
      w.pending.error = null;
    } else if (!r.ok) {
      this.failOnDemand(w.pending, r.error);
    }
    this.commit();
  }
  async fetchLookups(step2) {
    const due = [...this.lookups].filter(([, b]) => b.due && !b.held).slice(0, BEAD_FETCHES_PER_STEP);
    for (const [id2] of due) {
      if (!this.gateOpen(step2)) return;
      const r = await getBead(this.deps.endpoint.client("snapshot", step2), this.key.city, id2);
      if (!this.current(step2)) return;
      this.progress(step2);
      const ok2 = this.settle(r, `bead:${id2}`);
      const b = this.lookups.get(id2);
      if (!b) continue;
      b.due = false;
      if (ok2 && r.ok) {
        b.value = r.value;
        b.fetchedAt = this.deps.clock.now();
        b.error = null;
      } else if (!r.ok) {
        this.failOnDemand(b, r.error);
      }
      this.commit();
    }
  }
  /** The request id the city's pending list shows for a session, or null. */
  pendingKey(sessionId) {
    return this.slots.pending.value?.items.find((p) => p.session_id === sessionId)?.request_id ?? null;
  }
  /** The city's pending list changed: refetch the prompt of each watched session whose entry changed. */
  pendingChanged() {
    for (const [id2, w] of this.peeks) {
      const key = this.pendingKey(id2);
      if (key === w.pending.key) continue;
      w.pending.key = key;
      w.pending.due = true;
      w.pending.held = false;
    }
  }
  /** Keeps a lookup for every watched bead and every active bead of a session or agent that the board does not carry, and only those. */
  syncLookups() {
    const onBoard2 = /* @__PURE__ */ new Set();
    for (const list of [this.slots.ready.value, this.slots.inProgress.value, this.seed.value]) {
      for (const b of list?.items ?? []) onBoard2.add(b.id);
    }
    for (const c of this.closed.recent()) onBoard2.add(c.bead.id);
    const wanted = new Set(this.beadWatches.keys());
    for (const x of [...this.slots.sessions.value?.items ?? [], ...this.slots.agents.value?.items ?? []]) {
      if (x.active_bead !== void 0 && x.active_bead !== "" && !onBoard2.has(x.active_bead)) wanted.add(x.active_bead);
    }
    for (const id2 of [...this.lookups.keys()]) if (!wanted.has(id2)) this.lookups.delete(id2);
    for (const id2 of wanted) if (!this.lookups.has(id2)) this.lookups.set(id2, onDemand());
  }
  // ---- snapshot -----------------------------------------------------------------
  slotOf(s, dirty) {
    if (s.value === null && s.fetchedAt === null && s.error === null && dirty && !s.held) return EMPTY_SLOT;
    return { value: s.value, fetchedAt: s.fetchedAt, error: s.error, dirty, held: s.held };
  }
  /** The seed without the beads gc has since said are no longer closed or gone. */
  seedSlot() {
    const v = this.seed.value;
    if (v === null || !v.items.some((b) => this.closed.dropped(b.id))) return this.slotOf(this.seed, this.seed.due);
    return this.slotOf({ ...this.seed, value: { ...v, items: v.items.filter((b) => !this.closed.dropped(b.id)) } }, this.seed.due);
  }
  build(rev) {
    const dirty = (d) => this.due.has(d);
    return {
      rev,
      key: this.key,
      onScreen: this.onScreen,
      connection: this.deps.endpoint.connection(),
      events: { ...this.events },
      rigs: this.slotOf(this.slots.rigs, dirty("rigs")),
      agents: this.slotOf(this.slots.agents, dirty("agents")),
      sessions: this.slotOf(this.slots.sessions, dirty("sessions")),
      pending: this.slotOf(this.slots.pending, dirty("pending")),
      ready: this.slotOf(this.slots.ready, dirty("ready")),
      inProgress: this.slotOf(this.slots.inProgress, dirty("inProgress")),
      closed: { seed: this.seedSlot(), recent: this.closed.recent(), incomplete: this.incomplete, hidden: this.closed.hidden() },
      peeks: new Map([...this.peeks].map(([id2, s]) => [id2, this.slotOf(s, s.due)])),
      details: new Map([...this.peeks].map(([id2, w]) => [id2, { wakeReasons: this.slotOf(w.wake, w.wake.due), pending: this.slotOf(w.pending, w.pending.due) }])),
      beads: new Map([...this.lookups].map(([id2, b]) => [id2, this.slotOf(b, b.due)])),
      errors: this.errors,
      fetchStarts: { ...this.fetchStarts }
    };
  }
  commit() {
    this.snap = this.build(this.snap.rev + 1);
  }
};

// src/vm/region.ts
function ageText(ms) {
  const s = Math.max(0, Math.floor(ms / 1e3));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}
function regionModel(parts) {
  let error = null;
  const note = (name, e) => {
    if (error === null && e !== null) error = `${name}: ${errorText(e)}`;
  };
  let never = false;
  let stale = false;
  let age = 0;
  for (const [name, f] of parts) {
    if (f.kind === "never") {
      never = true;
      note(name, f.error);
      continue;
    }
    age = Math.max(age, f.ageMs);
    if (f.kind === "stale") {
      stale = true;
      note(name, f.error);
    }
  }
  if (never) return error === null ? { kind: "loading", age: null, stale: false, error: null } : { kind: "failed", age: null, stale: true, error };
  return { kind: "ok", age: `data ${ageText(age)} old`, stale, error };
}

// src/vm/status.ts
var LIFECYCLE2 = {
  suspended: "suspended",
  quarantined: "quarantined",
  stopped: "stopped",
  draining: "draining",
  asleep: "asleep",
  creating: "starting",
  closing: "closing",
  archived: "archived"
};
var ACTIVE = "active";
var URGENCY = {
  "needs-you": 0,
  blocked: 1,
  error: 2,
  working: 3,
  done: 4,
  idle: 5,
  unknown: 6,
  lifecycle: 7
};
function status(kind, label2, source, detail = null, unrecognized = null) {
  return { kind, label: cleanLine(label2), source, detail: detail === null ? null : cleanLine(detail), unrecognized: unrecognized === null ? null : cleanLine(unrecognized) };
}
function drift2(value) {
  return isUnrecognized(value) ? value.raw : value;
}
function fromProgram(p) {
  const details = [];
  if (p.progress !== void 0) details.push(`${p.progress}%`);
  if (p.app !== void 0 && p.app !== "") details.push(p.app);
  const detail = details.length > 0 ? details.join(" · ") : null;
  if (isUnrecognized(p.state)) return status("unknown", `unknown (${p.state.raw})`, "program", detail, `program_status.state ${p.state.raw}`);
  const kind = p.kind === void 0 ? null : drift2(p.kind);
  const unrecognized = p.kind !== void 0 && isUnrecognized(p.kind) ? `program_status.kind ${p.kind.raw}` : null;
  const label2 = kind === null ? p.state : `${p.state} (${kind})`;
  return status(p.state, label2, "program", detail, unrecognized);
}
function fromActivity(activity, detail) {
  if (activity === "in-turn") return status("working", "working (transcript)", "transcript", detail);
  if (activity === "idle") return status("idle", "idle (transcript)", "transcript", detail);
  if (activity !== void 0 && activity !== "") return status("unknown", `unknown (${activity})`, "transcript", detail, `activity ${activity}`);
  return status("unknown", "unknown", "none", detail);
}
function liveStatus(x, detail = null) {
  if (x.program_status !== void 0) return fromProgram(x.program_status);
  return fromActivity(x.activity, detail);
}
function sessionStatus(s, pending) {
  if (pending !== null) return status("needs-you", `needs you (${pending.kind})`, "pending");
  if (s.state !== ACTIVE) {
    const known = LIFECYCLE2[s.state];
    return status("lifecycle", known ?? s.state, "lifecycle", s.reason ?? null, known === void 0 ? `state ${s.state}` : null);
  }
  return liveStatus(s);
}
function agentStatus(a) {
  if (a.suspended) return status("lifecycle", "suspended", "lifecycle", a.unavailable_reason ?? null);
  if (!a.running) return status("lifecycle", LIFECYCLE2[a.state] ?? "not running", "lifecycle", a.unavailable_reason ?? null);
  const unavailable = !a.available ? `unavailable${a.unavailable_reason ? `: ${a.unavailable_reason}` : ""}` : null;
  const live = liveStatus(a, unavailable);
  return unavailable !== null && live.detail === null ? { ...live, detail: cleanLine(unavailable) } : live;
}
function urgency(s) {
  return URGENCY[s.kind];
}
function mostUrgent(list) {
  let best = null;
  for (const s of list) if (best === null || urgency(s) < urgency(best)) best = s;
  return best;
}

// src/vm/agents.ts
var CITY_GROUP = "city";
function rigKey(rig) {
  return `rig:${rig}`;
}
function nonEmpty(...values) {
  for (const v of values) if (v !== void 0 && v.trim() !== "") return v;
  return null;
}
function poolText(a) {
  if (a.pool === void 0 || a.pool_limits === void 0) return null;
  const { min, max } = a.pool_limits;
  return `pool ${min}–${max < 0 ? "unlimited" : max}`;
}
function boardTitles(s) {
  const titles = /* @__PURE__ */ new Map();
  for (const list of [s.ready.value, s.inProgress.value, s.closed.seed.value]) for (const b of list?.items ?? []) titles.set(b.id, b.title);
  for (const c of s.closed.recent) titles.set(c.bead.id, c.bead.title);
  return titles;
}
function activeBead(id2, titles, beads) {
  if (id2 === void 0 || id2 === "") return null;
  const clean = cleanLine(id2);
  const onBoard2 = titles.get(id2);
  if (onBoard2 !== void 0) return { id: clean, title: cleanLine(onBoard2), note: null };
  const fetched = beads.get(id2);
  if (fetched?.value) return { id: clean, title: cleanLine(fetched.value.title), note: null };
  if (fetched?.error) return { id: clean, title: null, note: `title unavailable: ${errorText(fetched.error)}` };
  return { id: clean, title: null, note: "loading title" };
}
function unreadableRows(kind, list) {
  return list.map((u) => ({
    kind,
    text: `unreadable ${kind} ${u.id === null ? `(entry ${u.index})` : cleanLine(u.id)}: ${errorText(u.error)}`
  }));
}
function partialBanner(what, partial2, errors) {
  if (!partial2 && errors.length === 0) return [];
  const detail = errors.length > 0 ? errors.map(cleanLine).join("; ") : "gc did not say why";
  return [`gc's ${what} list is partial: ${detail}`];
}
function agentsModel(input) {
  const { snapshot: s, now, selected, collapsed } = input;
  const rigs = s.rigs.value?.items ?? [];
  const agents = s.agents.value?.items ?? [];
  const sessionList = s.sessions.value;
  const titles = boardTitles(s);
  const drift3 = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  for (const p of s.pending.value?.items ?? []) pending.set(p.session_id, { kind: p.kind, requestId: p.request_id });
  const row2 = (x) => {
    const status2 = sessionStatus(x, pending.get(x.id) ?? null);
    if (status2.unrecognized !== null) drift3.add(status2.unrecognized);
    return {
      id: cleanLine(x.id),
      label: cleanLine(nonEmpty(x.alias, x.display_name, x.title, x.session_name) ?? x.id),
      status: status2,
      activeBead: activeBead(x.active_bead, titles, s.beads),
      attached: x.attached,
      transport: x.transport === void 0 ? null : cleanLine(x.transport),
      selected: x.id === selected
    };
  };
  const byName = new Map(agents.map((a) => [a.name, a]));
  const joined = /* @__PURE__ */ new Map();
  const other = [];
  for (const x of sessionList?.items ?? []) {
    const owner = (x.agent_name !== void 0 ? byName.get(x.agent_name) : void 0) ?? byName.get(x.template);
    if (!owner) {
      other.push(row2(x));
      continue;
    }
    const rows = joined.get(owner.name) ?? [];
    rows.push(row2(x));
    joined.set(owner.name, rows);
  }
  const agentRow2 = (a) => {
    const rows = joined.get(a.name) ?? [];
    const own2 = agentStatus(a);
    if (rows.length === 0 && own2.unrecognized !== null) drift3.add(own2.unrecognized);
    return {
      name: cleanLine(a.name),
      ref: a.name,
      suspended: a.suspended,
      label: cleanLine(nonEmpty(a.display_name) ?? a.name),
      pool: poolText(a),
      status: mostUrgent(rows.map((r) => r.status)) ?? own2,
      sessions: rows
    };
  };
  const groups = /* @__PURE__ */ new Map();
  const group = (key, make) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, ...make(), collapsed: collapsed.has(key), agents: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const r of rigs) {
    group(rigKey(r.name), () => ({
      rig: r.name,
      title: `rig: ${cleanLine(r.name)}`,
      counts: `${r.agent_count} agents · ${r.running_count} running`,
      suspended: r.suspended,
      listed: true
    }));
  }
  const unlisted = [...new Set(agents.map((a) => a.rig).filter((r) => r !== void 0 && r !== "" && !groups.has(rigKey(r))))].sort();
  for (const r of unlisted) group(rigKey(r), () => ({ rig: null, title: `rig: ${cleanLine(r)}`, counts: null, suspended: false, listed: false }));
  for (const a of agents) {
    const key = a.rig !== void 0 && a.rig !== "" ? rigKey(a.rig) : CITY_GROUP;
    const g = group(key, () => ({ rig: null, title: "city", counts: null, suspended: false, listed: true }));
    if (!g.collapsed) g.agents.push(agentRow2(a));
  }
  const banners = [];
  if (sessionList?.truncated) {
    banners.push(`showing ${sessionList.items.length + sessionList.unreadable.length} of ${sessionList.total} sessions`);
  }
  banners.push(...partialBanner("rig", s.rigs.value?.partial, s.rigs.value?.partial_errors ?? []));
  banners.push(...partialBanner("agent", s.agents.value?.partial, s.agents.value?.partial_errors ?? []));
  banners.push(...partialBanner("session", sessionList?.partial, sessionList?.partialErrors ?? []));
  banners.push(...partialBanner("pending", s.pending.value?.partial, s.pending.value?.partial_errors ?? []));
  const unreadable2 = [
    ...unreadableRows("rig", s.rigs.value?.unreadable ?? []),
    ...unreadableRows("agent", s.agents.value?.unreadable ?? []),
    ...unreadableRows("session", sessionList?.unreadable ?? []),
    ...unreadableRows("pending", s.pending.value?.unreadable ?? [])
  ];
  const region = regionModel([
    ["sessions", domainFreshness(s, "sessions", now)],
    ["agents", domainFreshness(s, "agents", now)],
    ["rigs", domainFreshness(s, "rigs", now)],
    ["pending", domainFreshness(s, "pending", now)]
  ]);
  return {
    region,
    groups: [...groups.values()],
    other,
    unreadable: unreadable2,
    banners,
    needsYou: pending.size,
    drift: [...drift3]
  };
}

// src/vm/board.ts
var EARLIER_DIVIDER = "earlier (by creation time)";
var INFRASTRUCTURE2 = new Set(INFRASTRUCTURE_BEAD_TYPES);
var STATES = { open: "open", in_progress: "in progress", blocked: "blocked", closed: "closed" };
function beadState(status2, isBlocked) {
  if (isBlocked === true) return { text: "blocked", unrecognized: null };
  const known = STATES[status2];
  if (known !== void 0) return { text: known, unrecognized: null };
  const raw = cleanLine(status2);
  return { text: raw, unrecognized: `bead status ${raw}` };
}
function optional2(v) {
  return v === void 0 || v.trim() === "" ? null : cleanLine(v);
}
function priorityText(p) {
  return p === void 0 ? null : `P${p}`;
}
function isInfrastructure(b) {
  return INFRASTRUCTURE2.has(b.issue_type);
}
function unreadableRows2(list) {
  return list.map((u) => `unreadable bead ${u.id === null ? `(entry ${u.index})` : cleanLine(u.id)}: ${errorText(u.error)}`);
}
function closedFreshness(s, now) {
  return freshness(s.closed.seed, now, { intervalMs: intervalOf("events", s.onScreen) ?? 0, confirmedAt: s.events.error ? null : s.events.polledAt });
}
function boardModel(input) {
  const { snapshot: s, now, selected } = input;
  const drift3 = /* @__PURE__ */ new Set();
  let hidden = s.closed.hidden;
  const card3 = (b) => {
    const state = beadState(b.status, b.is_blocked);
    if (state.unrecognized !== null) drift3.add(state.unrecognized);
    return {
      id: cleanLine(b.id),
      title: cleanLine(b.title),
      state: state.text,
      priority: priorityText(b.priority),
      type: cleanLine(b.issue_type),
      assignee: optional2(b.assignee),
      labels: b.labels.map(cleanLine),
      selected: b.id === selected
    };
  };
  const closedCard = (b) => ({ ...card3(b), closeReason: optional2(b.close_reason) });
  const shown = (items) => {
    const kept = items.filter((b) => !isInfrastructure(b));
    hidden += items.length - kept.length;
    return kept;
  };
  const column2 = (slot, title, name, empty, f) => {
    const region = regionModel([[name, f]]);
    const cards = shown(slot.value?.items ?? []).map(card3);
    const unreadable2 = unreadableRows2(slot.value?.unreadable ?? []);
    const read = slot.value?.items.length ?? 0;
    const rows = read + unreadable2.length;
    return {
      title,
      count: rows >= BOARD_LIMIT ? `${rows}+` : `${cards.length}`,
      region,
      empty: region.kind === "ok" && cards.length === 0 && unreadable2.length === 0 ? empty : null,
      unreadable: unreadable2,
      banners: [],
      cards
    };
  };
  const ready = column2(s.ready, "Ready", "ready", "nothing ready", domainFreshness(s, "ready", now));
  const inProgress = column2(s.inProgress, "In progress", "in progress", "nothing in progress", domainFreshness(s, "inProgress", now));
  const open = /* @__PURE__ */ new Set();
  for (const b of [...s.ready.value?.items ?? [], ...s.inProgress.value?.items ?? []]) open.add(b.id);
  const latest = /* @__PURE__ */ new Map();
  for (const c of s.closed.recent) {
    const cur = latest.get(c.bead.id);
    if (!cur || c.seq > cur.seq) latest.set(c.bead.id, c);
  }
  const recent = shown([...latest.values()].map((c) => ({ ...c.bead, seq: c.seq }))).filter((b) => !open.has(b.id)).sort((a, b) => b.seq - a.seq).slice(0, MAX_CLOSED_RECENT).map((b) => ({ ...closedCard(b), seq: b.seq }));
  const listed = /* @__PURE__ */ new Set([...latest.keys()]);
  const earlier = shown(s.closed.seed.value?.items ?? []).filter((b) => !listed.has(b.id) && !open.has(b.id)).slice(0, MAX_CLOSED_RECENT - recent.length).map(closedCard);
  const closedRegion = regionModel([["closed", closedFreshness(s, now)]]);
  const closedUnreadable = unreadableRows2(s.closed.seed.value?.unreadable ?? []);
  const closed2 = {
    title: "Recently closed",
    count: `${recent.length + earlier.length}`,
    region: closedRegion,
    empty: closedRegion.kind === "ok" && recent.length + earlier.length === 0 && closedUnreadable.length === 0 ? "nothing closed yet" : null,
    unreadable: closedUnreadable,
    banners: s.closed.incomplete ? ["may be incomplete: some closes were not fetched"] : [],
    recent,
    earlier,
    divider: EARLIER_DIVIDER,
    incomplete: s.closed.incomplete
  };
  return {
    filter: `hiding infrastructure beads (${INFRASTRUCTURE_BEAD_TYPES.join(", ")})`,
    hidden,
    ready,
    inProgress,
    closed: closed2,
    unreadable: [...ready.unreadable, ...inProgress.unreadable, ...closed2.unreadable],
    drift: [...drift3]
  };
}
function onBoard(s, id2) {
  for (const list of [s.ready.value, s.inProgress.value]) {
    const hit = list?.items.find((b) => b.id === id2);
    if (hit) return hit;
  }
  let newest;
  for (const c of s.closed.recent) if (c.bead.id === id2 && (!newest || c.seq > newest.seq)) newest = c;
  return newest?.bead ?? s.closed.seed.value?.items.find((b) => b.id === id2);
}
function detailFacts(b, state) {
  const out = [["status", state]];
  const p = priorityText(b.priority);
  if (p !== null) out.push(["priority", p]);
  out.push(["type", b.issue_type]);
  if (b.assignee !== void 0 && b.assignee !== "") out.push(["assignee", b.assignee]);
  if (b.labels.length > 0) out.push(["labels", b.labels.join(", ")]);
  out.push(["created", b.created_at]);
  if (b.updated_at !== void 0) out.push(["updated", b.updated_at]);
  return out.map(([k, v]) => [k, cleanLine(v)]);
}
function beadDetailModel(input) {
  const { snapshot: s, now, selected } = input;
  if (selected === null) return { kind: "none" };
  const id2 = cleanLine(selected);
  const fetched = s.beads.get(selected);
  const card3 = onBoard(s, selected);
  const full = fetched?.value ?? null;
  const source = full ? { ...full, is_blocked: card3?.is_blocked } : card3 ?? null;
  if (source === null) {
    return { kind: "missing", id: id2, text: `bead ${id2}: ${fetched?.error ? errorText(fetched.error) : "loading"}` };
  }
  let description = null;
  let descriptionNote;
  if (full) {
    const text2 = full.description === void 0 ? "" : cleanText(full.description);
    if (text2.trim() === "") descriptionNote = "no description";
    else {
      description = text2;
      descriptionNote = null;
    }
  } else {
    descriptionNote = fetched?.error ? `description unavailable: ${errorText(fetched.error)}` : "loading description";
  }
  const state = beadState(source.status, source.is_blocked).text;
  const f = fetched ? freshness(fetched, now, { intervalMs: intervalOf("events", s.onScreen) ?? 0, confirmedAt: s.events.error ? null : s.events.polledAt }) : { kind: "never", error: null };
  return {
    kind: "bead",
    id: id2,
    ref: selected,
    closed: source.status === "closed",
    title: cleanLine(source.title),
    state,
    facts: detailFacts(source, state),
    closeReason: optional2(source.close_reason),
    description,
    descriptionNote,
    region: regionModel([["bead", f]])
  };
}

// src/terminal/binding.ts
var NO_ATTACH = {
  acp: "this session runs over acp (a protocol, not a terminal): gc cannot attach to it",
  subprocess: "this session runs as a plain subprocess: gc cannot attach to it"
};
function attachRefusal(transport) {
  return transport !== void 0 && Object.hasOwn(NO_ATTACH, transport) ? NO_ATTACH[transport] ?? null : null;
}
function resolveBinding(input) {
  const refused = attachRefusal(input.session.transport);
  if (refused !== null) return err(refused);
  const issue2 = gcBinIssue(input.gcBin) ?? cityPathIssue(input.cityPath) ?? sessionIdIssue(input.session.id);
  if (issue2 !== null) return err(cleanLine(issue2));
  return ok({
    kind: "attach-tab",
    target: { gcBin: input.gcBin, cityPath: input.cityPath, sessionId: input.session.id },
    noStart: supportsNoStart(input.gcVersion)
  });
}

// src/vm/detail.ts
function capabilities(c) {
  const names = [];
  if (c.supports_follow_up) names.push("follow-up");
  if (c.supports_interrupt_now) names.push("interrupt");
  if (c.supports_steer) names.push("steer");
  return names.length > 0 ? names.join(", ") : "none";
}
function facts(x) {
  const out = [
    ["id", x.id],
    ["state", `${x.state}, ${x.running ? "running" : "not running"}`],
    ["provider", x.provider]
  ];
  if (x.transport !== void 0) out.push(["transport", x.transport]);
  out.push(["attached", x.attached ? "yes" : "no"]);
  if (x.active_bead !== void 0 && x.active_bead !== "") out.push(["active bead", x.active_bead]);
  if (x.last_active !== void 0) out.push(["last active", x.last_active]);
  if (x.submission_capabilities !== void 0) out.push(["input", capabilities(x.submission_capabilities)]);
  return out.map(([k, v]) => [k, cleanLine(v)]);
}
function wakeText(s) {
  if (!s || s.value === null) return s?.error ? `unavailable: ${errorText(s.error)}` : "loading";
  if (!s.value.listed) return "gc did not list this session under its template";
  return s.value.reasons.length > 0 ? s.value.reasons.map(cleanLine).join(", ") : "none";
}
function pendingView(s) {
  if (!s || s.value === null) return s?.error ? { kind: "failed", error: errorText(s.error) } : { kind: "loading" };
  if (!s.value.supported) return { kind: "unsupported" };
  const p = s.value.pending;
  if (!p) return { kind: "none" };
  return {
    kind: "prompt",
    requestId: cleanLine(p.request_id),
    promptKind: cleanLine(p.kind),
    prompt: p.prompt === void 0 ? null : cleanText(p.prompt),
    options: p.options.map(cleanLine),
    answer: { requestId: p.request_id, options: [...p.options] }
  };
}
function detailModel(input) {
  const { snapshot: s, now, selected } = input;
  if (selected === null) return { kind: "none" };
  const x = s.sessions.value?.items.find((i) => i.id === selected);
  if (!x) return { kind: "gone", id: cleanLine(selected), text: `session ${cleanLine(selected)} is no longer listed by gc` };
  const p = s.pending.value?.items.find((i) => i.session_id === x.id);
  const peek = s.peeks.get(x.id);
  const peekFreshness = peek ? freshness(peek, now, { intervalMs: CADENCE.peek.onScreenMs, confirmedAt: null }) : { kind: "never", error: null };
  const output = peek?.value ? cleanText(peek.value.last_output ?? "") : null;
  const label2 = x.alias ?? x.display_name ?? (x.title !== "" ? x.title : x.session_name);
  const detail = s.details.get(x.id);
  return {
    kind: "session",
    id: cleanLine(x.id),
    ref: x.id,
    title: cleanLine(`${x.agent_name ?? x.template} / ${label2}`),
    status: sessionStatus(x, p ? { kind: p.kind, requestId: p.request_id } : null),
    facts: facts(x),
    output: { text: output === null ? null : output === "" ? "(no output)" : output, region: regionModel([["output", peekFreshness]]) },
    wakeReasons: wakeText(detail?.wakeReasons),
    pending: pendingView(detail?.pending),
    canInterrupt: x.submission_capabilities?.supports_interrupt_now === true,
    noTerminal: attachRefusal(x.transport)
  };
}

// src/vm/diagnostics.ts
var DIAGNOSTICS_LIMIT = 100;
function syncErrorText(e) {
  switch (e.kind) {
    case "listener-failed":
      return cleanLine(`an app-wide listener failed: ${e.message}`);
    case "step-crashed":
      return cleanLine(`a refresh step crashed: ${e.message}`);
    case "probe-truncated":
      return cleanLine(`the probe document was over ${e.limitBytes} bytes and was cut down: ${e.dropped.join("; ")}`);
    case "discovery-stalled":
      return `discovery made no progress for ${Math.round(e.idleMs / 1e3)} s and was started again`;
    case "tick-crashed":
      return cleanLine(`a periodic update failed: ${e.message}`);
    case "step-stalled":
      return `a refresh step made no progress for ${Math.round(e.idleMs / 1e3)} s and was abandoned`;
    default:
      return errorText(e);
  }
}
function iso(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
function diagnosticsModel(input) {
  const failures = [...input.entries].sort((a, b) => b.at - a.at).slice(0, DIAGNOSTICS_LIMIT).map((e) => ({ at: iso(e.at), source: cleanLine(e.source), text: syncErrorText(e.error) }));
  const unreadable2 = (input.unreadable ?? []).map((u) => ({ at: null, source: "gc", text: cleanLine(u) }));
  const drift3 = input.drift.map((d) => ({ at: null, source: "gc", text: cleanLine(`value this version does not know: ${d}`) }));
  return [...failures, ...unreadable2, ...drift3];
}

// src/vm/header.ts
var SOURCE_LABELS = {
  setting: "apiUrl setting",
  "gc-reported": "gc supervisor status",
  "supervisor-config": "~/.gc/supervisor.toml",
  default: "built-in default"
};
function cityLabel(c) {
  return cleanLine(c.running ? "running" : c.status ?? "stopped");
}
function attemptLine(a) {
  const label2 = SOURCE_LABELS[a.source];
  switch (a.outcome) {
    case "absent":
      return `${label2}: ${a.detail}`;
    case "unavailable":
      return `${label2}: ${errorText(a.error)}`;
    case "refused":
      return `${label2}: ${a.url} refused: ${errorText(a.error)}`;
    case "unreachable":
      return `${label2}: ${a.url} unreachable: ${errorText(a.error)}`;
    case "ok":
      return `${label2}: ${a.url} ok (gc ${a.version})`;
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
function runningChip(notices, live) {
  if (live?.connection.kind === "backing-off") {
    const s = Math.max(0, Math.ceil((live.connection.retryAt - live.now) / 1e3));
    return { tone: "warn", text: `reconnecting in ${s} s (${errorText(live.connection.cause)})` };
  }
  if (notices.some((n) => n.kind === "read-grant-required")) return { tone: "error", text: "read grant required" };
  const readOnly = notices.find((n) => n.kind === "read-only");
  if (readOnly) return { tone: "warn", text: "read-only server" };
  const missing = notices.find((n) => n.kind === "api-missing");
  if (missing) return { tone: "warn", text: `gc too old (needs ${missing.operationId})` };
  if (notices.some((n) => n.kind === "write-grant-required")) return { tone: "warn", text: "connected, read-only" };
  if (live?.connection.kind === "connecting") return { tone: "busy", text: "connecting" };
  return { tone: "ok", text: "connected" };
}
function chipOf(state, live) {
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
      const status2 = state.cause === "api" ? "gc answered: not running" : state.city.status ?? "not running";
      const error = state.city.error ? `: ${state.city.error}` : "";
      return { tone: "warn", text: `city stopped (${status2})${error}` };
    }
    case "city-running":
      return runningChip(state.notices, live);
  }
}
function headerModel(m, hostErrors = [], live = null) {
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
  const diagnostics2 = attempts.map(attemptLine);
  if (state.phase === "no-endpoint" && state.failure.reason === "invalid") {
    diagnostics2.push(`${SOURCE_LABELS[state.failure.source]}: ${errorText(state.failure.error)}`);
  }
  for (const u of cities?.unreadable ?? []) {
    diagnostics2.push(`unreadable city ${u.id ?? "(no name)"} (items[${u.index}]): ${errorText(u.error)}`);
  }
  const offerChoice = copy.pinned === null && cities !== null && (state.phase === "choose-city" || state.phase === "city-unknown" || state.phase === "city-running" || state.phase === "city-stopped");
  const choices = offerChoice ? cities.items.filter((c) => c.name !== cityName).map((c) => ({ name: c.name, label: cityLabel(c) })) : null;
  const running = state.phase === "city-running" ? live : null;
  const chip = chipOf(state, running);
  const needsYou = running && running.needsYou > 0 ? `${running.needsYou} ${running.needsYou === 1 ? "needs" : "need"} you` : null;
  return {
    chip: { tone: chip.tone, text: cleanLine(chip.text) },
    endpoint: endpoint ? cleanLine(`gc ${endpoint.version} at ${endpoint.url} (from ${SOURCE_LABELS[endpoint.source]})`) : null,
    city: cityName === null ? null : cleanLine(copy.pinned !== null ? `${cityName} (pinned)` : cityName),
    others: (cities?.items ?? []).filter((c) => c.name !== cityName).map((c) => ({ name: cleanLine(c.name), running: c.running, label: cityLabel(c) })),
    banners: banners.map(cleanLine),
    choices,
    canRetry: state.phase !== "discovering" && state.phase !== "listing",
    diagnostics: diagnostics2.map(cleanLine),
    needsYou,
    age: running ? running.age : null
  };
}

// src/vm/probe.ts
var PROBE_SCHEMA = "gascity-herdr-probe/4";
function probeSession(r, agent, group) {
  return {
    id: r.id,
    label: r.label,
    agent,
    group,
    status: r.status.label,
    status_kind: r.status.kind,
    status_source: r.status.source,
    attached: r.attached,
    active_bead: r.activeBead?.id ?? null
  };
}
function sessionsOf(agents) {
  if (agents === null) return [];
  const out = [];
  for (const g of agents.groups) for (const a of g.agents) for (const r of a.sessions) out.push(probeSession(r, a.name, g.key));
  for (const r of agents.other) out.push(probeSession(r, null, null));
  return out;
}
var card = (c) => ({ id: c.id, title: c.title, state: c.state, priority: c.priority, assignee: c.assignee });
var closed = (c) => ({ id: c.id, title: c.title, close_reason: c.closeReason, assignee: c.assignee });
function probeBoard(b) {
  if (b === null) return null;
  return {
    filter: b.filter,
    hidden: b.hidden,
    ready: { count: b.ready.count, cards: b.ready.cards.map(card) },
    in_progress: { count: b.inProgress.count, cards: b.inProgress.cards.map(card) },
    closed: {
      incomplete: b.closed.incomplete,
      recent: b.closed.recent.map((c) => ({ id: c.id, title: c.title, seq: c.seq, close_reason: c.closeReason, assignee: c.assignee })),
      earlier: b.closed.earlier.map(closed)
    },
    errors: [b.ready.region.error, b.inProgress.region.error, b.closed.region.error].filter((e) => e !== null)
  };
}
function probeBeadDetail(d) {
  if (d.kind !== "bead") return null;
  return { id: d.id, title: d.title, state: d.state, close_reason: d.closeReason, description: d.description };
}
function probeDocument(input) {
  const { machine, header, detail } = input;
  const state = machine.state;
  const endpoint = "endpoint" in state ? state.endpoint : null;
  return {
    schema: PROBE_SCHEMA,
    mod_version: input.modVersion,
    herdr_version: input.herdrVersion,
    connection: { text: header.chip.text, tone: header.chip.tone },
    discovery: endpoint ? { source: endpoint.source, url: endpoint.url, version: cleanLine(endpoint.version) } : null,
    city: state.phase === "city-running" || state.phase === "city-stopped" ? cleanLine(state.city.name) : null,
    city_phase: state.phase,
    visibility: { on_screen: input.onScreen },
    keyboard: input.keyboard,
    needs_you: input.agents?.needsYou ?? 0,
    data_age: input.agents?.region.age ?? null,
    sessions: sessionsOf(input.agents),
    board: probeBoard(input.board),
    bead_detail: probeBeadDetail(input.beadDetail),
    detail: detail.kind !== "session" ? null : {
      session: detail.id,
      status: detail.status.label,
      output: detail.output.text,
      wake_reasons: detail.wakeReasons,
      // The cleaned prompt the pane shows; the raw answer values stay out of the file.
      pending: detail.pending.kind === "prompt" ? { kind: "prompt", requestId: detail.pending.requestId, promptKind: detail.pending.promptKind, prompt: detail.pending.prompt, options: detail.pending.options } : detail.pending
    },
    actions: (input.activity?.rows ?? []).map((r) => ({
      id: r.id,
      action: r.kind,
      title: r.title,
      state: r.tone,
      detail: r.detail,
      request_id: r.requestId,
      attempt: r.attempt
    })),
    exec_log: input.execLog.map((e) => ({ at: e.at, kind: e.kind, argv: [...e.argv] })),
    errors: [...input.diagnostics],
    refresh_count: input.refreshCount,
    fetch_in_flight_max: input.fetchInFlightMax,
    window: input.window,
    notice: input.notice,
    commands: input.commands.map((c) => ({ ...c }))
  };
}

// src/terminal/attach.ts
var WAKE_POLL_DELAYS_MS = [500, 1e3];
var WAKE_POLL_EVERY_MS = 2e3;
var WAKE_DEADLINE_MS = 6e4;
var CONFIRM_WITHIN_MS = 5e3;
var EXIT_WATCH_MS = 1e4;
var CONFIRM_POLL_MS = 250;
var LIFECYCLE3 = ["sessions", "agents"];
function localSpace(spaces2) {
  const active = spaces2.find((s) => s.active);
  if (active && active.machine === null) return active;
  return spaces2.find((s) => s.machine === null) ?? null;
}
function localTerminals(scene) {
  const tabs = new Set(scene.spaces.filter((s) => s.machine === null).flatMap((s) => s.tabs.map((t) => t.id)));
  const out = [];
  for (const terminal of scene.terminals) {
    const pane = scene.panes.find((p) => p.terminal === terminal.address && tabs.has(p.tab));
    if (pane) out.push({ terminal, tab: pane.tab });
  }
  return out;
}
function runsProgram(t) {
  return t.state === "live" && !t.program.shell;
}
function notStarted(sessionId, reason, detail) {
  return { kind: "failed", error: { kind: "attach-not-started", sessionId, reason, detail } };
}
function stateText(s) {
  return s.reason !== void 0 && s.reason !== "" ? `${s.state} (${s.reason})` : s.state;
}
function openTerminal(binding, name, deps) {
  const { target, noStart } = binding;
  const id2 = target.sessionId;
  const { host, clock } = deps;
  const failed = (error) => ({ kind: "failed", error });
  const exited = notStarted(id2, "attach-exited", "attach failed: see the tab for gc's reason (the tab stays open as a shell)");
  const openOrSelect = () => {
    const scene = host.scene();
    if (!scene.ok) return failed(scene.error);
    const local = localTerminals(scene.value);
    const running = local.find((x) => runsProgram(x.terminal) && isAttachOf(x.terminal.argv, target));
    if (running) {
      const selected = host.selectTab(running.tab);
      if (!selected.ok) return failed(selected.error);
      return { kind: "done", detail: `already open: showed its tab (terminal ${running.terminal.address})` };
    }
    const space = localSpace(scene.value.spaces);
    if (space === null) return notStarted(id2, "no-local-space", "no local space: open one (space.new)");
    const before = new Set(scene.value.terminals.filter((t) => isAttachOf(t.argv, target)).map((t) => t.address));
    const opened = host.openTab({ space: space.id, name, argv: attachArgv(target, noStart) });
    if (!opened.ok) return failed(opened.error);
    return confirm(clock.now(), before, null);
  };
  const confirm = (openedAt, before, seen) => ({
    detail: seen === null ? "tab opened: waiting for herdr to list its terminal" : `tab opened: checking the attach keeps running (terminal ${seen})`,
    nextAt: clock.now() + CONFIRM_POLL_MS,
    deadline: openedAt + (seen === null ? CONFIRM_WITHIN_MS : EXIT_WATCH_MS),
    expired: seen === null ? notStarted(id2, "not-seen-in-terminals", `herdr listed no new terminal running the attach within ${CONFIRM_WITHIN_MS / 1e3} s of tab.new`) : { kind: "done", detail: `opened in a new tab (terminal ${seen})` },
    abandoned: { kind: "done", detail: "tab opened; not confirmed: the Gas City view that asked closed" },
    step: () => Promise.resolve(confirmStep(openedAt, before, seen))
  });
  const confirmStep = (openedAt, before, seen) => {
    const scene = host.scene();
    if (!scene.ok) return failed(scene.error);
    const now = clock.now();
    if (seen === null) {
      const mine = localTerminals(scene.value).find((x) => !before.has(x.terminal.address) && isAttachOf(x.terminal.argv, target));
      if (!mine) return confirm(openedAt, before, null);
      if (!runsProgram(mine.terminal)) return exited;
      return now - openedAt >= EXIT_WATCH_MS ? { kind: "done", detail: `opened in a new tab (terminal ${mine.terminal.address})` } : confirm(openedAt, before, mine.terminal.address);
    }
    const t = scene.value.terminals.find((x) => x.address === seen);
    if (!t) return { kind: "done", detail: `opened in a new tab (terminal ${seen}); the tab has since closed` };
    if (!runsProgram(t)) return exited;
    return now - openedAt >= EXIT_WATCH_MS ? { kind: "done", detail: `opened in a new tab (terminal ${seen})` } : confirm(openedAt, before, seen);
  };
  const waitRunning = (wokeAt, polls, last) => ({
    detail: `woken: waiting for gc to report session ${id2} running`,
    nextAt: clock.now() + (WAKE_POLL_DELAYS_MS[polls] ?? WAKE_POLL_EVERY_MS),
    deadline: wokeAt + WAKE_DEADLINE_MS,
    expired: notStarted(id2, "not-running-after-wake", last.ok ? `gc did not report the session running within ${WAKE_DEADLINE_MS / 1e3} s of the wake; it is ${stateText(last.value)}` : `gc did not report the session running within ${WAKE_DEADLINE_MS / 1e3} s of the wake; last read failed: ${errorText(last.error)}`),
    abandoned: {
      kind: "not-sent",
      reason: "no tab was opened: the Gas City view that asked closed before gc reported the session running (gc was asked to wake it)"
    },
    step: async (c, city) => {
      const r = await getSession(c, city, id2);
      if (r.ok && r.value.running) return openOrSelect();
      return waitRunning(wokeAt, polls + 1, r);
    }
  });
  const toSent = (next) => {
    if ("step" in next) return ok({ kind: "watch", watch: next });
    if (next.kind === "failed") return err(next.error);
    if (next.kind === "done") return ok({ kind: "done", detail: next.detail });
    return err({ kind: "host-call", api: "open terminal", cause: next.reason });
  };
  const send = async (c, city, key) => {
    const s = await getSession(c, city, id2);
    if (!s.ok) return s;
    if (s.value.running) return toSent(openOrSelect());
    const woke = await wakeSession(c, city, id2, key);
    if (!woke.ok) {
      if (woke.error.kind === "outcome-unknown") return woke;
      return err({ kind: "attach-not-started", sessionId: id2, reason: "wake-refused", detail: errorText(woke.error) });
    }
    return ok({ kind: "watch", watch: waitRunning(clock.now(), 0, s) });
  };
  const wake = "post-v0-city-by-city-name-session-by-id-wake";
  return {
    kind: "session.attach",
    verb: "Open terminal",
    target: { kind: "session", id: id2 },
    operationId: wake,
    idempotent: OPERATIONS[wake].idempotencyKey,
    confirm: null,
    refresh: LIFECYCLE3,
    send
  };
}

// src/copy.ts
var FOCUS_WAIT_MS = 6e4;
var CITY_SCOPED = /* @__PURE__ */ new Set(["city-not-running", "write-grant-required", "read-grant-required", "read-only", "api-missing"]);
function isCityScoped(e) {
  return e !== null && CITY_SCOPED.has(e.kind);
}
var REDISCOVER_BASE_MS = 5e3;
var REDISCOVER_CAP_MS = 6e4;
var DISCOVERY_STALL_MS = 9e4;
function rediscoverDelay(attempt) {
  return Math.min(REDISCOVER_CAP_MS, REDISCOVER_BASE_MS * 2 ** Math.min(Math.max(attempt, 1) - 1, 16));
}
var HOST_ERROR_LIMIT = 20;
var COPY_ERROR_LIMIT = 20;
function messageOf5(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
var CopyController = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  selected = null;
  selectedBead = null;
  collapsed = /* @__PURE__ */ new Set();
  diagnosticsOpen = false;
  refreshCount = 0;
  onScreen = true;
  cities = null;
  citiesRev = -1;
  city = null;
  /** The city the last subscription was to: a bead selected there means nothing in another city. */
  lastCity = null;
  peek = null;
  beadWatch = null;
  signature = "";
  closed = false;
  /** Asking before sending one of `specs`; `pick` asks one question for all of them. */
  confirming = null;
  creating = null;
  /** The new-bead form: the agents listed when it opened (gc's names), and the chosen one's index. */
  beadForm = null;
  /** The close-bead form, for this bead (gc's id). */
  closingBead = null;
  notice = null;
  /** City-scoped errors already fed to the machine (each failure is a new object). */
  applied = /* @__PURE__ */ new WeakSet();
  /** Failures of this copy's own work, oldest first (diagnostics). */
  failures = [];
  /** The next rediscovery while this copy has no endpoint, and how many there were. */
  rediscovery = null;
  /** The discovery's progress count when it last moved, and when (stall detection). */
  discoveryProgress = { count: 0, at: 0 };
  /** A session to show once its city is subscribed and lists it (focus command, or the window's target). */
  focusing = null;
  /** The seq of the last shared focus target the window applied. */
  focusApplied = 0;
  focusShown = null;
  /** A newer shared target the window holds back while a text box holds a draft. */
  focusNext = null;
  gascityTabs = [];
  /** The Idempotency-Key a command's nonce gives the action it sends (only while that command runs). */
  commandKey = null;
  ownBook = null;
  /** Discovers gc's API and the cities; run it in a task of this copy (init). */
  discover(task) {
    this.discoveryProgress = { count: this.deps.discovery.progress, at: this.deps.clock.now() };
    return this.deps.discovery.run(task);
  }
  /**
   * This copy's periodic timer (every TICK_MS) and nothing else calls this:
   * subscribes and unsubscribes as the machine says, ticks the shared city
   * list and city store, and writes the probe. Returns true when the view
   * should be redrawn. An exception inside is recorded in the diagnostics
   * (and the view redrawn to show it); the next tick starts over. `spawn`
   * starts a task of this copy for a rediscovery (no endpoint, or a stalled run).
   */
  tick(spawn = null) {
    if (this.closed) return false;
    try {
      return this.step(spawn);
    } catch (cause) {
      this.recordFailure("tick", { kind: "tick-crashed", message: messageOf5(cause) });
      return true;
    }
  }
  step(spawn) {
    const { registry: registry3, discovery, clock } = this.deps;
    this.readVisibility();
    registry3.setOnScreen(this.onScreen);
    registry3.reclaim();
    if (spawn !== null) this.followDiscovery(clock.now(), spawn);
    const before = discovery.machine.state;
    this.followCities("endpoint" in before ? before.endpoint.url : null, before.phase !== "city-running");
    const state = discovery.machine.state;
    const endpoint = "endpoint" in state ? state.endpoint : null;
    const running = state.phase === "city-running" && endpoint !== null ? state.city.name : null;
    this.followCity(endpoint !== null && running !== null ? { apiUrl: endpoint.url, city: running } : null);
    this.followFocus();
    this.followDetail();
    this.followBead();
    const s = this.city?.snapshot();
    if (s && running !== null) {
      for (const slot of [s.rigs, s.agents, s.sessions, s.pending, s.events]) {
        const error = slot.error;
        if (!isCityScoped(error) || this.applied.has(error)) continue;
        this.applied.add(error);
        discovery.apply({ type: "city-error", city: running, error });
      }
      if (discovery.machine.state.phase !== "city-running") this.followCity(null);
    }
    if (this.deps.host.probeEnabled()) this.writeProbe(clock.now());
    else this.deps.probe.off(clock.now());
    const signature = [
      this.machineVersion(),
      this.citiesRev,
      this.city?.snapshot().rev ?? -1,
      this.city?.activity().rev ?? -1,
      this.onScreen,
      this.selected,
      this.selectedBead,
      this.notice ?? "",
      this.gascityTabs.join(","),
      this.focusShown?.session ?? "",
      this.focusNext?.session ?? ""
    ].join("|");
    if (signature === this.signature) return false;
    this.signature = signature;
    return true;
  }
  /** The copy closes: unsubscribe everything. Starts nothing. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.deps.discovery.cancel();
    this.peek?.release();
    this.peek = null;
    this.beadWatch?.release();
    this.beadWatch = null;
    this.city?.unsubscribe();
    this.city = null;
    this.cities?.unsubscribe();
    this.cities = null;
    this.deps.probe.release(this);
  }
  /** The view-models for render (and the probe). */
  view(now) {
    const { discovery } = this.deps;
    const s = this.city?.snapshot() ?? null;
    const agents = s ? agentsModel({ snapshot: s, now, selected: this.selected, collapsed: this.collapsed }) : null;
    const board = s ? boardModel({ snapshot: s, now, selected: this.selectedBead }) : null;
    const live = s && agents ? { connection: s.connection, now, needsYou: agents.needsYou, age: agents.region.age } : null;
    const citiesError = this.cities?.snapshot().error;
    return {
      header: headerModel(discovery.machine, discovery.hostErrors, live),
      agents,
      board,
      beadDetail: s ? beadDetailModel({ snapshot: s, now, selected: this.selectedBead }) : { kind: "none" },
      detail: s ? detailModel({ snapshot: s, now, selected: this.selected }) : { kind: "none" },
      activity: this.city ? activityModel(this.city.activity(), s, now) : null,
      dialog: this.dialog(),
      notice: this.notice,
      diagnostics: diagnosticsModel({
        entries: [
          ...s?.errors ?? [],
          ...citiesError ? [{ at: this.cities?.snapshot().fetchedAt ?? now, source: "cities", error: citiesError }] : [],
          ...this.deps.probe.errors(),
          ...this.failures
        ],
        drift: [...agents?.drift ?? [], ...board?.drift ?? []],
        unreadable: [...agents?.unreadable.map((u) => u.text) ?? [], ...board?.unreadable ?? []]
      }),
      diagnosticsOpen: this.diagnosticsOpen,
      refreshCount: this.refreshCount,
      onScreen: this.onScreen,
      window: this.deps.window ? this.windowModel() : null,
      commands: this.commands().entries()
    };
  }
  // ---- actions (buttons; later also keys and commands) -------------------------
  /**
   * "Retry now". With a running city: refetch everything now, including held
   * data, a backing-off endpoint's probe and the open detail, keeping what is
   * shown meanwhile. Without one: rediscover gc's API and the cities.
   */
  retry(task) {
    this.refreshCount++;
    this.rediscovery = null;
    this.cities?.refresh();
    if (this.city) {
      this.city.retryNow();
      this.city.refresh(ALL_DOMAINS);
      if (this.selected !== null) this.city.refreshDetail(this.selected);
      return Promise.resolve();
    }
    return this.discover(task);
  }
  /** The person chose a city (unpinned copies). */
  selectCity(city) {
    this.deps.discovery.select(city);
  }
  /** Opens (or, with null, closes) the detail of a session. */
  selectSession(id2) {
    this.selected = id2;
    this.followDetail();
  }
  /** Opens (or, with null, closes) the detail of a bead on the board. */
  selectBead(id2) {
    this.selectedBead = id2;
    this.followBead();
  }
  /** Collapses or expands a rig group. */
  toggleGroup(key) {
    if (!this.collapsed.delete(key)) this.collapsed.add(key);
  }
  toggleDiagnostics() {
    this.diagnosticsOpen = !this.diagnosticsOpen;
  }
  /**
   * The person asks for an action. A destructive one asks first; one already
   * under way is not sent again; otherwise it is sent now, in this copy's turn.
   */
  request(spec2) {
    if (spec2.confirm !== null) {
      this.ask({ specs: [spec2], retryOf: null, pick: null });
      return;
    }
    this.send(spec2);
  }
  /** Kill asks first, offering a plain and a forced kill. */
  requestKill(sessionId) {
    this.ask({ specs: [sessionKill(sessionId, false), sessionKill(sessionId, true)], retryOf: null, pick: null });
  }
  /** The person confirmed the dialog with its `choice`-th action. */
  confirm(choice) {
    const c = this.confirming;
    const spec2 = c?.specs[choice];
    this.confirming = null;
    if (!c || !spec2) return;
    if (c.retryOf !== null) this.retryNow(c.retryOf);
    else this.send(spec2);
  }
  /** Closes the dialog without acting. */
  cancelDialog() {
    this.clearDialogs();
  }
  /** Retries an action from the activity log (a destructive one asks again). */
  retryAction(id2) {
    const entry = this.city?.activity().entries.find((e) => e.id === id2);
    if (!entry) return;
    if (entry.spec.confirm !== null) {
      this.ask({ specs: [entry.spec], retryOf: id2, pick: null });
      return;
    }
    this.retryNow(id2);
  }
  /** Refetches what an action changed, so its state can be checked before a retry. */
  refreshAction(id2) {
    this.city?.refreshAction(id2);
  }
  /**
   * Sends text to a session gc lists: the send box (its Send buttons name
   * the session whose detail drew them, Enter the open session) and the
   * submit/interrupt/message commands. A draft typed for another session
   * (`typedFor`) is refused, never redirected. Returns whether it was sent
   * (the caller then clears its input).
   */
  sendInputTo(id2, text2, mode, typedFor = null) {
    if (id2 === null) return this.refuse("open a session first");
    if (typedFor !== null && typedFor !== id2) {
      return this.refuse(`this text was typed for session ${cleanLine(typedFor)}: open that session to send it, or clear the box`);
    }
    if (!this.listed(id2)) return this.refuse(`session ${cleanLine(id2)} is not listed by gc`);
    if (text2.trim() === "") return this.refuse("type a message first");
    const spec2 = mode === "message" ? sessionMessage(id2, text2) : sessionSubmit(id2, text2, mode);
    return this.send(spec2);
  }
  /**
   * Answers the open session's pending prompt `requestId` with `option`, both
   * exactly as the button showing them was drawn. If gc's current prompt is a
   * different one (or no longer lists that option), nothing is sent: the
   * person must see the prompt they answer.
   */
  answer(requestId, option) {
    this.answerFor(this.selectedRef(), requestId, option);
  }
  /** Answers session `id`'s pending prompt as its detail shows it (the answer buttons and the answer command). */
  answerFor(id2, requestId, option) {
    const s = this.city?.snapshot();
    const d = s && id2 !== null ? s.details.get(id2)?.pending.value?.pending : void 0;
    if (!d || id2 === null) {
      this.refuse("that prompt is no longer pending");
      return;
    }
    if (d.request_id !== requestId || !d.options.includes(option)) {
      this.refuse("the prompt changed: review it before answering");
      return;
    }
    this.send(sessionRespond(id2, requestId, option));
  }
  /** Opens the new-session form for an agent (gc's qualified name). */
  openNewSession(agent) {
    this.clearDialogs();
    this.creating = { agent };
  }
  /**
   * Sling… on the open bead: asks which of the city's agents to route it to,
   * saying that gc cannot deduplicate a sling. Picking one (confirm) sends it.
   */
  requestSling() {
    this.requestSlingFor(this.selectedBead);
  }
  /** Sling… on bead `bead` (the open bead's button, and the sling command). */
  requestSlingFor(bead) {
    const id2 = this.beadRef(bead);
    if (id2 === null) return;
    const agents = this.agentNames();
    if (agents.length === 0) {
      this.refuse("the agent list has not loaded yet");
      return;
    }
    this.ask({
      specs: agents.map((a) => beadSling(id2, a)),
      retryOf: null,
      pick: {
        question: `Sling bead ${id2} to which agent?`,
        detail: `gc routes the bead to the agent you pick (and applies the agent's default formula, if it has one). ${SLING_MAY_ROUTE_TWICE}`,
        labels: agents
      }
    });
  }
  /** Close… on the open bead: opens the close form (a reason, then Close). */
  requestCloseBead() {
    this.requestCloseBeadFor(this.selectedBead);
  }
  /** Close… on bead `bead`: opens the close form (the open bead's button, and the bead-close command). */
  requestCloseBeadFor(bead) {
    const id2 = this.beadRef(bead);
    if (id2 === null) return;
    this.clearDialogs();
    this.closingBead = { id: id2 };
  }
  /** Closes the bead of the close form with `reason` (blank: none). Returns whether it was sent. */
  closeBead(reason) {
    const c = this.closingBead;
    if (!c) return false;
    this.closingBead = null;
    return this.send(beadClose(c.id, reason));
  }
  /** Reopens the open bead. */
  reopenBead() {
    this.reopenBeadFor(this.selectedBead);
  }
  /** Reopens bead `bead` (the open bead's button, and the bead-reopen command). */
  reopenBeadFor(bead) {
    const id2 = this.beadRef(bead);
    if (id2 !== null) this.send(beadReopen(id2));
  }
  /** Opens the new-bead form, with the city's agents to sling it to. */
  openNewBead() {
    this.clearDialogs();
    this.beadForm = { agents: this.agentNames(), slingTo: null };
  }
  /** Chooses the form's sling target by its place in the form's agent list; null: create only. */
  chooseSlingTarget(index) {
    const f = this.beadForm;
    if (!f) return;
    f.slingTo = index !== null && index >= 0 && index < f.agents.length ? index : null;
  }
  /**
   * Creates a bead from the form (and slings it to the chosen agent once gc
   * created it). Refuses a blank title or a priority that is not a whole
   * number, keeping the form open. Returns whether it was sent.
   */
  createBead(form) {
    const f = this.beadForm;
    if (!f) return false;
    const title = form.title.trim();
    if (title === "") return this.refuse("a new bead needs a title");
    const p = form.priority.trim();
    if (p !== "" && !/^\d+$/.test(p)) return this.refuse("priority must be a whole number, like 2 (or blank)");
    const labels = form.labels.split(",").map((l) => l.trim()).filter((l) => l !== "");
    const slingTo = f.slingTo === null ? null : f.agents[f.slingTo] ?? null;
    this.beadForm = null;
    return this.send(beadCreate({ title, description: form.description, priority: p === "" ? null : Number(p), labels }, slingTo));
  }
  /** Starts a session of the form's agent; `alias` may be empty. Returns whether it was sent. */
  createSession(alias) {
    const c = this.creating;
    if (!c) return false;
    this.creating = null;
    return this.send(sessionNew(c.agent, alias.trim() === "" ? null : alias.trim()));
  }
  /**
   * Opens session `id`'s terminal (the Open terminal button, the t key and
   * the attach command): refused unless gc lists the session in the running
   * city this copy shows and its transport has a terminal to attach to.
   * Returns whether it was sent.
   */
  openTerminal(id2) {
    if (id2 === null) return this.refuse("open a session first");
    const state = this.deps.discovery.machine.state;
    const session = this.city?.snapshot().sessions.value?.items.find((x) => x.id === id2);
    if (state.phase !== "city-running" || !this.city || this.city.key.city !== state.city.name) return this.refuse("no running city to act on");
    if (!session) return this.refuse(`session ${cleanLine(id2)} is not listed by gc`);
    const binding = resolveBinding({ session, cityPath: state.city.path, gcBin: state.endpoint.gcBin, gcVersion: state.endpoint.version });
    if (!binding.ok) return this.refuse(binding.error);
    const name = `${session.agent_name ?? session.template}/${session.id}`;
    return this.send(openTerminal(binding.value, name, { host: this.deps.host.terminal, clock: this.deps.clock }));
  }
  // ---- keys ---------------------------------------------------------------------------
  /** A key of the focused copy (keys.ts): the same methods as the buttons. Returns whether it did something. */
  key(action, ui) {
    switch (action) {
      case "next-session":
      case "prev-session": {
        const next = moveIn(this.sessionOrder(), this.selected, action === "next-session" ? 1 : -1);
        if (next === null) return false;
        this.selectSession(next);
        return true;
      }
      case "refresh":
        ui.retry();
        return true;
      case "open-terminal":
        if (this.selected === null) return false;
        this.openTerminal(this.selected);
        return true;
      case "back":
        if (this.dialog() !== null) this.cancelDialog();
        else if (this.selected !== null) this.selectSession(null);
        else return false;
        return true;
    }
  }
  // ---- commands -----------------------------------------------------------------------
  /**
   * Runs one command herdr delivered (commands.ts), in this copy's turn,
   * through the methods the buttons call. herdr delivers it to every shown
   * copy: one that changes gc state runs only in a copy showing the city it
   * names, and only once per app (commandBook.ts). A command the grammar or
   * the copy refuses changes nothing and says why in the notice. Every
   * outcome goes to the app's command log.
   */
  runCommand(raw, ui) {
    const now = this.deps.clock.now();
    const parsed = parseCommand(raw);
    this.notice = null;
    const hadDialog = this.dialog() !== null;
    const entry = (result, detail) => ({ at: now, command: shownCommand(raw), copy: this.copyName(), result, detail: cleanLine(detail) });
    let record2;
    if (!parsed.ok) {
      record2 = entry("refused", parsed.error);
    } else {
      const { command: c, nonce } = parsed.value;
      const shows = this.city?.key.city ?? null;
      if (isMutating(c) && shows !== c.city) {
        record2 = entry("skipped", `it names city ${c.city}; this copy shows ${shows ?? "no running city"}`);
      } else if (isMutating(c) && !this.commands().claim(raw, nonce !== null, now)) {
        record2 = entry("duplicate", "another copy ran this delivery");
      } else {
        let done = "";
        this.commandKey = nonce;
        try {
          done = this.perform(c, ui);
        } catch (cause) {
          this.refuse(`the command failed: ${messageOf5(cause)}`);
          this.recordFailure("command", { kind: "listener-failed", message: messageOf5(cause) });
        } finally {
          this.commandKey = null;
        }
        if (this.notice !== null && !hadDialog) this.clearDialogs();
        if (this.notice !== null) {
          record2 = entry("refused", this.notice);
          if (isMutating(c)) this.commands().release(raw);
        } else record2 = entry(done === "asked" ? "asked" : "done", done === "asked" ? "asked first: add :confirm to answer" : done);
      }
    }
    if (record2.result === "refused") this.notice = cleanLine(`gascity.${record2.command}: refused: ${record2.detail}`);
    this.commands().record(record2);
    return record2;
  }
  commands() {
    this.ownBook ??= this.deps.commands ?? new CommandBook();
    return this.ownBook;
  }
  /** This copy, as the command log names it. */
  copyName() {
    if (this.deps.window) return "window";
    const pinned = this.deps.discovery.machine.copy.pinned;
    return pinned === null ? "panel" : `panel ${cleanLine(pinned)}`;
  }
  /** Does what a parsed command says; "asked" when it only opened its button's question. Refusals set the notice. */
  perform(c, ui) {
    switch (c.verb) {
      case "focus":
        if (!ui.focusKeyboard()) this.refuse("this herdr-app gives the mod no focus handle");
        return "focused";
      case "focus-session":
        this.focusSession(c.city, c.session);
        return "focusing";
      case "city": {
        const pinned = this.deps.discovery.machine.copy.pinned;
        if (pinned !== null) this.refuse(`this copy shows city ${cleanLine(pinned)} only`);
        else if (this.checkCity(c.city)) this.selectCity(c.city);
        return "selected";
      }
      case "session": {
        const id2 = this.resolveSession(c.session);
        if (id2 !== null) this.selectSession(id2);
        return "opened";
      }
      case "bead":
        this.selectBead(c.bead);
        return "opened";
      case "refresh":
        ui.retry();
        return "refreshing";
      case "probe":
        this.deps.host.setProbe(c.on);
        return c.on ? "probe on" : "probe off";
      case "cancel":
        this.cancelDialog();
        return "cancelled";
      case "session-new":
        if (!this.checkAgent(c.agent)) return "";
        this.openNewSession(c.agent);
        this.createSession(c.alias ?? "");
        return "sent";
      case "wake":
      case "suspend":
      case "stop":
      case "pin":
      case "unpin": {
        const id2 = this.resolveSession(c.session);
        if (id2 !== null) this.request(SESSION_SPECS[c.verb](id2));
        return "sent";
      }
      case "close":
      case "kill":
      case "kill-force": {
        const id2 = this.resolveSession(c.session);
        if (id2 === null) return "";
        if (c.verb === "close") this.request(sessionClose(id2));
        else this.requestKill(id2);
        return this.answerAsked(c.confirm, c.verb === "kill-force" ? 1 : 0);
      }
      case "submit":
      case "interrupt":
      case "message": {
        const id2 = this.resolveSession(c.session);
        if (id2 !== null) this.sendInputTo(id2, c.text, c.verb === "submit" ? "default" : c.verb === "interrupt" ? "interrupt_now" : "message");
        return "sent";
      }
      case "answer": {
        const id2 = this.resolveSession(c.session);
        if (id2 !== null) this.answerFor(id2, c.requestId, c.option);
        return "sent";
      }
      case "attach": {
        const id2 = this.resolveSession(c.session);
        if (id2 !== null) this.openTerminal(id2);
        return "sent";
      }
      case "agent-suspend":
        if (!this.checkAgent(c.name)) return "";
        this.request(agentSuspend(c.name));
        return this.answerAsked(c.confirm, 0);
      case "agent-resume":
        if (this.checkAgent(c.name)) this.request(agentResume(c.name));
        return "sent";
      case "rig-suspend":
        if (!this.checkRig(c.name)) return "";
        this.request(rigSuspend(c.name));
        return this.answerAsked(c.confirm, 0);
      case "rig-resume":
        if (this.checkRig(c.name)) this.request(rigResume(c.name));
        return "sent";
      case "bead-new": {
        this.openNewBead();
        if (c.slingTo !== null) {
          const index = this.beadForm?.agents.indexOf(c.slingTo) ?? -1;
          if (index < 0) {
            this.cancelDialog();
            this.refuse(this.agentNames().length === 0 ? "the agent list has not loaded yet" : `no agent ${cleanLine(c.slingTo)} in this city`);
            return "";
          }
          this.chooseSlingTarget(index);
          if (!c.confirm) {
            ui.beadTitle(c.title);
            return "asked";
          }
        }
        this.createBead({ title: c.title, description: "", priority: "", labels: "" });
        return "sent";
      }
      case "sling": {
        if (!this.checkAgent(c.agent)) return "";
        this.requestSlingFor(c.bead);
        if (this.confirming === null) return "";
        return this.answerAsked(c.confirm, this.agentNames().indexOf(c.agent));
      }
      case "bead-close":
        this.requestCloseBeadFor(c.bead);
        if (this.closingBead === null) return "";
        if (!c.confirm) {
          ui.closeReason(c.reason);
          return "asked";
        }
        this.closeBead(c.reason);
        return "sent";
      case "bead-reopen":
        this.reopenBeadFor(c.bead);
        return "sent";
    }
  }
  /** After a destructive command opened its button's question: answer it with `choice` when confirmed. */
  answerAsked(confirm, choice) {
    if (this.notice !== null || this.confirming === null) return "sent";
    if (!confirm) return "asked";
    this.confirm(choice);
    return "sent";
  }
  /** Shows `session` of `city` once the city is subscribed and lists it (the focus command, the window's target). */
  focusSession(city, session) {
    const pinned = this.deps.discovery.machine.copy.pinned;
    if (pinned !== null && pinned !== city) {
      this.refuse(`this copy shows city ${cleanLine(pinned)} only`);
      return;
    }
    if (!this.checkCity(city)) return;
    this.focusing = { city, session, since: this.deps.clock.now() };
    this.followFocus();
  }
  /** A session by gc's id, or by its exact alias or session name when exactly one session has it; else says why not. */
  resolveSession(ref) {
    const items = this.city?.snapshot().sessions.value?.items;
    if (!items) {
      this.refuse(this.city ? "the session list has not loaded yet" : "no running city to act on");
      return null;
    }
    if (items.some((x) => x.id === ref)) return ref;
    const named = items.filter((x) => x.alias === ref || x.session_name === ref);
    const [only, ...more] = named;
    if (only && more.length === 0) return only.id;
    if (only) this.refuse(`"${cleanLine(ref)}" names sessions ${named.map((x) => cleanLine(x.id)).join(", ")}: use the session id`);
    else this.refuse(`no session "${cleanLine(ref)}" in city ${cleanLine(this.city?.key.city ?? "")}`);
    return null;
  }
  checkAgent(name) {
    const names = this.agentNames();
    if (names.includes(name)) return true;
    return this.refuse(this.city?.snapshot().agents.value ? `no agent ${cleanLine(name)} in this city` : "the agent list has not loaded yet");
  }
  checkRig(name) {
    const rigs = this.city?.snapshot().rigs.value;
    if (rigs?.items.some((r) => r.name === name)) return true;
    return this.refuse(rigs ? `no rig ${cleanLine(name)} in this city` : "the rig list has not loaded yet");
  }
  checkCity(city) {
    const cities = this.cities?.snapshot().value;
    if (cities?.items.some((c) => c.name === city)) return true;
    return this.refuse(cities ? `gc lists no city ${cleanLine(city)}` : "the city list has not loaded yet");
  }
  /** Session ids in the agents region's order (groups, their agents' sessions, then other sessions). */
  sessionOrder() {
    const s = this.city?.snapshot();
    if (!s) return [];
    const m = agentsModel({ snapshot: s, now: this.deps.clock.now(), selected: this.selected, collapsed: this.collapsed });
    return [...m.groups.flatMap((g) => g.agents.flatMap((a) => a.sessions.map((r) => r.id))), ...m.other.map((r) => r.id)];
  }
  // ---- the "needs you" window and focus -------------------------------------------------
  /** Applies the window's newest shared target, then shows the session being focused once its city lists it. */
  followFocus() {
    const now = this.deps.clock.now();
    if (this.deps.window && this.cities?.snapshot().value) {
      const t = focusToApply(this.deps.host.focusTarget(), this.focusApplied, now);
      if (t !== null) {
        this.focusApplied = t.seq;
        this.focusNext = { city: t.city, session: t.session };
      }
      const n = this.focusNext;
      const shown = this.focusShown;
      const same = shown !== null && shown.city === n?.city && (shown.session === n.session || this.selected === n.session);
      if (n !== null && (same || !(this.deps.draft?.() ?? false))) this.showNext();
    }
    const f = this.focusing;
    if (f === null) return;
    const { discovery } = this.deps;
    if (selectedCity(discovery.machine.state) !== f.city) discovery.select(f.city);
    if (this.city?.key.city === f.city && this.city.snapshot().sessions.value) {
      this.focusing = null;
      const id2 = this.resolveSession(f.session);
      if (id2 !== null) {
        this.selectSession(id2);
        this.focusShown = { city: f.city, session: id2 };
      }
      return;
    }
    if (now - f.since > FOCUS_WAIT_MS) {
      this.focusing = null;
      this.refuse(`could not show session ${cleanLine(f.session)}: city ${cleanLine(f.city)} is not running`);
    }
  }
  /** The window shows the target it held back ("Show"). */
  showNext() {
    const n = this.focusNext;
    this.focusNext = null;
    if (n !== null) this.focusSession(n.city, n.session);
  }
  windowModel() {
    const s = this.city?.snapshot();
    const sessions = s?.sessions.value?.items ?? [];
    const pending = (s?.pending.value?.items ?? []).map((p) => {
      const x = sessions.find((y) => y.id === p.session_id);
      return { session: cleanLine(p.session_id), label: cleanLine(x?.alias || x?.template || p.session_id), kind: cleanLine(p.kind) };
    });
    const t = this.focusShown;
    const n = this.focusNext;
    return {
      target: t ? { city: cleanLine(t.city), session: cleanLine(t.session) } : null,
      pending,
      tabs: this.gascityTabs,
      next: n ? { city: cleanLine(n.city), session: cleanLine(n.session) } : null
    };
  }
  // ---- actions ----------------------------------------------------------------------
  send(spec2) {
    if (!this.city) return this.refuse("no running city to act on");
    const activity = this.city ? activityModel(this.city.activity(), null, this.deps.clock.now()) : null;
    if (isBusy(activity, spec2)) return this.refuse(`${spec2.verb} is already under way`);
    this.notice = null;
    this.city.act(spec2, this.commandKey ?? void 0);
    return true;
  }
  retryNow(id2) {
    if (!this.city) {
      this.refuse("no running city to act on");
      return;
    }
    const r = this.city.retryAction(id2);
    this.notice = r.ok ? null : `not retried: ${r.error}`;
  }
  ask(c) {
    this.clearDialogs();
    this.confirming = c;
  }
  clearDialogs() {
    this.confirming = null;
    this.creating = null;
    this.beadForm = null;
    this.closingBead = null;
  }
  /** The city's agents by gc's qualified names, in gc's order. */
  agentNames() {
    return this.city?.snapshot().agents.value?.items.map((a) => a.name) ?? [];
  }
  /** A bead's id as gc sent it, if the board shows it or gc returned it by id; else says why not. */
  beadRef(id2) {
    const s = this.city?.snapshot();
    if (id2 === null || !s) {
      this.refuse("open a bead first");
      return null;
    }
    if (beadDetailModel({ snapshot: s, now: this.deps.clock.now(), selected: id2 }).kind !== "bead") {
      this.refuse(`bead ${cleanLine(id2)} is not on the board or known to gc`);
      return null;
    }
    return id2;
  }
  refuse(why) {
    this.notice = why;
    return false;
  }
  /** The open session's id as gc sent it, if gc still lists it. */
  selectedRef() {
    const id2 = this.selected;
    return id2 !== null && this.listed(id2) ? id2 : null;
  }
  /** The open session's id as gc sent it, if gc still lists it (the send box's session). */
  openSession() {
    return this.selectedRef();
  }
  /** The open session's id, listed by gc or not (a draft binds to it even while gc does not list it). */
  selectedSession() {
    return this.selected;
  }
  /** Whether gc lists session `id` (by its id). */
  listed(id2) {
    return this.city?.snapshot().sessions.value?.items.some((x) => x.id === id2) ?? false;
  }
  dialog() {
    if (this.creating) return { kind: "new-session", agent: cleanLine(this.creating.agent) };
    const f = this.beadForm;
    if (f) {
      const target = f.slingTo === null ? null : cleanLine(f.agents[f.slingTo] ?? "");
      return {
        kind: "new-bead",
        agents: f.agents.map(cleanLine),
        slingTo: target,
        slingToIndex: f.slingTo,
        note: target === null ? null : `Two gc calls: create the bead, then sling it to ${target}. A retry of the create reuses its key: gc deduplicates it within 30 min, not across a gc restart, and not after a gc-side error (gc then drops the key). ${SLING_MAY_ROUTE_TWICE}`
      };
    }
    if (this.closingBead) {
      return {
        kind: "close-bead",
        question: cleanLine(`Close bead ${this.closingBead.id}?`),
        detail: "gc closes the bead with the reason below as its close reason (blank: none). Reopen brings it back."
      };
    }
    const c = this.confirming;
    if (c?.pick) return { kind: "pick", question: cleanLine(c.pick.question), detail: cleanLine(c.pick.detail), choices: c.pick.labels.map(cleanLine) };
    const first = c?.specs[0];
    if (!c || !first?.confirm) return null;
    const choices = c.specs.map((x) => ({ label: cleanLine(x.verb), detail: cleanLine(x.confirm?.detail ?? "") }));
    return { kind: "confirm", question: cleanLine(c.retryOf === null ? first.confirm.question : `Retry: ${first.confirm.question}`), choices };
  }
  // ---- subscriptions --------------------------------------------------------------
  /**
   * Without an endpoint, rediscovers from this copy's own tick: after
   * rediscoverDelay(1), (2), … once each run has ended. A run that made no
   * progress for DISCOVERY_STALL_MS is started again at once.
   */
  followDiscovery(now, spawn) {
    const d = this.deps.discovery;
    const phase = d.machine.state.phase;
    if (phase !== "no-endpoint" && phase !== "discovering" && phase !== "listing") {
      this.rediscovery = null;
      return;
    }
    if (d.running()) {
      if (d.progress !== this.discoveryProgress.count) {
        this.discoveryProgress = { count: d.progress, at: now };
        return;
      }
      const idleMs = now - this.discoveryProgress.at;
      if (idleMs < DISCOVERY_STALL_MS) return;
      this.recordFailure("discovery", { kind: "discovery-stalled", idleMs });
    } else {
      this.rediscovery ??= { attempt: 1, at: now + rediscoverDelay(1) };
      if (now < this.rediscovery.at) return;
      const attempt = this.rediscovery.attempt + 1;
      this.rediscovery = { attempt, at: now + rediscoverDelay(attempt) };
    }
    spawn((task) => this.discover(task));
  }
  readVisibility() {
    const v = this.deps.host.visibility();
    if (v.ok) {
      this.onScreen = mayBeOnScreen(v.value);
      this.gascityTabs = [...new Set(v.value.panes.filter((p) => p.mod === MOD_NAME).map((p) => p.tab))];
      return;
    }
    this.onScreen = true;
    this.hostError(v.error);
  }
  hostError(error) {
    const errors = this.deps.discovery.hostErrors;
    const text2 = JSON.stringify(error);
    if (errors.some((e) => JSON.stringify(e) === text2)) return;
    this.deps.discovery.hostErrors = [...errors, error].slice(-HOST_ERROR_LIMIT);
  }
  followCities(apiUrl, fast) {
    if (this.cities && this.cities.apiUrl !== apiUrl) {
      this.cities.unsubscribe();
      this.cities = null;
    }
    if (!this.cities && apiUrl !== null) {
      const made = this.deps.registry.subscribeCities(apiUrl);
      if (!made.ok) {
        this.hostError(made.error);
        return;
      }
      this.cities = made.value;
      this.citiesRev = -1;
    }
    if (!this.cities) return;
    const rev = this.cities.tick(fast);
    if (rev === this.citiesRev) return;
    this.citiesRev = rev;
    const value = this.cities.snapshot().value;
    if (value !== null) this.deps.discovery.apply({ type: "cities", result: { ok: true, value } });
  }
  followCity(key) {
    const cur = this.city;
    if (cur && (key === null || cur.key.city !== key.city || cur.key.apiUrl !== key.apiUrl)) {
      this.peek?.release();
      this.peek = null;
      this.beadWatch?.release();
      this.beadWatch = null;
      cur.unsubscribe();
      this.city = null;
    }
    if (!this.city && key !== null) {
      const made = this.deps.registry.subscribe(key);
      if (!made.ok) {
        this.hostError(made.error);
        return;
      }
      this.city = made.value;
      this.applied = /* @__PURE__ */ new WeakSet();
      const id2 = `${key.apiUrl}\0${key.city}`;
      if (this.lastCity !== id2) this.selectedBead = null;
      this.lastCity = id2;
    }
    this.city?.tick();
  }
  followDetail() {
    const want = this.city !== null ? this.selected : null;
    if (this.peek && this.peek.id !== want) {
      this.peek.release();
      this.peek = null;
    }
    if (!this.peek && want !== null && this.city) this.peek = { id: want, release: this.city.watchPeek(want) };
  }
  followBead() {
    const want = this.city !== null ? this.selectedBead : null;
    if (this.beadWatch && this.beadWatch.id !== want) {
      this.beadWatch.release();
      this.beadWatch = null;
    }
    if (!this.beadWatch && want !== null && this.city) this.beadWatch = { id: want, release: this.city.watchBead(want) };
  }
  machineVersion() {
    const m = this.deps.discovery.machine;
    return `${m.state.phase}:${selectedCity(m.state) ?? ""}:${machineIds.get(m) ?? remember(m)}:${this.deps.discovery.hostErrors.length}`;
  }
  /** Records a failure of this copy's own work; one identical to the newest is not recorded again (a tick fails every 250 ms). */
  recordFailure(source, error) {
    const last = this.failures.at(-1);
    if (last && last.source === source && JSON.stringify(last.error) === JSON.stringify(error)) return;
    this.failures = [...this.failures, { at: this.deps.clock.now(), source, error }].slice(-COPY_ERROR_LIMIT);
  }
  herdrVersion() {
    const v = this.deps.host.herdrVersion();
    if (v.ok) return v.value;
    this.recordFailure("herdr", v.error);
    return null;
  }
  writeProbe(now) {
    const v = this.view(now);
    this.deps.probe.offer(this, probeDocument({
      modVersion: MOD_VERSION,
      herdrVersion: this.herdrVersion(),
      machine: this.deps.discovery.machine,
      header: v.header,
      onScreen: this.onScreen,
      keyboard: this.deps.host.keyboard(),
      agents: v.agents,
      board: v.board,
      beadDetail: v.beadDetail,
      detail: v.detail,
      activity: v.activity,
      diagnostics: v.diagnostics,
      execLog: this.deps.host.execLog(),
      refreshCount: this.refreshCount,
      fetchInFlightMax: this.deps.registry.budgetStats().maxInFlight,
      window: this.deps.window ?? false,
      notice: v.notice,
      commands: v.commands
    }), now);
  }
};
var SESSION_SPECS = { wake: sessionWake, suspend: sessionSuspend, stop: sessionStop, pin: sessionPin, unpin: sessionUnpin };
var machineIds = /* @__PURE__ */ new WeakMap();
var machineSeq = 0;
function remember(m) {
  const id2 = ++machineSeq;
  machineIds.set(m, id2);
  return id2;
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
  constructor(text2) {
    this.text = text2;
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
function parseSupervisorConfig(text2, path) {
  const c = new Cursor(text2);
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
var HEALTH_QUEUE_MS = 4e4;
var PROBE_ATTEMPTS = 2;
var SOURCE_NAMES = {
  setting: "the apiUrl setting",
  "gc-reported": "gc supervisor status",
  "supervisor-config": "supervisor.toml",
  default: "the default"
};
async function probe(host, url) {
  const pf = host.probeFetch();
  const client = createGcClient({ baseUrl: url, fetch: pf.fetch });
  if (!client.ok) return client;
  const answer = getHealth(client.value);
  const waited = await Promise.race([
    answer.then(() => "answered"),
    pf.sent.then(() => "sent"),
    host.sleep(HEALTH_QUEUE_MS).then(() => "queue-expired")
  ]);
  if (waited === "answered" || waited === "queue-expired" && pf.drop() > 0) return answer;
  const deadline = host.sleep(HEALTH_PROBE_MS).then(() => err({ kind: "timeout", url: `${client.value.baseUrl}/health`, ms: HEALTH_PROBE_MS }));
  return Promise.race([answer, deadline]);
}
async function probeCandidate(host, url) {
  let health = await probe(host, url);
  for (let attempt = 1; attempt < PROBE_ATTEMPTS && !health.ok && health.error.kind === "cancelled"; attempt++) health = await probe(host, url);
  return health;
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
    const health = await probeCandidate(host, url);
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
var HOST_ERROR_LIMIT2 = 20;
var NOT_RUN = "not run: this discovery was cancelled";
function droppedRejection(url) {
  return Object.assign(new Error(`gascity: request to ${url} not sent: this discovery was cancelled`), { hostElapsedMs: 0, cancelled: "abandoned" });
}
var DiscoveryController = class {
  constructor(host, copy) {
    this.host = host;
    this.machine = initialMachine(copy);
  }
  host;
  machine;
  /** Host calls that failed outside the machine (e.g. remembering the city); shown, newest last. */
  hostErrors = [];
  /** How many host calls of runs have settled so far: a run whose count stops moving has stalled. */
  progress = 0;
  generation = 0;
  active = false;
  /** The current run's budgeted fetches, so their queued requests can be dropped. */
  fetches = /* @__PURE__ */ new Set();
  /** Applies one event. */
  apply(event) {
    this.machine = step(this.machine, event);
  }
  /** Whether a run is under way (and not cancelled or superseded). */
  running() {
    return this.active;
  }
  /**
   * Ends the current run: its queued requests are dropped (never sent) and its
   * later host calls start nothing. Starts nothing (it runs from a copy's close).
   */
  cancel() {
    this.generation++;
    this.active = false;
    for (const f of this.fetches) f.drop();
    this.fetches = /* @__PURE__ */ new Set();
  }
  /**
   * Discovers from scratch: endpoint, then cities. A newer run supersedes an
   * older one; the older one's late results are not applied, since they
   * describe a discovery the person already replaced.
   */
  async run(task) {
    this.cancel();
    const generation = this.generation;
    const current = () => generation === this.generation;
    const host = this.guarded(current);
    this.active = true;
    try {
      this.apply({ type: "discover" });
      task.notify();
      const resolved = await resolveEndpoint({ ...host, sleep: (ms) => task.sleep(ms) });
      if (!current()) return;
      this.apply({ type: "resolved", result: resolved });
      task.notify();
      if (!resolved.ok) return;
      const client = createGcClient({ baseUrl: resolved.value.url, fetch: host.probeFetch().fetch });
      const cities = client.ok ? await listCities(client.value) : client;
      if (!current()) return;
      this.apply({ type: "cities", result: cities });
      task.notify();
    } finally {
      if (current()) {
        this.active = false;
        this.fetches = /* @__PURE__ */ new Set();
      }
    }
  }
  /** The person chose a city; an unpinned copy remembers it. */
  select(city) {
    const before = this.machine;
    this.apply({ type: "select", city });
    if (this.machine === before) return;
    const remembered = this.host.rememberCity(city);
    if (!remembered.ok) this.hostErrors = [...this.hostErrors, remembered.error].slice(-HOST_ERROR_LIMIT2);
  }
  /** The host as one run sees it: nothing starts once the run is no longer current; every settled call is progress. */
  guarded(current) {
    const settled = (p) => p.finally(() => {
      if (current()) this.progress++;
    });
    return {
      settings: () => this.host.settings(),
      gcStatus: (gcBin) => current() ? settled(this.host.gcStatus(gcBin)) : Promise.resolve(err({ kind: "exec", argv: [gcBin, ...GC_STATUS_ARGS], code: null, stderr: NOT_RUN })),
      readSupervisorConfig: () => current() ? settled(this.host.readSupervisorConfig()) : Promise.resolve(err({ kind: "host-call", api: "readTextFile(supervisor.toml)", cause: NOT_RUN })),
      fetch: this.host.fetch,
      probeFetch: () => {
        const pf = this.host.probeFetch();
        if (current()) this.fetches.add(pf);
        const fetch2 = (url, init) => current() ? settled(pf.fetch(url, init)) : Promise.reject(droppedRejection(url));
        return { fetch: fetch2, drop: () => pf.drop(), sent: settled(pf.sent) };
      }
    };
  }
};

// src/probe.ts
var PROBE_HEARTBEAT_MS = 5e3;
var PROBE_WRITE_DEADLINE_MS = 5e3;
var PROBE_MAX_BYTES = 1024 * 1024;
var ERROR_LIMIT = 20;
function utf8Bytes(text2) {
  let n = 0;
  for (let i = 0; i < text2.length; i++) {
    const c = text2.charCodeAt(i);
    if (c < 128) n += 1;
    else if (c < 2048) n += 2;
    else if (c >= 55296 && c <= 56319 && i + 1 < text2.length && (text2.charCodeAt(i + 1) & 64512) === 56320) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
function serialize(doc) {
  return `${JSON.stringify(doc, null, 2)}
`;
}
function half(list, keep = "first") {
  const n = Math.floor(list.length / 2);
  return keep === "first" ? list.slice(0, n) : list.slice(list.length - n);
}
function halveLists(b) {
  return {
    ...b,
    sessions: half(b.sessions),
    actions: half(b.actions),
    exec_log: half(b.exec_log, "last"),
    errors: half(b.errors),
    board: b.board === null ? null : {
      ...b.board,
      ready: { ...b.board.ready, cards: half(b.board.ready.cards) },
      in_progress: { ...b.board.in_progress, cards: half(b.board.in_progress.cards) },
      closed: { ...b.board.closed, recent: half(b.board.closed.recent), earlier: half(b.board.closed.earlier) },
      errors: half(b.board.errors)
    }
  };
}
function listsEmpty(b) {
  const lists = [b.sessions, b.actions, b.exec_log, b.errors];
  if (b.board) lists.push(b.board.ready.cards, b.board.in_progress.cards, b.board.closed.recent, b.board.closed.earlier, b.board.errors);
  return lists.every((l) => l.length === 0);
}
function fitProbe(body, extra, limit = PROBE_MAX_BYTES) {
  const whole = serialize({ ...body, ...extra });
  if (utf8Bytes(whole) <= limit) return { text: whole, truncated: [] };
  const truncated = [];
  let b = body;
  if (b.detail !== null && (b.detail.output !== null || b.detail.pending !== null)) {
    b = { ...b, detail: { ...b.detail, output: null, pending: null } };
    truncated.push("detail.output", "detail.pending");
  }
  if (b.bead_detail !== null && b.bead_detail.description !== null) {
    b = { ...b, bead_detail: { ...b.bead_detail, description: null } };
    truncated.push("bead_detail.description");
  }
  const sizes = (x) => `sessions ${x.sessions.length}, actions ${x.actions.length}, exec_log ${x.exec_log.length}, errors ${x.errors.length}`;
  const before = sizes(b);
  for (let halvings = 0; ; halvings++) {
    const notes = halvings === 0 ? truncated : [...truncated, `every list halved ${halvings} times (${before} -> ${sizes(b)})`];
    const text2 = serialize({ ...b, truncated: notes, ...extra });
    if (utf8Bytes(text2) <= limit) return { text: text2, truncated: notes };
    if (listsEmpty(b)) break;
    b = halveLists(b);
  }
  const all = [...truncated, "everything but the schema and versions"];
  return { text: serialize({ schema: body.schema, mod_version: body.mod_version, herdr_version: body.herdr_version, truncated: all, ...extra }), truncated: all };
}
var ProbeWriter = class {
  constructor(io) {
    this.io = io;
  }
  io;
  /** What the file holds, as far as the writer knows; undefined: read it before writing. */
  expected = void 0;
  inFlight = null;
  tokens = 0;
  lastBody = null;
  lastWriteAt = -Infinity;
  seq = 0;
  failures = [];
  /** The copy whose documents are written, while the probe is on. */
  owner = null;
  /** The probe is off and the file is known to be absent or empty. */
  cleared = false;
  /** What the last cut-down document lost ("" when the last write was whole). */
  lastCut = "";
  /** Recent write failures and cut-down documents, oldest first. */
  errors() {
    return this.failures;
  }
  /**
   * Called from a copy's own tick while the probe is on: writes `body` if
   * `owner` owns the file (or nobody does) and the document changed or a
   * heartbeat is due.
   */
  offer(owner, body, now) {
    if (this.busy(now)) return;
    if (this.owner !== null && this.owner !== owner) return;
    this.owner = owner;
    this.cleared = false;
    const json = JSON.stringify(body);
    if (json === this.lastBody && now - this.lastWriteAt < PROBE_HEARTBEAT_MS) return;
    const fitted = fitProbe(body, { seq: ++this.seq, ts: new Date(now).toISOString() });
    const cut = fitted.truncated.join("; ");
    if (cut !== "" && cut !== this.lastCut) {
      this.record(now, { kind: "probe-truncated", limitBytes: PROBE_MAX_BYTES, dropped: fitted.truncated });
    }
    this.lastCut = cut;
    this.swap(now, () => fitted.text, (text2) => {
      this.expected = text2;
      this.lastBody = json;
      this.lastWriteAt = now;
    });
  }
  /** Called from a copy's own tick while the probe is off: empties a file that still holds a document. */
  off(now) {
    this.owner = null;
    this.lastBody = null;
    this.lastCut = "";
    if (this.cleared || this.busy(now)) return;
    this.swap(now, (current) => current === null || current === "" ? null : "", (text2) => {
      this.expected = text2;
      this.cleared = true;
    });
  }
  /** The copy closes: it no longer owns the file (the next copy to offer takes over). Starts nothing. */
  release(owner) {
    if (this.owner === owner) this.owner = null;
  }
  /** A write is in flight (one with no answer by the deadline is given up and recorded). */
  busy(now) {
    if (!this.inFlight) return false;
    if (now - this.inFlight.startedAt < PROBE_WRITE_DEADLINE_MS) return true;
    this.fail(now, { kind: "host-call", api: `writeTextFile(${this.io.path()})`, cause: `no answer within ${PROBE_WRITE_DEADLINE_MS} ms` });
    this.inFlight = null;
    return false;
  }
  /**
   * One compare-and-swap: `next` gets what the file holds and returns the text
   * to write, or null to leave it as it is; `done` gets what the file holds after.
   */
  swap(now, next, done) {
    const token = ++this.tokens;
    this.inFlight = { token, startedAt: now };
    const path = this.io.path();
    const known = this.expected;
    const current = known === void 0 ? this.io.read(path) : Promise.resolve(ok(known));
    void current.then(async (r) => {
      if (!r.ok) return r;
      const text2 = next(r.value);
      if (text2 === null) return ok(r.value);
      const w = await this.io.write(path, text2, r.value);
      return w.ok ? ok(text2) : w;
    }).then((r) => {
      if (this.inFlight?.token !== token) return;
      this.inFlight = null;
      if (r.ok) done(r.value);
      else this.fail(now, r.error);
    });
  }
  fail(at3, error) {
    this.expected = void 0;
    this.record(at3, error);
  }
  record(at3, error) {
    this.failures = [...this.failures, { at: at3, source: "probe", error }].slice(-ERROR_LIMIT);
  }
};
var shared3 = null;
function sharedProbeWriter(create) {
  shared3 ??= create();
  return shared3;
}

// src/sync/clock.ts
var systemClock = { now: () => Date.now() };

// src/sync/endpoint.ts
var PROBE_DEADLINE_MS = RECLAIM_AFTER_MS + 5e3;
var Endpoint = class _Endpoint {
  constructor(baseUrl, clients, budget, clock, random) {
    this.baseUrl = baseUrl;
    this.clients = clients;
    this.budget = budget;
    this.clock = clock;
    this.random = random;
  }
  baseUrl;
  clients;
  budget;
  clock;
  random;
  listeners = /* @__PURE__ */ new Set();
  backoff = null;
  probe = null;
  probeTokens = 0;
  connected = false;
  /** An endpoint for a loopback API URL; `not-loopback` otherwise. */
  static create(apiUrl, budget, clock, random) {
    const clients = {};
    let baseUrl = apiUrl;
    for (const p of PRIORITIES) {
      const made = createGcClient({ baseUrl: apiUrl, fetch: (url, init) => budget.fetchFor(baseUrl, p)(url, init), now: () => clock.now() });
      if (!made.ok) return err(made.error);
      baseUrl = made.value.baseUrl;
      clients[p] = made.value;
    }
    return ok(new _Endpoint(baseUrl, clients, budget, clock, random));
  }
  /**
   * The client whose requests queue at `priority`. With a `group` (a sync
   * step), its queued requests can be dropped together (dropQueued).
   */
  client(priority, group = null) {
    if (group === null) return this.clients[priority];
    const options = {
      baseUrl: this.baseUrl,
      fetch: (url, init) => this.budget.fetchFor(this.baseUrl, priority, group)(url, init),
      now: () => this.clock.now()
    };
    const made = createGcClient(options);
    return made.ok ? made.value : { baseUrl: this.baseUrl, call: () => Promise.resolve(made) };
  }
  /** Drops the group's queued requests (they reject as cancelled and are never sent). Starts nothing. Returns how many. */
  dropQueued(group) {
    return this.budget.dropQueued(group);
  }
  addListener(l) {
    this.listeners.add(l);
  }
  /** Removes a listener; returns how many remain. */
  removeListener(l) {
    this.listeners.delete(l);
    return this.listeners.size;
  }
  connection() {
    if (this.backoff) return { kind: "backing-off", attempt: this.backoff.attempt, retryAt: this.backoff.retryAt, cause: this.backoff.cause };
    return this.connected ? { kind: "connected" } : { kind: "connecting" };
  }
  /** Whether reads are open at `now`, without claiming the probe: "open", "probe" (one is due; token 0) or "wait". */
  peekGate(now) {
    if (!this.backoff) return { kind: "open" };
    if (this.probe && now < this.probe.until) return { kind: "wait", until: this.probe.until };
    if (now < this.backoff.retryAt) return { kind: "wait", until: this.backoff.retryAt };
    return { kind: "probe", token: 0 };
  }
  /**
   * Whether a store may read at `now`. While backing off, the first store to
   * ask after the retry time gets "probe" and must call endProbe(token) when
   * its one read is done; the others wait for the probe's outcome or its
   * deadline.
   */
  gate(now) {
    const g = this.peekGate(now);
    if (g.kind !== "probe") return g;
    this.probe = { token: ++this.probeTokens, until: now + PROBE_DEADLINE_MS };
    return { kind: "probe", token: this.probe.token };
  }
  /** Ends the probe granted with `token`; a stale token (an expired probe) is ignored. */
  endProbe(token) {
    if (this.probe?.token === token) this.probe = null;
  }
  /** gc answered a read (any answer that does not back off). */
  succeeded() {
    const recovered = this.backoff !== null;
    const changed = recovered || !this.connected;
    this.backoff = null;
    this.probe = null;
    this.connected = true;
    if (recovered) this.budget.setDegraded(this.baseUrl, false);
    if (changed) this.notify(recovered);
  }
  /** A read failed in a way that backs off (backoff.ts backsOff): back off (again). */
  failed(cause) {
    this.backoff = failBackoff(this.backoff, this.clock.now(), cause, this.random);
    this.budget.setDegraded(this.baseUrl, true);
    this.notify(false);
  }
  /** "Retry now": the next read is due at once. */
  retryNow() {
    if (!this.backoff) return;
    this.backoff = retryBackoffNow(this.backoff, this.clock.now());
    this.notify(false);
  }
  /** Forgets the endpoint in the budget when the last user goes (from a copy's close: starts nothing). */
  dispose() {
    this.budget.forgetEndpoint(this.baseUrl);
  }
  notify(recovered) {
    for (const l of [...this.listeners]) l.endpointChanged(recovered);
  }
};

// src/sync/cities.ts
var CITIES_FAST_MS = 1e4;
var CITIES_SLOW_MS = 6e4;
var POLL_DEADLINE_MS = RECLAIM_AFTER_MS + 5e3;
var CitiesPoller = class {
  constructor(endpoint, clock) {
    this.endpoint = endpoint;
    this.clock = clock;
    endpoint.addListener(this);
  }
  endpoint;
  clock;
  snap = { rev: 0, value: null, fetchedAt: null, error: null };
  last = null;
  wanted = false;
  poll = null;
  disposed = false;
  snapshot() {
    return this.snap;
  }
  /**
   * Called by a subscribed copy in its own turn; `fast` when that copy shows
   * no running city. Starts a poll if one is due and none is running.
   */
  tick(starter, fast) {
    if (this.disposed) return;
    const now = this.clock.now();
    if (this.poll) {
      if (now - this.poll.startedAt <= POLL_DEADLINE_MS) return;
      this.abandon();
    }
    const interval = fast ? CITIES_FAST_MS : CITIES_SLOW_MS;
    if (!this.wanted && this.last !== null && now < this.last + interval) return;
    const gate = this.endpoint.gate(now);
    if (gate.kind === "wait") return;
    const poll = { starter, startedAt: now, probe: gate.kind === "probe" ? gate.token : null };
    this.poll = poll;
    this.wanted = false;
    this.last = now;
    void listCities(this.endpoint.client("snapshot", poll)).then((r) => this.settle(poll, r));
  }
  /** Polls at the next tick (a city.* event, "retry now"). */
  refresh() {
    this.wanted = true;
  }
  /** The copy `starter` closes: drop the poll it started. Starts nothing. */
  abandonStartedBy(starter) {
    if (this.poll?.starter === starter) {
      this.abandon();
      this.wanted = true;
    }
  }
  dispose() {
    this.abandon();
    this.disposed = true;
    this.endpoint.removeListener(this);
  }
  endpointChanged(recovered) {
    if (recovered) this.wanted = true;
  }
  abandon() {
    const poll = this.poll;
    if (!poll) return;
    this.poll = null;
    if (poll.probe !== null) this.endpoint.endProbe(poll.probe);
    this.endpoint.dropQueued(poll);
  }
  settle(poll, r) {
    if (poll.probe !== null) this.endpoint.endProbe(poll.probe);
    if (this.poll !== poll || this.disposed) return;
    this.poll = null;
    const now = this.clock.now();
    if (r.ok) {
      this.endpoint.succeeded();
      this.snap = { rev: this.snap.rev + 1, value: r.value, fetchedAt: now, error: null };
      return;
    }
    if (r.error.kind === "cancelled") {
      this.wanted = true;
      return;
    }
    if (backsOff(r.error)) this.endpoint.failed(r.error);
    else this.endpoint.succeeded();
    this.snap = { ...this.snap, rev: this.snap.rev + 1, error: r.error };
  }
};

// src/sync/registry.ts
var TICK_MS = 250;
function originOf2(url) {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? url;
}
function storeId(apiUrl, city) {
  return `${apiUrl}\0${city}`;
}
var SyncRegistry = class {
  constructor(deps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.budget = new FetchBudget(deps.fetch, this.clock);
    this.random = deps.random ?? Math.random;
  }
  deps;
  budget;
  clock;
  random;
  endpoints = /* @__PURE__ */ new Map();
  stores = /* @__PURE__ */ new Map();
  pollers = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  onScreen = false;
  /** Subscribes a copy to a city on a loopback gc API; `not-loopback` otherwise. */
  subscribe(key) {
    const endpoint = this.endpointFor(key.apiUrl);
    if (!endpoint.ok) return endpoint;
    const id2 = storeId(endpoint.value.baseUrl, key.city);
    let entry = this.stores.get(id2);
    if (!entry) {
      const store = new CityStore({ apiUrl: endpoint.value.baseUrl, city: key.city }, {
        endpoint: endpoint.value,
        clock: this.clock,
        onScreen: this.onScreen,
        emit: (batch) => {
          if (batch.citiesChanged) this.pollers.get(endpoint.value.baseUrl)?.poller.refresh();
          for (const l of [...this.listeners]) l(batch);
        },
        onError: (k, e) => this.deps.onError?.(k, e)
      });
      const ep = endpoint.value;
      const ledger = new ActionLedger({
        city: key.city,
        clock: this.clock,
        client: (priority, group) => ep.client(priority, group),
        dropQueued: (group) => ep.dropQueued(group),
        refresh: (domains) => store.refresh(domains),
        refreshDetail: (sessionId) => store.refreshDetail(sessionId),
        refreshBead: (beadId) => store.refreshBead(beadId),
        newKey: this.deps.newKey ?? (() => newIdempotencyKey())
      });
      entry = { store, ledger, notifier: new NeedsYouNotifier(key.city), subs: 0 };
      this.stores.set(id2, entry);
    }
    entry.subs++;
    return ok(this.subscription(id2, entry.store, entry.ledger, entry.notifier, endpoint.value));
  }
  /** Subscribes a copy to a loopback gc API's shared city list; `not-loopback` otherwise. */
  subscribeCities(apiUrl) {
    const endpoint = this.endpointFor(apiUrl);
    if (!endpoint.ok) return endpoint;
    const ep = endpoint.value;
    let entry = this.pollers.get(ep.baseUrl);
    if (!entry) {
      entry = { poller: new CitiesPoller(ep, this.clock), subs: 0 };
      this.pollers.set(ep.baseUrl, entry);
    }
    entry.subs++;
    const { poller } = entry;
    const owner = {};
    let active = true;
    return ok({
      apiUrl: ep.baseUrl,
      snapshot: () => poller.snapshot(),
      tick: (fast) => {
        if (active) {
          this.budget.reclaim();
          poller.tick(owner, fast);
        }
        return poller.snapshot().rev;
      },
      refresh: () => {
        if (active) poller.refresh();
      },
      unsubscribe: () => {
        if (!active) return;
        active = false;
        poller.abandonStartedBy(owner);
        const e = this.pollers.get(ep.baseUrl);
        if (e && --e.subs <= 0) {
          this.pollers.delete(ep.baseUrl);
          poller.dispose();
          this.releaseEndpoint(ep, poller);
        }
      }
    });
  }
  /**
   * A fetch for discovery's probes (/health, /v0/cities) through the app-wide
   * budget, at snapshot priority, so discovery never adds a third request in
   * flight. A probe that lost its race stays counted until herdr settles it.
   */
  probeFetch() {
    const group = {};
    let markSent;
    const sent = new Promise((resolve) => {
      markSent = resolve;
    });
    return {
      fetch: (url, init) => this.budget.fetchFor(originOf2(url), "snapshot", group, markSent)(url, init),
      drop: () => this.budget.dropQueued(group),
      sent
    };
  }
  /**
   * Frees fetch slots herdr can no longer settle (their copy closed) and
   * starts what fits; call from a copy's own tick, so a queued request
   * (discovery's) starts in a live copy's turn even with no city subscribed.
   */
  reclaim() {
    this.budget.reclaim();
  }
  /** Sets the app-wide "a gascity view may be on screen" (visibility.ts) for every store. */
  setOnScreen(onScreen) {
    this.onScreen = onScreen;
    for (const { store } of this.stores.values()) store.setOnScreen(onScreen);
  }
  /** Registers an app-wide listener for new events of every store; returns the removal. */
  onEvents(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Live stores. */
  storeCount() {
    return this.stores.size;
  }
  /** The fetch budget's counters. */
  budgetStats() {
    return this.budget.stats();
  }
  endpointFor(apiUrl) {
    const made = Endpoint.create(apiUrl, this.budget, this.clock, this.random);
    if (!made.ok) return err(made.error);
    const existing = this.endpoints.get(made.value.baseUrl);
    if (existing) return ok(existing);
    this.endpoints.set(made.value.baseUrl, made.value);
    return made;
  }
  /** Drops an endpoint once its last store or poller has gone (from a close: starts nothing). */
  releaseEndpoint(endpoint, user) {
    if (endpoint.removeListener(user) > 0) return;
    endpoint.dispose();
    this.endpoints.delete(endpoint.baseUrl);
  }
  subscription(id2, store, ledger, notifier, endpoint) {
    const owner = {};
    const watches = /* @__PURE__ */ new Set();
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      for (const release2 of [...watches]) release2();
      watches.clear();
      ledger.ownerGone(owner);
      store.abandonStartedBy(owner);
      const entry = this.stores.get(id2);
      if (entry && --entry.subs <= 0) {
        this.stores.delete(id2);
        ledger.dispose();
        store.dispose();
        this.releaseEndpoint(endpoint, store);
      }
    };
    const watch = (release2) => {
      const once = () => {
        watches.delete(once);
        release2();
      };
      watches.add(once);
      return once;
    };
    return {
      key: store.key,
      snapshot: () => store.snapshot(),
      tick: () => {
        if (active) {
          this.budget.reclaim();
          store.tick(owner);
          ledger.tick(owner);
          const s = store.snapshot();
          const now = this.clock.now();
          const batch = notifier.observe(s.pending.value, s.sessions.value, now);
          if (this.deps.onNeedsYou && (batch.toasts.length > 0 || batch.more > 0)) {
            const posted = this.deps.onNeedsYou(batch);
            notifier.failed(posted.failed, now);
            for (const message of posted.errors) store.noteError("toasts", { kind: "listener-failed", message });
          }
        }
        return store.snapshot().rev;
      },
      watchPeek: (sessionId) => active ? watch(store.watchPeek(sessionId)) : () => {
      },
      watchBead: (beadId) => active ? watch(store.watchBead(beadId)) : () => {
      },
      refreshDetail: (sessionId) => {
        if (active) store.refreshDetail(sessionId);
      },
      retryNow: () => {
        if (active) store.retryNow();
      },
      refresh: (domains) => {
        if (active) store.refresh(domains);
      },
      client: () => endpoint.client("mutation"),
      act: (spec2, key) => active ? ledger.start(owner, spec2, key) : -1,
      retryAction: (actionId) => active ? ledger.retry(owner, actionId, store.snapshot()) : err("this view has closed"),
      refreshAction: (actionId) => {
        if (active) ledger.refreshFor(actionId);
      },
      activity: () => ledger.snapshot(),
      unsubscribe
    };
  }
};
var shared4 = null;
function sharedRegistry(create) {
  shared4 ??= create();
  return shared4;
}

// src/sync/visibilityCache.ts
var VISIBILITY_MAX_AGE_MS = 1e3;
var VisibilityCache = class {
  constructor(read) {
    this.read = read;
  }
  read;
  last = null;
  stale = false;
  /** The answer at `now`: the shared one while it is current, else a new read. */
  get(now) {
    const last = this.last;
    if (last !== null) {
      const age = now - last.at;
      if (age >= 0 && (age < TICK_MS || !this.stale && age < VISIBILITY_MAX_AGE_MS)) return last.value;
    }
    const value = this.read();
    this.last = { at: now, value };
    this.stale = false;
    return value;
  }
  /** herdr re-rendered a copy: its live data may have changed, so read again at the next tick window. */
  invalidate() {
    this.stale = true;
  }
};
var shared5 = null;
function sharedVisibilityCache(create) {
  shared5 ??= create();
  return shared5;
}

// src/view/panel.ts
import { div as div6 } from "gpui-kit";
import { h_flex as h_flex7, v_flex as v_flex7 } from "gpui-base";

// src/view/agents.ts
import { div as div2 } from "gpui-kit";
import { h_flex as h_flex2, v_flex as v_flex2 } from "gpui-base";

// src/view/dialogs.ts
import { Input, h_flex, v_flex } from "gpui-base";

// src/view/text.ts
import { div } from "gpui-kit";
function label(id2, text2) {
  return div().id(id2).child(cleanLine(text2));
}
function tinted(el, color, apply) {
  return color === void 0 ? el : apply(el, color);
}
function muted(el, theme2) {
  return tinted(el, theme2.colors.muted, (e, c) => e.text_color(c));
}
function greyedIf(el, stale, theme2) {
  return stale ? muted(el, theme2) : el;
}
function themedRoot(theme2, el) {
  const { colors } = theme2;
  return tinted(tinted(el, colors.background, (e, c) => e.bg(c)), colors.foreground, (e, c) => e.text_color(c));
}

// src/view/dialogs.ts
function button(id2, text2, onClick) {
  return label(id2, `[${text2}]`).on_click((_, cx) => onClick(cx));
}
function waiting(id2, text2, why, theme2) {
  return muted(label(id2, `[${text2}: ${why}]`), theme2);
}
function field(id2, text2, state) {
  return h_flex().id(id2).gap(4).child(label(`${id2}-label`, text2)).child(Input.new(state));
}
function newBeadForm(d, theme2, actions, inputs, cancel) {
  let form = v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", "New bead"));
  if (inputs !== null) {
    form = form.child(field("gascity-dialog-title", "Title:", inputs.beadTitle)).child(field("gascity-dialog-description", "Description:", inputs.beadDescription)).child(field("gascity-dialog-priority", "Priority:", inputs.beadPriority)).child(field("gascity-dialog-labels", "Labels:", inputs.beadLabels));
  }
  const targets = [label("gascity-dialog-sling-label", "Sling to:")];
  const target = (id2, text2, chosen, index) => {
    if (chosen) targets.push(label(`${id2}-chosen`, "▸"));
    targets.push(button(id2, text2, (cx) => actions.chooseSlingTarget(index, cx)));
  };
  target("gascity-dialog-sling-none", "none", d.slingTo === null, null);
  d.agents.forEach((a, i) => target(`gascity-dialog-sling-${i}`, a, d.slingToIndex === i, i));
  form = form.child(h_flex().id("gascity-dialog-sling").gap(4).children(targets));
  if (d.agents.length === 0) form = form.child(muted(label("gascity-dialog-sling-empty", "no agents listed yet: the bead can be slung from its detail later"), theme2));
  if (d.note !== null) form = form.child(muted(label("gascity-dialog-note", d.note), theme2));
  const create = button("gascity-dialog-create-bead", d.slingTo === null ? "Create" : "Create and sling", (cx) => actions.createBead(cx));
  return form.child(h_flex().id("gascity-dialog-buttons").gap(8).child(create).child(cancel));
}
function renderDialog(d, theme2, actions, inputs) {
  if (d === null) return null;
  const cancel = button("gascity-dialog-cancel", "Cancel", (cx) => actions.cancelDialog(cx));
  if (d.kind === "new-session") {
    let form = v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", `New session of agent ${d.agent}`));
    if (inputs !== null) form = form.child(field("gascity-dialog-alias", "Alias (optional):", inputs.alias));
    return form.child(h_flex().id("gascity-dialog-buttons").gap(8).child(button("gascity-dialog-create", "Start session", (cx) => actions.createSession(cx))).child(cancel));
  }
  if (d.kind === "new-bead") return newBeadForm(d, theme2, actions, inputs, cancel);
  if (d.kind === "close-bead") {
    let form = v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", d.question)).child(muted(label("gascity-dialog-detail", d.detail), theme2));
    if (inputs !== null) form = form.child(field("gascity-dialog-reason", "Reason:", inputs.closeReason));
    return form.child(h_flex().id("gascity-dialog-buttons").gap(8).child(button("gascity-dialog-close-bead", "Close bead", (cx) => actions.closeBead(cx))).child(cancel));
  }
  if (d.kind === "pick") {
    const picks = d.choices.map((c, i) => button(`gascity-dialog-pick-${i}`, c, (cx) => actions.confirm(i, cx)));
    return v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", d.question)).child(muted(label("gascity-dialog-detail", d.detail), theme2)).child(h_flex().id("gascity-dialog-buttons").gap(8).children([...picks, cancel]));
  }
  let el = v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", d.question));
  d.choices.forEach((c, i) => {
    el = el.child(muted(label(`gascity-dialog-detail-${i}`, d.choices.length > 1 ? `${c.label}: ${c.detail}` : c.detail), theme2));
  });
  const buttons = d.choices.map((c, i) => button(`gascity-dialog-confirm-${i}`, c.label, (cx) => actions.confirm(i, cx)));
  return el.child(h_flex().id("gascity-dialog-buttons").gap(8).children([...buttons, cancel]));
}
function renderNotice(notice) {
  return notice === null ? null : label("gascity-notice", notice);
}
var TONES = {
  pending: "pending",
  done: "done",
  failed: "failed",
  unknown: "outcome unknown",
  "not-sent": "not sent"
};
function activityRow(r, theme2, actions) {
  const id2 = `gascity-activity-${r.id}`;
  const attempt = r.attempt > 1 ? ` (attempt ${r.attempt})` : "";
  const request = r.requestId === null ? "" : ` · request ${r.requestId}`;
  let el = h_flex().id(id2).gap(8).child(label(`${id2}-text`, `${r.title}${attempt} → ${TONES[r.tone]}: ${r.detail}${request}`));
  if (r.refresh) el = el.child(button(`${id2}-refresh`, "Refresh state", (cx) => actions.refreshAction(r.id, cx)));
  if (r.retry.kind === "retry") el = el.child(button(`${id2}-retry`, r.retry.label, (cx) => actions.retryAction(r.id, cx)));
  if (r.retry.kind === "wait") el = el.child(waiting(`${id2}-retry`, "Retry", r.retry.reason, theme2));
  return r.tone === "done" ? muted(el, theme2) : el;
}
function renderActivity(m, theme2, actions) {
  if (m === null || m.rows.length === 0) return null;
  return v_flex().id("gascity-activity").gap(2).child(label("gascity-activity-title", "Activity")).children(m.rows.map((r) => activityRow(r, theme2, actions)));
}

// src/view/agents.ts
function actionButton(id2, spec2, activity, theme2, actions) {
  if (isBusy(activity, spec2)) return waiting(id2, spec2.verb, "under way", theme2);
  return button(id2, spec2.confirm ? `${spec2.verb}…` : spec2.verb, (cx) => actions.act(spec2, cx));
}
function statusText(row2) {
  return row2.status.detail === null ? row2.status.label : `${row2.status.label} · ${row2.status.detail}`;
}
function sessionRow(r, id2, theme2, actions) {
  const parts = [r.label, statusText(r)];
  if (r.activeBead !== null) {
    parts.push(r.activeBead.title === null ? `bead ${r.activeBead.id} (${r.activeBead.note ?? ""})` : `bead ${r.activeBead.id} "${r.activeBead.title}"`);
  } else {
    parts.push("no active bead");
  }
  if (r.attached) parts.push("terminal attached");
  const row2 = h_flex2().id(id2).gap(8).on_click((_, cx) => actions.selectSession(r.selected ? null : r.id, cx)).child(label(`${id2}-text`, `${r.selected ? "▸ " : ""}session ${r.id}: ${parts.join(" · ")}`));
  return r.selected ? row2 : muted(row2, theme2);
}
function agentRow(a, id2, theme2, actions, activity) {
  const head = [a.label];
  if (a.pool !== null) head.push(a.pool);
  if (a.suspended) head.push("agent suspended");
  head.push(statusText(a));
  const toggle = a.suspended ? agentResume(a.ref) : agentSuspend(a.ref);
  const bar = h_flex2().id(`${id2}-actions`).gap(8).child(label(`${id2}-head`, head.join(" · "))).child(button(`${id2}-new`, "New session…", (cx) => actions.openNewSession(a.ref, cx))).child(actionButton(`${id2}-${a.suspended ? "resume" : "suspend"}`, toggle, activity, theme2, actions));
  const el = v_flex2().id(id2).gap(2).child(bar);
  return el.children(a.sessions.map((r, k) => sessionRow(r, `${id2}-session-${k}`, theme2, actions)));
}
function groupHead(g, i, theme2, actions, activity) {
  const counts2 = g.counts === null ? g.listed ? "" : " (not in gc's rig list)" : ` · ${g.counts}`;
  const title = label(`gascity-group-${i}`, `${g.collapsed ? "▸" : "▾"} ${g.title}${g.suspended ? " (suspended)" : ""}${counts2}`).on_click((_, cx) => actions.toggleGroup(g.key, cx));
  if (g.rig === null) return title;
  const spec2 = g.suspended ? rigResume(g.rig) : rigSuspend(g.rig);
  return h_flex2().id(`gascity-group-${i}-head`).gap(8).child(title).child(actionButton(`gascity-group-${i}-${g.suspended ? "resume" : "suspend"}`, spec2, activity, theme2, actions));
}
function renderAgents(m, theme2, actions, activity = null) {
  let region = v_flex2().id("gascity-agents").gap(6).child(label("gascity-agents-title", "Agents"));
  const state = m.region;
  if (state.kind === "loading") region = region.child(muted(label("gascity-agents-loading", "loading…"), theme2));
  if (state.age !== null) region = region.child(muted(label("gascity-agents-age", state.stale ? `${state.age} (may be out of date)` : state.age), theme2));
  if (state.error !== null) region = region.child(label("gascity-agents-error", state.error));
  m.banners.forEach((b, i) => {
    region = region.child(label(`gascity-agents-banner-${i}`, b));
  });
  const groups = m.groups.map((g, i) => v_flex2().id(`gascity-group-${i}-body`).gap(4).child(groupHead(g, i, theme2, actions, activity)).children(g.agents.map((a, j) => agentRow(a, `gascity-agent-${i}-${j}`, theme2, actions, activity))));
  let body = v_flex2().id("gascity-agents-body").gap(6).children(groups);
  if (m.other.length > 0) {
    body = body.child(v_flex2().id("gascity-other").gap(2).child(label("gascity-other-title", "Other sessions")).children(m.other.map((r, k) => sessionRow(r, `gascity-other-${k}`, theme2, actions))));
  }
  if (m.unreadable.length > 0) {
    body = body.child(v_flex2().id("gascity-unreadable").gap(2).children(m.unreadable.map((u, k) => label(`gascity-unreadable-${k}`, u.text))));
  }
  if (state.kind === "ok" && m.groups.length === 0 && m.other.length === 0) body = body.child(muted(label("gascity-agents-empty", "gc lists no agents"), theme2));
  return region.child(greyedIf(div2().id("gascity-agents-data").child(body), state.stale, theme2));
}

// src/view/board.ts
import { div as div3 } from "gpui-kit";
import { h_flex as h_flex3, v_flex as v_flex3 } from "gpui-base";
function cardText(c) {
  const parts = [c.id];
  if (c.priority !== null) parts.push(c.priority);
  parts.push(`"${c.title}"`, c.state, c.type);
  if (c.assignee !== null) parts.push(`→ ${c.assignee}`);
  if (c.labels.length > 0) parts.push(`[${c.labels.join(", ")}]`);
  if ("closeReason" in c && c.closeReason !== null) parts.push(`reason: ${c.closeReason}`);
  return `${c.selected ? "▸ " : ""}${parts.join(" · ")}`;
}
function card2(c, id2, theme2, actions) {
  const el = label(id2, cardText(c)).on_click((_, cx) => actions.selectBead(c.selected ? null : c.id, cx));
  return c.selected ? el : muted(el, theme2);
}
function column(key, m, body, theme2) {
  const id2 = `gascity-col-${key}`;
  let el = v_flex3().id(id2).flex_1().gap(4).child(label(`${id2}-title`, `${m.title} (${m.count})`));
  const state = m.region;
  if (state.kind === "loading") el = el.child(muted(label(`${id2}-loading`, "loading…"), theme2));
  if (state.age !== null) el = el.child(muted(label(`${id2}-age`, state.stale ? `${state.age} (may be out of date)` : state.age), theme2));
  if (state.error !== null) el = el.child(label(`${id2}-error`, state.error));
  m.banners.forEach((b, i) => {
    el = el.child(label(`${id2}-banner-${i}`, b));
  });
  let data = v_flex3().id(`${id2}-data`).gap(2).children(body);
  m.unreadable.forEach((u, i) => {
    data = data.child(label(`${id2}-unreadable-${i}`, u));
  });
  if (m.empty !== null) data = data.child(muted(label(`${id2}-empty`, m.empty), theme2));
  return el.child(greyedIf(data, state.stale, theme2));
}
function beadActions(m, activity, theme2, actions) {
  const one = (key, text2, busy, onClick) => busy ? waiting(`gascity-bead-action-${key}`, text2, "under way", theme2) : button(`gascity-bead-action-${key}`, `${text2}${key === "reopen" ? "" : "…"}`, onClick);
  const buttons = m.closed ? [one("reopen", "Reopen", isBusy(activity, beadReopen(m.ref)), (cx) => actions.reopenBead(cx))] : [
    one("sling", "Sling", isBusy(activity, beadSling(m.ref, "")), (cx) => actions.requestSling(cx)),
    one("close", "Close", isBusy(activity, beadClose(m.ref, "")), (cx) => actions.requestCloseBead(cx))
  ];
  return h_flex3().id("gascity-bead-actions").gap(8).children(buttons);
}
function beadDetail(m, theme2, actions, activity) {
  if (m.kind === "none") return null;
  const close = div3().id("gascity-bead-close").on_click((_, cx) => actions.selectBead(null, cx)).child("Close");
  if (m.kind === "missing") return v_flex3().id("gascity-bead-detail").gap(4).child(label("gascity-bead-missing", m.text)).child(close);
  let el = v_flex3().id("gascity-bead-detail").gap(4).child(h_flex3().id("gascity-bead-head").gap(8).child(label("gascity-bead-title", `Bead ${m.id}: "${m.title}"`)).child(close)).child(beadActions(m, activity, theme2, actions)).child(muted(label("gascity-bead-facts", m.facts.map(([k, v]) => `${k}: ${v}`).join(" · ")), theme2));
  if (m.closeReason !== null) el = el.child(label("gascity-bead-reason", `Close reason: ${m.closeReason}`));
  if (m.region.age !== null) el = el.child(muted(label("gascity-bead-age", m.region.stale ? `${m.region.age} (may be out of date)` : m.region.age), theme2));
  if (m.region.error !== null) el = el.child(label("gascity-bead-error", m.region.error));
  let description = v_flex3().id("gascity-bead-description").gap(0);
  if (m.description === null) description = description.child(muted(label("gascity-bead-description-note", m.descriptionNote ?? ""), theme2));
  else description = description.children(m.description.split("\n").map((line, i) => label(`gascity-bead-line-${i}`, line)));
  return el.child(greyedIf(description, m.region.stale, theme2));
}
function renderBoard(m, detail, theme2, actions, activity) {
  const filter = m.hidden > 0 ? `${m.filter} · ${m.hidden} hidden` : m.filter;
  const ready = column("ready", m.ready, m.ready.cards.map((c, i) => card2(c, `gascity-card-ready-${i}`, theme2, actions)), theme2);
  const inProgress = column("inprogress", m.inProgress, m.inProgress.cards.map((c, i) => card2(c, `gascity-card-inprogress-${i}`, theme2, actions)), theme2);
  const closedBody = m.closed.recent.map((c, i) => card2(c, `gascity-card-closed-${i}`, theme2, actions));
  if (m.closed.earlier.length > 0) {
    closedBody.push(muted(label("gascity-col-closed-divider", m.closed.divider), theme2));
    closedBody.push(...m.closed.earlier.map((c, i) => card2(c, `gascity-card-earlier-${i}`, theme2, actions)));
  }
  const closed2 = column("closed", m.closed, closedBody, theme2);
  let el = v_flex3().id("gascity-work").flex_1().gap(6).child(h_flex3().id("gascity-work-head").gap(8).child(label("gascity-work-title", "Work")).child(button("gascity-work-new", "+ New bead", (cx) => actions.openNewBead(cx)))).child(muted(label("gascity-work-filter", filter), theme2)).child(h_flex3().id("gascity-columns").gap(12).child(ready).child(inProgress).child(closed2));
  const d = beadDetail(detail, theme2, actions, activity);
  if (d !== null) el = el.child(d);
  return el;
}

// src/view/detail.ts
import { div as div4 } from "gpui-kit";
import { Input as Input2, h_flex as h_flex4, v_flex as v_flex4 } from "gpui-base";
function pendingText(p) {
  switch (p.kind) {
    case "loading":
      return ["Pending prompt: loading"];
    case "failed":
      return [`Pending prompt: unavailable: ${p.error}`];
    case "unsupported":
      return ["Pending prompt: this session's provider has none"];
    case "none":
      return ["Pending prompt: none"];
    case "prompt":
      return [
        `Pending ${p.promptKind} (request ${p.requestId}): ${p.prompt ?? "(no prompt text)"}`,
        p.options.length > 0 ? "Answer with one of gc's options:" : "gc lists no options for this prompt"
      ];
  }
}
function terminalButton(id2, noTerminal, ctx, theme2, actions) {
  const key = "gascity-action-terminal";
  if (noTerminal !== null) return waiting(key, "Open terminal", noTerminal, theme2);
  if (isBusy(ctx.activity, { kind: "session.attach", target: { kind: "session", id: id2 } })) return waiting(key, "Open terminal", "under way", theme2);
  return button(key, "Open terminal", (cx) => actions.openTerminal(id2, cx));
}
function actionBar(id2, noTerminal, ctx, theme2, actions) {
  const specs = [
    ["wake", sessionWake(id2)],
    ["suspend", sessionSuspend(id2)],
    ["stop", sessionStop(id2)],
    ["pin", sessionPin(id2)],
    ["unpin", sessionUnpin(id2)],
    ["close", sessionClose(id2)]
  ];
  const buttons = specs.map(([key, spec2]) => isBusy(ctx.activity, spec2) ? waiting(`gascity-action-${key}`, spec2.verb, "under way", theme2) : button(`gascity-action-${key}`, spec2.confirm ? `${spec2.verb}…` : spec2.verb, (cx) => actions.act(spec2, cx)));
  const kill = isBusy(ctx.activity, sessionKill(id2, false)) || isBusy(ctx.activity, sessionKill(id2, true)) ? waiting("gascity-action-kill", "Kill", "under way", theme2) : button("gascity-action-kill", "Kill…", (cx) => actions.requestKill(id2, cx));
  return h_flex4().id("gascity-detail-actions").gap(8).children([terminalButton(id2, noTerminal, ctx, theme2, actions), ...buttons, kill]);
}
function answers(p, actions) {
  if (p.kind !== "prompt" || p.options.length === 0) return null;
  const { requestId, options } = p.answer;
  return h_flex4().id("gascity-detail-answers").gap(8).children(options.map((raw, i) => button(`gascity-answer-${i}`, p.options[i] ?? "", (cx) => actions.answer(requestId, raw, cx))));
}
function sendBox(sessionId, canInterrupt, ctx, actions) {
  let row2 = h_flex4().id("gascity-send").gap(8);
  if (ctx.message !== null) row2 = row2.child(Input2.new(ctx.message));
  row2 = row2.child(button("gascity-send-default", "Send", (cx) => actions.send(sessionId, "default", cx)));
  if (canInterrupt) row2 = row2.child(button("gascity-send-interrupt", "Interrupt and send", (cx) => actions.send(sessionId, "interrupt_now", cx)));
  return row2.child(button("gascity-send-message", "Send as message", (cx) => actions.send(sessionId, "message", cx)));
}
function renderDetail(m, theme2, actions, ctx) {
  if (m.kind === "none") return null;
  const close = div4().id("gascity-detail-close").on_click((_, cx) => actions.close(cx)).child("Close");
  if (m.kind === "gone") return v_flex4().id("gascity-detail").gap(4).child(label("gascity-detail-gone", m.text)).child(close);
  let el = v_flex4().id("gascity-detail").gap(4).child(h_flex4().id("gascity-detail-head").gap(8).child(label("gascity-detail-title", `Detail: ${m.title}`)).child(close)).child(label("gascity-detail-status", m.status.detail === null ? m.status.label : `${m.status.label} · ${m.status.detail}`)).child(actionBar(m.ref, m.noTerminal, ctx, theme2, actions)).child(muted(label("gascity-detail-facts", m.facts.map(([k, v]) => `${k}: ${v}`).join(" · ")), theme2)).child(label("gascity-detail-wake", `Wake reasons: ${m.wakeReasons}`));
  pendingText(m.pending).forEach((t, i) => {
    el = el.child(label(`gascity-detail-pending-${i}`, t));
  });
  const answer = answers(m.pending, actions);
  if (answer !== null) el = el.child(answer);
  el = el.child(sendBox(m.ref, m.canInterrupt, ctx, actions));
  const out = m.output;
  let output = v_flex4().id("gascity-detail-output").gap(0);
  if (out.region.age !== null) output = output.child(muted(label("gascity-detail-output-age", `output, ${out.region.age}`), theme2));
  if (out.region.error !== null) output = output.child(label("gascity-detail-output-error", out.region.error));
  if (out.text === null) {
    output = output.child(muted(label("gascity-detail-output-loading", out.region.kind === "failed" ? "no output" : "loading output…"), theme2));
  } else {
    output = output.children(out.text.split("\n").map((line, i) => label(`gascity-detail-line-${i}`, line)));
  }
  return el.child(greyedIf(output, out.region.stale, theme2));
}

// src/view/header.ts
import { div as div5 } from "gpui-kit";
import { h_flex as h_flex5, v_flex as v_flex5 } from "gpui-base";
function renderHeader(h, theme2, actions) {
  const out = [];
  let status2 = h_flex5().id("gascity-status").gap(8).child(label("gascity-chip", h.chip.text));
  if (h.needsYou !== null) status2 = status2.child(label("gascity-needs-you", h.needsYou));
  if (h.age !== null) status2 = status2.child(muted(label("gascity-age", h.age), theme2));
  if (h.canRetry) status2 = status2.child(div5().id("gascity-retry").on_click((_, cx) => actions.retry(cx)).child("Retry now"));
  out.push(status2);
  if (h.endpoint !== null) out.push(muted(label("gascity-endpoint", h.endpoint), theme2));
  if (h.city !== null) out.push(label("gascity-city", `City: ${h.city}`));
  h.banners.forEach((text2, i) => out.push(label(`gascity-banner-${i}`, text2)));
  if (h.others.length > 0) {
    const others = h.others.map((o) => `${o.name} (${o.label})`).join(", ");
    out.push(muted(label("gascity-others", `Other cities: ${others}`), theme2));
  }
  if (h.choices !== null && h.choices.length > 0) {
    const heading = h.city === null ? "Choose a city:" : "Switch to:";
    const list = v_flex5().id("gascity-choices").gap(4).child(label("gascity-choices-heading", heading));
    out.push(list.children(h.choices.map((c, i) => label(`gascity-choose-${i}`, `${c.name} (${c.label})`).on_click((_, cx) => actions.select(c.name, cx)))));
  }
  if (h.diagnostics.length > 0) {
    const lines = h.diagnostics.map((line, i) => muted(label(`gascity-diagnostic-${i}`, line), theme2));
    out.push(v_flex5().id("gascity-diagnostics").gap(2).child(label("gascity-diagnostics-heading", "Discovery:")).children(lines));
  }
  return out;
}

// src/view/needsYou.ts
import { h_flex as h_flex6, v_flex as v_flex6 } from "gpui-base";
function renderWindowHead(m, theme2, actions) {
  const target = m.target === null ? muted(label("gascity-window-target", "No toast to follow: pick a session below."), theme2) : label("gascity-window-target", `Needs you: session ${m.target.session} in city ${m.target.city}`);
  const tabs = m.tabs.length === 1 ? [button("gascity-window-tab-0", "Show Gas City tab", (cx) => actions.showTab(m.tabs[0] ?? "", cx))] : m.tabs.map((t, i) => button(`gascity-window-tab-${i}`, `Show Gas City tab ${t}`, (cx) => actions.showTab(t, cx)));
  const bar = h_flex6().id("gascity-window-bar").gap(8).children([...tabs, button("gascity-window-close", "Close", (cx) => actions.closeWindow(cx))]);
  const list = m.pending.length === 0 ? muted(label("gascity-window-none", "No session needs you right now."), theme2) : v_flex6().id("gascity-window-pending").gap(2).children(m.pending.map((p, i) => label(`gascity-window-pending-${i}`, `${p.label} (session ${p.session}): ${p.kind}`).on_click((_, cx) => actions.selectSession(p.session, cx))));
  let el = v_flex6().id("gascity-window").gap(6).child(target);
  if (m.next !== null) {
    el = el.child(h_flex6().id("gascity-window-next").gap(8).child(label("gascity-window-next-text", `Session ${m.next.session} in city ${m.next.city} needs you too.`)).child(button("gascity-window-next-show", "Show", (cx) => actions.showNext(cx))));
  }
  return el.child(bar).child(list);
}

// src/view/panel.ts
var TITLE = "Gas City";
function hostIncompatibleText(missing) {
  return `This herdr-app is too old for the Gas City mod: it lacks ${missing.join(", ")}.`;
}
function copyInvalidText(error) {
  return `This copy of the Gas City mod was opened with props it cannot read: ${error}`;
}
function themeIssues(el, theme2) {
  return el.when(theme2.issues.length > 0, (e) => e.child(label("gascity-host-decode", theme2.issues.join("; "))));
}
function diagnostics(model) {
  const { view, theme: theme2, actions } = model;
  if (view.diagnostics.length === 0) return null;
  const toggle = div6().id("gascity-diagnostics-toggle").on_click((_, cx) => actions.toggleDiagnostics(cx)).child(`${view.diagnosticsOpen ? "Hide" : "Show"} diagnostics (${view.diagnostics.length})`);
  if (!view.diagnosticsOpen) return toggle;
  const lines = view.diagnostics.map((d, i) => muted(label(`gascity-diag-${i}`, `${d.at ?? ""} ${d.source}: ${d.text}`.trim()), theme2));
  return v_flex7().id("gascity-diagnostics-drawer").gap(2).child(toggle).children(lines);
}
function renderPanel(model) {
  const title = div6().id("gascity-title").text_size(16).font_semibold().child(TITLE);
  if (model.kind === "host-incompatible") {
    const root2 = v_flex7().id("gascity-root").size_full().p(12).gap(8);
    return root2.child(title).child(label("gascity-host-incompatible", hostIncompatibleText(model.missing)));
  }
  let root = themedRoot(model.theme, v_flex7().id("gascity-root").size_full().p(12).gap(8)).child(title);
  if (model.kind === "copy-invalid") {
    return themeIssues(root.child(label("gascity-copy-invalid", copyInvalidText(model.error))), model.theme);
  }
  const { view, theme: theme2, actions, inputs, keyboard } = model;
  if (keyboard !== null) root = root.track_focus(keyboard.handle).on_key_down((e, cx) => keyboard.onKey(e, cx));
  root = root.children(renderHeader(view.header, theme2, actions));
  const dialog = renderDialog(view.dialog, theme2, actions, inputs);
  if (dialog !== null) root = root.child(dialog);
  const notice = renderNotice(view.notice);
  if (notice !== null) root = root.child(notice);
  if (view.window !== null) {
    root = root.child(renderWindowHead(view.window, theme2, actions));
    const d = renderDetail(view.detail, theme2, actions, { activity: view.activity, message: inputs?.message ?? null });
    if (d !== null) root = root.child(d);
    const log = renderActivity(view.activity, theme2, actions);
    if (log !== null) root = root.child(log);
    return themeIssues(root, theme2);
  }
  const regions = [];
  if (view.agents !== null) regions.push(div6().id("gascity-agents-region").flex_1().child(renderAgents(view.agents, theme2, actions, view.activity)));
  if (view.board !== null) regions.push(renderBoard(view.board, view.beadDetail, theme2, actions, view.activity));
  if (regions.length > 0) root = root.child(h_flex7().id("gascity-main").gap(12).children(regions));
  const detail = renderDetail(view.detail, theme2, actions, { activity: view.activity, message: inputs?.message ?? null });
  if (detail !== null) root = root.child(detail);
  const activity = renderActivity(view.activity, theme2, actions);
  if (activity !== null) root = root.child(activity);
  const diag = diagnostics(model);
  if (diag !== null) root = root.child(diag);
  return themeIssues(root, theme2);
}

// src/main.ts
function registry2() {
  return sharedRegistry(() => new SyncRegistry({
    fetch: hostFetch,
    onError: (key, entry) => logError(`gascity: ${key.city}: ${entry.source}: ${syncErrorText(entry.error)}`),
    onNeedsYou: postNeedsYou
  }));
}
function visibility() {
  return sharedVisibilityCache(() => new VisibilityCache(readVisibility));
}
function taskOf(task) {
  return { notify: () => task.notify(), sleep: (ms) => task.sleep(ms) };
}
function setUp() {
  const missing = missingHostExports();
  if (missing.length > 0) return { kind: "host-incompatible", missing };
  const last = readLastCity();
  const props2 = readProps();
  const decoded = decodeCopy(props2, last.ok ? last.value : null);
  if (!decoded.ok) return { kind: "copy-invalid", error: errorText(decoded.error) };
  const reg = registry2();
  const discovery = new DiscoveryController({
    settings: readSharedSettings,
    gcStatus: execGcStatus,
    readSupervisorConfig,
    fetch: reg.probeFetch().fetch,
    probeFetch: () => reg.probeFetch(),
    rememberCity
  }, decoded.value);
  if (!last.ok) discovery.hostErrors.push(last.error);
  const overlay = overlayOf(props2);
  const focus = { handle: null };
  const drafts = { any: () => false };
  const copy = new CopyController({
    registry: reg,
    discovery,
    host: {
      visibility: () => visibility().get(systemClock.now()),
      probeEnabled: readProbeEnabled,
      setProbe: setProbeEnabled,
      herdrVersion: readHerdrVersion,
      execLog: readExecLog,
      keyboard: () => focus.handle?.is_focused() ?? false,
      focusTarget: readFocusTarget,
      terminal: { scene: readTerminalScene, openTab: openAttachTab, selectTab }
    },
    clock: systemClock,
    probe: sharedProbeWriter(() => new ProbeWriter(probeIo)),
    window: overlay !== null,
    commands: sharedCommandBook(),
    draft: () => drafts.any()
  });
  return { kind: "ready", copy, overlay, focus, box: { typedFor: null }, drafts };
}
function beadForm(inputs) {
  return {
    title: inputs.beadTitle.value(),
    description: inputs.beadDescription.value(),
    priority: inputs.beadPriority.value(),
    labels: inputs.beadLabels.value()
  };
}
function createBead2(copy, inputs) {
  if (!copy.createBead(beadForm(inputs))) return;
  for (const i of [inputs.beadTitle, inputs.beadDescription, inputs.beadPriority, inputs.beadLabels]) i.set_value("");
}
function closeBead2(copy, inputs) {
  if (copy.closeBead(inputs.closeReason.value())) inputs.closeReason.set_value("");
}
function clearBox(message, box) {
  message.set_value("");
  box.typedFor = null;
}
function inputsFor(copy, box) {
  const message = InputState.new({ placeholder: "Message to the session" });
  const alias = InputState.new({ placeholder: "alias (optional)" });
  const beadTitle = InputState.new({ placeholder: "title (required)" });
  const beadDescription = InputState.new({ placeholder: "description (optional)" });
  const beadPriority = InputState.new({ placeholder: "priority, e.g. 2 (optional)" });
  const beadLabels = InputState.new({ placeholder: "labels, comma-separated (optional)" });
  const closeReason = InputState.new({ placeholder: "close reason (optional)" });
  message.on("change", () => {
    if (message.value().trim() === "") box.typedFor = null;
    else box.typedFor ??= copy.selectedSession();
  });
  message.on("submit", (_, cx) => {
    if (copy.sendInputTo(copy.openSession(), message.value(), "default", box.typedFor)) clearBox(message, box);
    cx.notify();
  });
  alias.on("submit", (_, cx) => {
    if (copy.createSession(alias.value())) alias.set_value("");
    cx.notify();
  });
  const inputs = { message, alias, beadTitle, beadDescription, beadPriority, beadLabels, closeReason };
  beadTitle.on("submit", (_, cx) => {
    createBead2(copy, inputs);
    cx.notify();
  });
  closeReason.on("submit", (_, cx) => {
    closeBead2(copy, inputs);
    cx.notify();
  });
  return inputs;
}
function uiFor(state, inputs, cx) {
  return {
    focusKeyboard: () => {
      if (state.focus.handle === null) return false;
      state.focus.handle.focus();
      return true;
    },
    retry: () => {
      cx.spawn((task) => state.copy.retry(taskOf(task)));
    },
    closeReason: (reason) => inputs?.closeReason.set_value(reason),
    beadTitle: (title) => inputs?.beadTitle.set_value(title)
  };
}
function actionsFor(state, inputs) {
  const copy = state.copy;
  return {
    showTab: (tab, cx) => {
      const shown = selectTab(tab);
      if (!shown.ok) logError(`gascity: ${errorText(shown.error)}`);
      cx.notify();
    },
    showNext: (cx) => {
      copy.showNext();
      cx.notify();
    },
    closeWindow: (cx) => {
      if (state.overlay !== null) closeWindow(state.overlay);
      cx.notify();
    },
    retry: (cx) => {
      cx.spawn((task) => copy.retry(taskOf(task)));
      cx.notify();
    },
    select: (city, cx) => {
      copy.selectCity(city);
      cx.notify();
    },
    selectSession: (id2, cx) => {
      copy.selectSession(id2);
      cx.notify();
    },
    selectBead: (id2, cx) => {
      copy.selectBead(id2);
      cx.notify();
    },
    toggleGroup: (key, cx) => {
      copy.toggleGroup(key);
      cx.notify();
    },
    close: (cx) => {
      copy.selectSession(null);
      cx.notify();
    },
    toggleDiagnostics: (cx) => {
      copy.toggleDiagnostics();
      cx.notify();
    },
    act: (spec2, cx) => {
      copy.request(spec2);
      cx.notify();
    },
    requestKill: (sessionId, cx) => {
      copy.requestKill(sessionId);
      cx.notify();
    },
    openTerminal: (sessionId, cx) => {
      copy.openTerminal(sessionId);
      cx.notify();
    },
    send: (sessionId, mode, cx) => {
      if (inputs !== null && copy.sendInputTo(sessionId, inputs.message.value(), mode, state.box.typedFor)) clearBox(inputs.message, state.box);
      cx.notify();
    },
    answer: (requestId, option, cx) => {
      copy.answer(requestId, option);
      cx.notify();
    },
    openNewSession: (agent, cx) => {
      copy.openNewSession(agent);
      cx.notify();
    },
    createSession: (cx) => {
      if (inputs !== null && copy.createSession(inputs.alias.value())) inputs.alias.set_value("");
      cx.notify();
    },
    openNewBead: (cx) => {
      copy.openNewBead();
      cx.notify();
    },
    chooseSlingTarget: (index, cx) => {
      copy.chooseSlingTarget(index);
      cx.notify();
    },
    createBead: (cx) => {
      if (inputs !== null) createBead2(copy, inputs);
      cx.notify();
    },
    requestSling: (cx) => {
      copy.requestSling();
      cx.notify();
    },
    requestCloseBead: (cx) => {
      copy.requestCloseBead();
      cx.notify();
    },
    closeBead: (cx) => {
      if (inputs !== null) closeBead2(copy, inputs);
      cx.notify();
    },
    reopenBead: (cx) => {
      copy.reopenBead();
      cx.notify();
    },
    confirm: (choice, cx) => {
      copy.confirm(choice);
      cx.notify();
    },
    cancelDialog: (cx) => {
      copy.cancelDialog();
      cx.notify();
    },
    retryAction: (id2, cx) => {
      copy.retryAction(id2);
      cx.notify();
    },
    refreshAction: (id2, cx) => {
      copy.refreshAction(id2);
      cx.notify();
    }
  };
}
var GasCity = class extends View {
  state = { kind: "copy-invalid", error: "init has not run" };
  inputs = null;
  init(_props, cx) {
    this.state = setUp();
    const state = this.state;
    if (state.kind !== "ready") return;
    const inputs = inputsFor(state.copy, state.box);
    this.inputs = inputs;
    const boxes = [inputs.message, inputs.alias, inputs.beadTitle, inputs.beadDescription, inputs.beadPriority, inputs.beadLabels, inputs.closeReason];
    state.drafts.any = () => boxes.some((b) => b.value().trim() !== "");
    if (typeof cx.focus_handle === "function") state.focus.handle = cx.focus_handle();
    if (state.overlay !== null) {
      setWindowOpen(true);
      visibility().invalidate();
    }
    cx.spawn((task) => state.copy.discover(taskOf(task)));
    let flagged = systemClock.now();
    cx.timer.every(TICK_MS, (tcx) => {
      if (state.overlay !== null && systemClock.now() - flagged >= WINDOW_REFRESH_MS) {
        flagged = systemClock.now();
        setWindowOpen(true);
      }
      if (state.copy.tick((body) => tcx.spawn((task) => body(taskOf(task))))) tcx.notify();
    });
    cx.spawn(async (task) => {
      for (; ; ) {
        const command = await nextCommand2();
        try {
          state.copy.runCommand(command, uiFor(state, inputs, task));
        } catch (cause) {
          logError(`gascity: command ${JSON.stringify(command.slice(0, 80))} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        task.notify();
      }
    });
  }
  close(_cx) {
    if (this.state.kind !== "ready") return;
    this.state.copy.close();
    if (this.state.overlay !== null) {
      setWindowOpen(false);
      visibility().invalidate();
    }
  }
  /** The root's keyboard: keys call the same copy methods as the buttons. */
  keyboard(state) {
    const handle = state.focus.handle;
    if (handle === null) return null;
    const inputs = this.inputs;
    return {
      handle,
      onKey: (event, cx) => {
        if (!handle.is_focused()) return;
        const action = keyAction(event.keystroke);
        if (action !== null && state.copy.key(action, uiFor(state, inputs, cx))) cx.notify();
      }
    };
  }
  render(_cx) {
    visibility().invalidate();
    const state = this.state;
    if (state.kind === "host-incompatible") return renderPanel({ kind: "host-incompatible", missing: state.missing });
    const theme2 = readTheme();
    if (state.kind === "copy-invalid") return renderPanel({ kind: "copy-invalid", theme: theme2, error: state.error });
    const view = state.copy.view(systemClock.now());
    return renderPanel({
      kind: "city",
      theme: theme2,
      view,
      actions: actionsFor(state, this.inputs),
      inputs: this.inputs,
      keyboard: this.keyboard(state)
    });
  }
};
export {
  GasCity as default
};

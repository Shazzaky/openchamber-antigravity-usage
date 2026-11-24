// service/main.ts
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late",
  "microphone-audio",
  "microphone-ended"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_PATH = "/quota";
var QUOTA_PROVIDER_WIRE_VERSION = 1;
var QUOTA_PROVIDER_METHODS = ["usage.read"];
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
var isQuotaProviderMethod = (value) => QUOTA_PROVIDER_METHODS.some((method) => method === value);
var readQuotaProviderRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, method, provider, input } = wire;
  if (v !== QUOTA_PROVIDER_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (String(provider) !== provider || provider.length === 0)
    return null;
  if (String(method) !== method || !isQuotaProviderMethod(method))
    return null;
  if (Object(input) !== input || input === null || input === undefined || Array.isArray(input))
    return null;
  const { credentials } = input;
  if (Object(credentials) !== credentials || credentials === null || Array.isArray(credentials))
    return null;
  if (Object.values(Object(credentials)).some((credential) => Object(credential) !== credential || credential === null || Array.isArray(credential)))
    return null;
  return { v: QUOTA_PROVIDER_WIRE_VERSION, requestId, method, provider, input: { credentials } };
};
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// service/main.ts
var execFileAsync = promisify(execFile);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var agy = process.env.ANTIGRAVITY_USAGE_AGY?.trim() || "agy";
var FIVE_HOURS = 5 * 60 * 60;
var WEEK = 7 * 24 * 60 * 60;
var READ_TIMEOUT_MS = 19000;
var CACHE_TTL_MS = 10 * 60000;
var ERROR_CACHE_TTL_MS = 30000;
var windowSeconds = (name) => name === "weekly" ? WEEK : FIVE_HOURS;
var usedPercentOf = (remainingFraction) => {
  const fraction = Number(remainingFraction);
  if (!Number.isFinite(fraction))
    return null;
  const remainingPercent = Math.round(fraction * 100);
  return Math.max(0, Math.min(100, 100 - remainingPercent));
};
var resetAtOf = (value) => {
  if (typeof value !== "string")
    return;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
var normalizeWindow = (value) => {
  if (value === "weekly" || value === "5h")
    return value;
  if (value === "7d")
    return "weekly";
  return null;
};
var groupsFromUsageCommand = (value) => {
  if (!value || typeof value !== "object")
    return [];
  const groups = value.groups;
  if (!Array.isArray(groups))
    return [];
  const result = [];
  for (const group of groups) {
    if (!group || typeof group !== "object")
      continue;
    const fields = group;
    const name = typeof fields.name === "string" && fields.name.trim() ? fields.name.trim() : "Antigravity";
    const buckets = Array.isArray(fields.buckets) ? fields.buckets : [];
    const windows = {};
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== "object")
        continue;
      const bucketFields = bucket;
      const windowName = normalizeWindow(bucketFields.window);
      const usedPercent = usedPercentOf(bucketFields.remaining_fraction);
      if (!windowName || usedPercent === null)
        continue;
      const resetAt = resetAtOf(bucketFields.reset_time);
      windows[windowName] = {
        usedPercent,
        windowSeconds: windowSeconds(windowName),
        ...resetAt === undefined ? {} : { resetAt }
      };
    }
    if (Object.keys(windows).length > 0)
      result.push({ name, windows });
  }
  return result;
};
var groupsFromText = (value) => {
  if (typeof value !== "string")
    return [];
  const groups = new Map;
  for (const line of value.split(/\r?\n/)) {
    const [group, label, percent, reset] = line.split("\t").map((part) => part.trim());
    if (!group || !label)
      continue;
    const windowName = /weekly/i.test(label) ? "weekly" : /five hour|5h/i.test(label) ? "5h" : null;
    if (!windowName)
      continue;
    const parsedPercent = Number.parseFloat((percent ?? "").replace("%", ""));
    if (!Number.isFinite(parsedPercent))
      continue;
    const resetAt = resetAtOf(reset);
    const windows = groups.get(group) ?? {};
    windows[windowName] = {
      usedPercent: Math.max(0, Math.min(100, 100 - parsedPercent)),
      windowSeconds: windowSeconds(windowName),
      ...resetAt === undefined ? {} : { resetAt }
    };
    groups.set(group, windows);
  }
  return [...groups].map(([name, windows]) => ({ name, windows }));
};
var readGroups = async () => {
  const environment = { ...process.env };
  delete environment.OPENCHAMBER_SERVICE_TOKEN;
  const { stdout } = await execFileAsync(agy, ["-p", "/usage", "--output-format", "json"], {
    timeout: READ_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: environment
  });
  const parsed = JSON.parse(stdout);
  return groupsFromUsageCommand(parsed.command?.data).length > 0 ? groupsFromUsageCommand(parsed.command?.data) : groupsFromText(parsed.response);
};
var messageOf = (error) => {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
};
var readUsageUncached = async () => {
  try {
    const groups = await readGroups();
    const gemini = groups.find((group) => /gemini/i.test(group.name));
    if (!gemini) {
      return {
        ok: false,
        configured: true,
        error: "Antigravity /usage returned no Gemini quota group. Is `agy` signed in?",
        usage: null
      };
    }
    const windows = {};
    for (const name of ["5h", "weekly"]) {
      const window2 = gemini.windows[name];
      if (window2)
        windows[name] = window2;
    }
    for (const [name, window2] of Object.entries(gemini.windows)) {
      if (!(name in windows))
        windows[name] = window2;
    }
    return {
      ok: true,
      configured: true,
      usage: { windows }
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: `Antigravity /usage failed: ${messageOf(error)}`,
      usage: null
    };
  }
};
var cached = null;
var pending = null;
var readUsage = async () => {
  const now = Date.now();
  if (cached && now - cached.at < (cached.data.ok ? CACHE_TTL_MS : ERROR_CACHE_TTL_MS)) {
    return cached.data;
  }
  if (pending)
    return pending;
  pending = readUsageUncached().then((data) => {
    cached = { at: Date.now(), data };
    return data;
  }).finally(() => {
    pending = null;
  });
  return pending;
};
var server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/health") {
    res.writeHead(200).end("{}");
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (path !== QUOTA_PROVIDER_PATH || req.method !== "POST") {
      res.writeHead(404).end("{}");
      return;
    }
    const request = readQuotaProviderRequest(body);
    if (!request || request.method !== "usage.read") {
      res.writeHead(400).end("{}");
      return;
    }
    readUsage().then((data) => {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, data }));
    });
  });
});
server.listen(port, "127.0.0.1");
var stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

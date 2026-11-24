import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { QUOTA_PROVIDER_PATH, readQuotaProviderRequest } from '@openchamber/sdk';

const execFileAsync = promisify(execFile);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const agy = process.env.ANTIGRAVITY_USAGE_AGY?.trim() || 'agy';

const FIVE_HOURS = 5 * 60 * 60;
const WEEK = 7 * 24 * 60 * 60;
const READ_TIMEOUT_MS = 19_000;
// The CLI's /usage refreshes from the backend on every run. OpenChamber
// refreshes visible usage every three minutes; a ten-minute cache keeps
// automated calls to a handful per hour instead of one per refresh.
const CACHE_TTL_MS = 10 * 60_000;
const ERROR_CACHE_TTL_MS = 30_000;

type Window = {
  usedPercent: number;
  windowSeconds: number;
  resetAt?: number;
};

type Group = {
  name: string;
  windows: Record<string, Window>;
};

const windowSeconds = (name: string): number => (name === 'weekly' ? WEEK : FIVE_HOURS);

const usedPercentOf = (remainingFraction: unknown): number | null => {
  const fraction = Number(remainingFraction);
  if (!Number.isFinite(fraction)) return null;
  const remainingPercent = Math.round(fraction * 100);
  return Math.max(0, Math.min(100, 100 - remainingPercent));
};

const resetAtOf = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeWindow = (value: unknown): string | null => {
  if (value === 'weekly' || value === '5h') return value;
  if (value === '7d') return 'weekly';
  return null;
};

const groupsFromUsageCommand = (value: unknown): Group[] => {
  if (!value || typeof value !== 'object') return [];
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  const result: Group[] = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const fields = group as { name?: unknown; buckets?: unknown };
    const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : 'Antigravity';
    const buckets = Array.isArray(fields.buckets) ? fields.buckets : [];
    const windows: Record<string, Window> = {};
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== 'object') continue;
      const bucketFields = bucket as { window?: unknown; remaining_fraction?: unknown; reset_time?: unknown };
      const windowName = normalizeWindow(bucketFields.window);
      const usedPercent = usedPercentOf(bucketFields.remaining_fraction);
      if (!windowName || usedPercent === null) continue;
      const resetAt = resetAtOf(bucketFields.reset_time);
      windows[windowName] = {
        usedPercent,
        windowSeconds: windowSeconds(windowName),
        ...(resetAt === undefined ? {} : { resetAt }),
      };
    }
    if (Object.keys(windows).length > 0) result.push({ name, windows });
  }
  return result;
};

/** Fallback for a CLI that answers /usage as tab-separated text. */
const groupsFromText = (value: unknown): Group[] => {
  if (typeof value !== 'string') return [];
  const groups = new Map<string, Record<string, Window>>();
  for (const line of value.split(/\r?\n/)) {
    const [group, label, percent, reset] = line.split('\t').map((part) => part.trim());
    if (!group || !label) continue;
    const windowName = /weekly/i.test(label) ? 'weekly' : /five hour|5h/i.test(label) ? '5h' : null;
    if (!windowName) continue;
    const parsedPercent = Number.parseFloat((percent ?? '').replace('%', ''));
    if (!Number.isFinite(parsedPercent)) continue;
    const resetAt = resetAtOf(reset);
    const windows = groups.get(group) ?? {};
    windows[windowName] = {
      usedPercent: Math.max(0, Math.min(100, 100 - parsedPercent)),
      windowSeconds: windowSeconds(windowName),
      ...(resetAt === undefined ? {} : { resetAt }),
    };
    groups.set(group, windows);
  }
  return [...groups].map(([name, windows]) => ({ name, windows }));
};

const readGroups = async (): Promise<Group[]> => {
  const environment = { ...process.env };
  delete environment.OPENCHAMBER_SERVICE_TOKEN;
  const { stdout } = await execFileAsync(agy, ['-p', '/usage', '--output-format', 'json'], {
    timeout: READ_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: environment,
  });
  const parsed = JSON.parse(stdout) as { command?: { data?: unknown }; response?: unknown };
  return groupsFromUsageCommand(parsed.command?.data).length > 0
    ? groupsFromUsageCommand(parsed.command?.data)
    : groupsFromText(parsed.response);
};

const messageOf = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
};

type UsageResult = {
  ok: boolean;
  configured: boolean;
  error?: string;
  usage: { windows: Record<string, Window> } | null;
};

const readUsageUncached = async (): Promise<UsageResult> => {
  try {
    const groups = await readGroups();
    const gemini = groups.find((group) => /gemini/i.test(group.name));
    if (!gemini) {
      return {
        ok: false,
        configured: true,
        error: 'Antigravity /usage returned no Gemini quota group. Is `agy` signed in?',
        usage: null,
      };
    }
    const windows: Record<string, Window> = {};
    for (const name of ['5h', 'weekly']) {
      const window = gemini.windows[name];
      if (window) windows[name] = window;
    }
    for (const [name, window] of Object.entries(gemini.windows)) {
      if (!(name in windows)) windows[name] = window;
    }
    return {
      ok: true,
      configured: true,
      usage: { windows },
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: `Antigravity /usage failed: ${messageOf(error)}`,
      usage: null,
    };
  }
};

let cached: { at: number; data: UsageResult } | null = null;
let pending: Promise<UsageResult> | null = null;

const readUsage = async (): Promise<UsageResult> => {
  const now = Date.now();
  if (cached && now - cached.at < (cached.data.ok ? CACHE_TTL_MS : ERROR_CACHE_TTL_MS)) {
    return cached.data;
  }
  if (pending) return pending;
  pending = readUsageUncached()
    .then((data) => {
      cached = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
};

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/health') {
    res.writeHead(200).end('{}');
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    if (path !== QUOTA_PROVIDER_PATH || req.method !== 'POST') {
      res.writeHead(404).end('{}');
      return;
    }
    const request = readQuotaProviderRequest(body);
    if (!request || request.method !== 'usage.read') {
      res.writeHead(400).end('{}');
      return;
    }
    readUsage().then((data) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, data }));
    });
  });
});

server.listen(port, '127.0.0.1');

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

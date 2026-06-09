import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Lightweight "a newer version is on npm" reminder. Designed to never block or
 * break a session: the cache read is synchronous so the banner is instant, the
 * network refresh runs in the background for the *next* session, and every step
 * is fail-silent (offline, registry hiccups, malformed JSON → no reminder).
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, e.g. `beta.1` → `['beta', '1']`. */
  prerelease: string[];
}

/** Parse `major.minor.patch[-prerelease]`, ignoring build metadata. */
export function parseVersion(v: string): SemVer | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

/** Compare pre-release identifiers per semver: a release outranks a pre-release. */
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // 1.0.0 > 1.0.0-beta
  if (b.length === 0) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return Math.sign(d);
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers rank below alphanumeric
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return Math.sign(a.length - b.length);
}

/** Total ordering on versions: <0, 0, or >0. Unparseable inputs compare equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return Math.sign(pa.major - pb.major);
  if (pa.minor !== pb.minor) return Math.sign(pa.minor - pb.minor);
  if (pa.patch !== pb.patch) return Math.sign(pa.patch - pb.patch);
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True when `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

export interface UpdateNotice {
  name: string;
  current: string;
  latest: string;
}

/** Human-readable, one-line reminder for the session banner. */
export function formatUpdateNotice(notice: UpdateNotice): string {
  return (
    `⬆ Update available: ${notice.name} ${notice.current} → ${notice.latest}. ` +
    `Run \`npm install -g ${notice.name}@latest\` to update.`
  );
}

const REGISTRY = 'https://registry.npmjs.org';

/**
 * Fetch the version behind a package's `latest` dist-tag. Returns null on any
 * failure (timeout, non-200, offline, bad JSON) — callers must not depend on it.
 */
export async function fetchLatestVersion(
  pkgName: string,
  opts: {
    timeoutMs?: number | undefined;
    fetchImpl?: typeof fetch | undefined;
    registry?: string | undefined;
  } = {},
): Promise<string | null> {
  const { timeoutMs = 2000, fetchImpl = fetch, registry = REGISTRY } = opts;
  // Scoped packages need the leading slash percent-encoded.
  const url = `${registry}/${pkgName.replace('/', '%2F')}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface UpdateCache {
  latest: string;
  checkedAt: number;
}

/** Re-use the existing tiny-code config home for the cache file. */
export function defaultCacheFile(): string {
  return join(homedir(), '.config', 'tiny-code', 'update-check.json');
}

function readCache(file: string): UpdateCache | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<UpdateCache>;
    if (typeof data.latest === 'string' && typeof data.checkedAt === 'number') {
      return { latest: data.latest, checkedAt: data.checkedAt };
    }
  } catch {
    /* missing or malformed cache → treat as absent */
  }
  return null;
}

function writeCache(file: string, cache: UpdateCache): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache));
  } catch {
    /* a non-writable cache dir must not break the session */
  }
}

function noticeFrom(name: string, current: string, latest: string): UpdateNotice | null {
  return isNewerVersion(latest, current) ? { name, current, latest } : null;
}

/** How long a cached check is trusted before a background refresh (12 hours). */
export const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export interface UpdateCheckOptions {
  name: string;
  version: string;
  cacheFile?: string;
  now?: number;
  ttlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  registry?: string;
}

/**
 * Synchronous reminder for *this* session, derived from the cached latest
 * version. No network — instant, so it's safe on the startup path.
 */
export function getUpdateNotice(opts: UpdateCheckOptions): UpdateNotice | null {
  const cached = readCache(opts.cacheFile ?? defaultCacheFile());
  return cached ? noticeFrom(opts.name, opts.version, cached.latest) : null;
}

/**
 * Refresh the cached latest version if it's missing or older than the TTL.
 * Meant to run fire-and-forget so the reminder appears on the *next* session;
 * always resolves (never rejects) and returns the freshest known notice.
 */
export async function maybeRefreshUpdateCache(opts: UpdateCheckOptions): Promise<UpdateNotice | null> {
  const {
    name,
    version,
    cacheFile = defaultCacheFile(),
    now = Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs,
    fetchImpl,
    registry,
  } = opts;

  const cached = readCache(cacheFile);
  if (cached && now - cached.checkedAt < ttlMs) {
    return noticeFrom(name, version, cached.latest);
  }

  const latest = await fetchLatestVersion(name, { timeoutMs, fetchImpl, registry });
  if (!latest) {
    return cached ? noticeFrom(name, version, cached.latest) : null;
  }
  writeCache(cacheFile, { latest, checkedAt: now });
  return noticeFrom(name, version, latest);
}

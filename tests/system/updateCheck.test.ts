import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNewerVersion,
  compareVersions,
  parseVersion,
  formatUpdateNotice,
  fetchLatestVersion,
  getUpdateNotice,
  maybeRefreshUpdateCache,
} from '../../src/system/updateCheck.js';

describe('version parsing and comparison', () => {
  it('parses major.minor.patch and pre-release', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('v0.2.0')).toMatchObject({ major: 0, minor: 2, patch: 0 });
    expect(parseVersion('1.0.0-beta.1')).toMatchObject({ prerelease: ['beta', '1'] });
    expect(parseVersion('not-a-version')).toBeNull();
  });

  it('orders releases above pre-releases of the same version', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('detects a strictly newer version', () => {
    expect(isNewerVersion('0.3.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.2.1', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false);
  });
});

describe('formatUpdateNotice', () => {
  it('mentions both versions and the upgrade command', () => {
    const msg = formatUpdateNotice({ name: '@therr/tiny-code', current: '0.2.0', latest: '0.3.0' });
    expect(msg).toContain('0.2.0');
    expect(msg).toContain('0.3.0');
    expect(msg).toContain('npm install -g @therr/tiny-code@latest');
  });
});

describe('fetchLatestVersion', () => {
  it('returns the version from the registry latest manifest', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion('@therr/tiny-code', { fetchImpl })).toBe('9.9.9');
  });

  it('encodes the scope slash in the request URL', async () => {
    let requested = '';
    const fetchImpl = (async (url: string) => {
      requested = url;
      return new Response(JSON.stringify({ version: '1.0.0' }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchLatestVersion('@therr/tiny-code', { fetchImpl });
    expect(requested).toContain('@therr%2Ftiny-code/latest');
  });

  it('returns null on non-200, bad JSON, or network error', async () => {
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion('pkg', { fetchImpl: notFound })).toBeNull();

    const throws = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLatestVersion('pkg', { fetchImpl: throws })).toBeNull();
  });
});

describe('cache-backed update checks', () => {
  let dir: string;
  let cacheFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tiny-update-'));
    cacheFile = join(dir, 'update-check.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns no notice when there is no cache', () => {
    expect(getUpdateNotice({ name: 'pkg', version: '0.2.0', cacheFile })).toBeNull();
  });

  it('reports a notice from a cached newer version', () => {
    writeFileSync(cacheFile, JSON.stringify({ latest: '0.3.0', checkedAt: 0 }));
    expect(getUpdateNotice({ name: 'pkg', version: '0.2.0', cacheFile })).toEqual({
      name: 'pkg',
      current: '0.2.0',
      latest: '0.3.0',
    });
  });

  it('reports no notice when the cached version is not newer', () => {
    writeFileSync(cacheFile, JSON.stringify({ latest: '0.2.0', checkedAt: 0 }));
    expect(getUpdateNotice({ name: 'pkg', version: '0.2.0', cacheFile })).toBeNull();
  });

  it('ignores a malformed cache file', () => {
    writeFileSync(cacheFile, 'not json');
    expect(getUpdateNotice({ name: 'pkg', version: '0.2.0', cacheFile })).toBeNull();
  });

  it('fetches and writes the cache when none exists', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ version: '0.5.0' }), { status: 200 })) as unknown as typeof fetch;
    const notice = await maybeRefreshUpdateCache({
      name: 'pkg',
      version: '0.2.0',
      cacheFile,
      now: 1000,
      fetchImpl,
    });
    expect(notice).toMatchObject({ latest: '0.5.0' });
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toEqual({ latest: '0.5.0', checkedAt: 1000 });
  });

  it('skips the network while the cache is still fresh', async () => {
    writeFileSync(cacheFile, JSON.stringify({ latest: '0.3.0', checkedAt: 1000 }));
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(JSON.stringify({ version: '0.9.0' }), { status: 200 });
    }) as unknown as typeof fetch;
    const notice = await maybeRefreshUpdateCache({
      name: 'pkg',
      version: '0.2.0',
      cacheFile,
      now: 1000 + 60_000, // within TTL
      ttlMs: 12 * 60 * 60 * 1000,
      fetchImpl,
    });
    expect(called).toBe(false);
    expect(notice).toMatchObject({ latest: '0.3.0' });
  });

  it('refreshes once the cache is stale', async () => {
    writeFileSync(cacheFile, JSON.stringify({ latest: '0.3.0', checkedAt: 0 }));
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 })) as unknown as typeof fetch;
    const notice = await maybeRefreshUpdateCache({
      name: 'pkg',
      version: '0.2.0',
      cacheFile,
      now: 100 * 60 * 60 * 1000, // well past TTL
      ttlMs: 12 * 60 * 60 * 1000,
      fetchImpl,
    });
    expect(notice).toMatchObject({ latest: '0.4.0' });
    expect(JSON.parse(readFileSync(cacheFile, 'utf8')).latest).toBe('0.4.0');
  });

  it('falls back to the stale cache when the refresh fails', async () => {
    writeFileSync(cacheFile, JSON.stringify({ latest: '0.3.0', checkedAt: 0 }));
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const notice = await maybeRefreshUpdateCache({
      name: 'pkg',
      version: '0.2.0',
      cacheFile,
      now: 100 * 60 * 60 * 1000,
      fetchImpl,
    });
    expect(notice).toMatchObject({ latest: '0.3.0' });
  });

  it('returns null and writes nothing when offline with no cache', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const notice = await maybeRefreshUpdateCache({ name: 'pkg', version: '0.2.0', cacheFile, fetchImpl });
    expect(notice).toBeNull();
    expect(existsSync(cacheFile)).toBe(false);
  });
});

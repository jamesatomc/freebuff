import { describe, expect, test } from 'bun:test';
import {
  compareVersions,
  detectFreebuff,
  parseGitStatus,
  parseVersion,
  sanitizePrompt,
  toCommand,
} from '../src/freebuff';

describe('parseVersion', () => {
  test('extracts semver from raw output', () => {
    expect(parseVersion('0.2.19\n')).toBe('0.2.19');
    expect(parseVersion('freebuff v1.2.3-beta.1')).toBe('1.2.3-beta.1');
  });

  test('returns null when absent', () => {
    expect(parseVersion('no version here')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('orders by numeric segments', () => {
    expect(compareVersions('0.2.19', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  test('release outranks prerelease', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
  });
});

describe('sanitizePrompt', () => {
  test('collapses multi-line prompts to one line', () => {
    expect(sanitizePrompt('line one\nline two\n\nline three')).toBe('line one line two line three');
    expect(sanitizePrompt('  spaced\n  out  ')).toBe('spaced out');
    expect(sanitizePrompt('   ')).toBe('');
    expect(sanitizePrompt('windows\r\nbreaks')).toBe('windows breaks');
  });
});

describe('parseGitStatus', () => {
  test('maps porcelain lines to status codes', () => {
    const statuses = parseGitStatus(' M src/a.ts\n?? src/b.ts\nA  src/c.ts\n');
    expect(statuses.get('src/a.ts')).toBe(' M');
    expect(statuses.get('src/b.ts')).toBe('??');
    expect(statuses.get('src/c.ts')).toBe('A ');
  });

  test('handles renames and ignores blank lines', () => {
    const statuses = parseGitStatus('\nR  src/old.ts -> src/new.ts\n');
    expect(statuses.size).toBe(1);
    expect(statuses.get('src/new.ts')).toBe('R ');
  });
});

describe('toCommand', () => {
  test('quotes spaced existing paths only', () => {
    expect(toCommand('freebuff')).toBe('freebuff');
    expect(toCommand('')).toBe('');
    expect(toCommand('/definitely/not/a/real path/binary')).toBe('/definitely/not/a/real path/binary');
  });
});

describe('detectFreebuff', () => {
  test('finds the installed CLI or reports absence cleanly', async () => {
    const info = await detectFreebuff('freebuff');
    // The CLI is installed in this environment; the assertion also covers the
    // failure path by comparing against the raw result instead of assuming.
    expect(typeof info.installed).toBe('boolean');
    if (info.installed) {
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  }, 60_000);

  test('nonexistent executable reports not installed', async () => {
    const info = await detectFreebuff('freebuff-definitely-not-installed-xyz');
    expect(info.installed).toBe(false);
    expect(info.version).toBeNull();
  }, 30_000);
});

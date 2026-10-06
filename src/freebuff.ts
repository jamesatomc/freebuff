import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a shell command and capture its output. Never rejects; failures come
 * back as a non-zero `code` so callers can decide what a failure means.
 */
export function runCommand(
  command: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, { shell: true, cwd: opts.cwd, windowsHide: true });
    } catch (error) {
      finish({ code: -1, stdout: '', stderr: String(error) });
      return;
    }

    const timeoutMs = opts.timeoutMs ?? 20_000;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The process already exited; the result below still resolves.
      }
      finish({ code: -1, stdout, stderr: `${stderr}\n[timed out after ${timeoutMs}ms]` });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ code: -1, stdout, stderr: `${stderr}${String(error)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseVersion(text: string): string | null {
  // No \b before the digits: versions are often glued to a letter (`v1.2.3`).
  const match = text.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match?.[1] ?? null;
}

/** Numeric comparison of `x.y.z[-prerelease]`; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const [aMain = '', aPre = ''] = a.split('-', 2);
  const [bMain = '', bPre = ''] = b.split('-', 2);
  const aParts = aMain.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = bMain.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  if (aPre === bPre) {
    return 0;
  }
  if (aPre === '') {
    return 1; // A release outranks any prerelease of the same version.
  }
  if (bPre === '') {
    return -1;
  }
  return aPre < bPre ? -1 : 1;
}

/** Quote a configured executable only when it is a spaced path that exists. */
export function toCommand(executable: string): string {
  const trimmed = executable.trim();
  if (trimmed.includes(' ') && fs.existsSync(trimmed)) {
    return `"${trimmed}"`;
  }
  return trimmed;
}

export interface FreebuffInfo {
  installed: boolean;
  version: string | null;
  binPath: string | null;
}

export async function detectFreebuff(executable = 'freebuff'): Promise<FreebuffInfo> {
  const target = toCommand(executable);
  if (!target) {
    return { installed: false, version: null, binPath: null };
  }
  const result = await runCommand(`${target} --version`, { timeoutMs: 60_000 });
  const version = parseVersion(`${result.stdout}\n${result.stderr}`);
  if (result.code === 0 && version) {
    return { installed: true, version, binPath: await resolveExecutable(executable) };
  }
  return { installed: false, version: null, binPath: null };
}

/** Locate the CLI on PATH (`where` on Windows, `command -v` elsewhere). */
export async function resolveExecutable(executable: string): Promise<string | null> {
  const trimmed = executable.trim();
  if (trimmed.includes(' ') && fs.existsSync(trimmed)) {
    return trimmed;
  }
  const command =
    process.platform === 'win32' ? `where.exe ${trimmed}` : `command -v ${trimmed}`;
  const result = await runCommand(command, { timeoutMs: 15_000 });
  if (result.code !== 0) {
    return null;
  }
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return first ?? null;
}

export function fetchLatestVersion(timeoutMs = 8_000): Promise<string | null> {
  return new Promise((resolve) => {
    const request = https.get(
      'https://registry.npmjs.org/freebuff/latest',
      { timeout: timeoutMs },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve(null); // The registry does not redirect for this endpoint.
          return;
        }
        let body = '';
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { version?: unknown };
            resolve(typeof parsed.version === 'string' ? parsed.version : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

export type PackageManager = 'npm' | 'bun' | 'pnpm' | 'yarn';

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'bun', 'pnpm', 'yarn'];

export async function detectAvailablePackageManagers(): Promise<PackageManager[]> {
  const available: PackageManager[] = [];
  for (const manager of PACKAGE_MANAGERS) {
    const result = await runCommand(`${manager} --version`, { timeoutMs: 10_000 });
    if (result.code === 0 && /\d/.test(result.stdout)) {
      available.push(manager);
    }
  }
  return available;
}

export function installCommandFor(manager: PackageManager): string {
  switch (manager) {
    case 'npm':
      return 'npm install -g freebuff';
    case 'bun':
      return 'bun add -g freebuff';
    case 'pnpm':
      return 'pnpm add -g freebuff';
    case 'yarn':
      return 'yarn global add freebuff';
  }
}

/**
 * Collapse a prompt to one line: the Freebuff TUI submits on Enter, so
 * embedded newlines would cut the message short.
 */
export function sanitizePrompt(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
}

/** Parse `git status --porcelain` into path -> status code (e.g. " M"). */
export function parseGitStatus(output: string): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const line of output.split('\n')) {
    if (line.length < 4) {
      continue;
    }
    const code = line.slice(0, 2);
    let filePath = line.slice(3);
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop() ?? filePath;
    }
    filePath = filePath.replace(/^"|"$/g, '');
    statuses.set(filePath, code);
  }
  return statuses;
}

/**
 * True when the Freebuff *CLI* looks alive, so a prompt lands in the TUI
 * instead of an idle shell. Returns `undefined` when the platform query
 * failed, in which case callers should stay optimistic.
 */
export async function isFreebuffCliRunning(executable = 'freebuff'): Promise<boolean | undefined> {
  const marker = await resolveExecutable(executable);
  const separators = process.platform === 'win32' ? /[/\\]/g : /\\/g;
  const lower = (value: string): string => value.replace(separators, process.platform === 'win32' ? '\\' : '/').toLowerCase();
  const markers: string[] = [];
  if (marker) {
    markers.push(lower(marker));
  }
  for (const extra of ['node_modules/freebuff', '.config/manicode/freebuff.exe', '.config/codebuff/freebuff.exe']) {
    markers.push(lower(extra));
  }

  const processes = await listProcessCommands();
  if (processes === null) {
    return undefined;
  }
  return processes.some((line) => {
    const candidate = lower(line);
    return markers.some((m) => candidate.includes(m));
  });
}

async function listProcessCommands(): Promise<string[] | null> {
  if (process.platform === 'win32') {
    const result = await runCommand(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Process).CommandLine"',
      { timeoutMs: 15_000 },
    );
    if (result.code !== 0) {
      return null;
    }
    return result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }
  const result = await runCommand('ps -axo command=', { timeoutMs: 15_000 });
  if (result.code !== 0) {
    return null;
  }
  return result.stdout.split('\n').filter((line) => line.trim().length > 0);
}

/** Best-effort root of the first workspace folder, for git and cwd. */
export function firstWorkspaceRoot(folders: readonly { uri: { fsPath: string } }[] | undefined): string | undefined {
  return folders?.[0]?.uri.fsPath;
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

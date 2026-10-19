import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string, checkout: string, bin: string, tools: string, log: string;
function executable(path: string, text: string) { writeFileSync(path, text); chmodSync(path, 0o755); }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rev-installer-'));
  checkout = join(root, "checkout with spaces '$HOME`");
  bin = join(root, "commands with spaces ' $HOME`");
  tools = join(root, 'tools'); log = join(root, 'npm.log');
  for (const dir of [checkout, tools, join(checkout, 'dist')]) mkdirSync(dir, { recursive: true });
  copyFileSync(resolve('install.sh'), join(checkout, 'install.sh'));
  writeFileSync(join(checkout, 'dist/rev.js'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  executable(join(tools, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$REV_INSTALL_TEST_LOG"\nif [ "$1" = run ]; then exit "${REV_INSTALL_TEST_BUILD_STATUS:-0}"; fi\n');
  executable(join(tools, 'gh'), '#!/bin/sh\nexit "${REV_INSTALL_TEST_AUTH_STATUS:-0}"\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function install(options: string[] = [], env: Record<string, string> = {}, auth = false) {
  return spawnSync('/bin/bash', [join(checkout, 'install.sh'), '--bin-dir', bin, '--no-path', ...(auth ? [] : ['--no-auth']), ...options], {
    cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, REV_INSTALL_TEST_LOG: log, ...env },
  });
}
it('installs from any directory, quotes paths and arguments, and only uses lockfile install/build', () => {
  const result = install(); expect(result.status, result.stderr).toBe(0);
  const args = ['open', 'https://github.com/example/project/pull/1', 'literal $(echo nope) `value`'];
  expect(JSON.parse(execFileSync(join(bin, 'rev'), args, { encoding: 'utf8' }))).toEqual(args);
  expect(readFileSync(log, 'utf8')).toBe('ci --include=dev\nrun build\n');
  expect(readFileSync(join(bin, 'rev'), 'utf8')).toContain('# rev source-install launcher');
});
it('can rerun its own installation and leaves unrelated files alone', () => {
  expect(install().status).toBe(0);
  const marker = join(bin, 'keep'); writeFileSync(marker, 'existing');
  expect(install().status).toBe(0);
  expect(readFileSync(marker, 'utf8')).toBe('existing');
  expect(execFileSync(join(bin, 'rev'), ['--help'], { encoding: 'utf8' })).toContain('--help');
});
it.each(['file', 'symlink'])('refuses to replace an unrelated %s without building', kind => {
  mkdirSync(bin); const original = join(root, 'original'); writeFileSync(original, 'original launcher');
  if (kind === 'symlink') symlinkSync(original, join(bin, 'rev'));
  else copyFileSync(original, join(bin, 'rev'));
  const result = install(); expect(result.status).not.toBe(0); expect(result.stderr).toContain('unrelated command');
  expect(readFileSync(join(bin, 'rev'), 'utf8')).toBe('original launcher'); expect(existsSync(log)).toBe(false);
});
it('does not replace the launcher when rebuilding fails', () => {
  expect(install().status).toBe(0); const previous = readFileSync(join(bin, 'rev'), 'utf8');
  const result = install([], { REV_INSTALL_TEST_BUILD_STATUS: '23' });
  expect(result.status).toBe(23); expect(readFileSync(join(bin, 'rev'), 'utf8')).toBe(previous);
});
it('explains missing prerequisites without invoking an unavailable package manager', () => {
  executable(join(tools, 'uname'), '#!/bin/sh\necho Linux\n');
  executable(join(tools, 'node'), '#!/bin/sh\nexit 1\n');
  const result = install(); expect(result.status).not.toBe(0); expect(result.stderr).toContain('Node.js 22.12+ and npm');
  expect(existsSync(log)).toBe(false);
});
it('does not hang unattended installers on GitHub login', () => {
  const result = install([], { REV_INSTALL_TEST_AUTH_STATUS: '1' }, true);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('interactive terminal');
  expect(existsSync(log)).toBe(false);
});
it('rejects desktop installation on unsupported systems before building', () => {
  executable(join(tools, 'uname'), '#!/bin/sh\necho Linux\n');
  const result = install(['--desktop']); expect(result.status).not.toBe(0); expect(result.stderr).toContain('macOS only');
  expect(existsSync(log)).toBe(false);
});
it.each([['--bin-dir'], ['--app-dir'], ['--unknown']])('rejects invalid options %j', (...args) => {
  const result = install(args); expect(result.status).not.toBe(0); expect(existsSync(log)).toBe(false);
});

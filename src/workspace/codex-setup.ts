import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { CodexSetup } from '../api/codex-connection.js';
import { desktopCliCandidates } from '../codex/transport.js';
import { updateGlobalConfig } from '../global-config.js';
import { connectCodex } from './codex-client.js';
import { codexEnabled } from './codex-settings.js';

const exec = promisify(execFile);
const label = 'app.rev.codex-connection';
const InstallationSchema = z.object({ version: z.literal(1), cli: z.string(), socket: z.string(), previous: z.record(z.string(), z.string()) });
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function setupPaths() {
  const root = join(homedir(), '.local/share/rev/codex-connection');
  return { root, wrapper: join(root, 'desktop-cli'), state: join(root, 'installation.json'),
    login: join(root, 'login.sh'), agent: join(homedir(), 'Library/LaunchAgents', `${label}.plist`) };
}
function installation() {
  try { return InstallationSchema.parse(JSON.parse(readFileSync(setupPaths().state, 'utf8'))); } catch { return null; }
}
async function environment(key: string): Promise<string> {
  try { return (await exec('/bin/launchctl', ['getenv', key], { timeout: 5000 })).stdout.trim(); } catch { return ''; }
}
async function setEnvironment(key: string, value: string): Promise<void> {
  await exec('/bin/launchctl', value ? ['setenv', key, value] : ['unsetenv', key], { timeout: 5000 });
}
function writePrivate(path: string, value: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, value, { mode }); chmodSync(temp, mode); renameSync(temp, path);
}
const domain = () => `gui/${process.getuid?.() ?? 0}`;
async function unload(path: string): Promise<void> {
  try { await exec('/bin/launchctl', ['bootout', domain(), path], { timeout: 5000 }); } catch { /* A login-only helper may already have exited. */ }
}
export async function codexHandshake() {
  const client = connectCodex();
  try {
    await client.request('initialize', { clientInfo: { name: 'rev-settings', version: '1.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    client.notify('initialized');
    return client;
  } catch (error) { client.close(); throw error; }
}
export async function codexSetupStatus(): Promise<CodexSetup> {
  const enabled = codexEnabled();
  const supported = process.platform === 'darwin';
  if (!supported) return { enabled, supported, state: 'unsupported', message: 'Automatic setup is available on macOS.' };
  if (!enabled) return { enabled, supported, state: 'disabled', message: 'Connect your original Codex chats to local code comments.' };
  let client: Awaited<ReturnType<typeof codexHandshake>> | undefined;
  try {
    client = await codexHandshake();
    await client.request('thread/loaded/list', {});
    return { enabled, supported, state: 'connected', message: 'Connected. Local code comments go to the linked Codex chat.' };
  } catch {
    const configured = installation() !== null || await environment('REV_CODEX_SHARED_SERVER') === '1';
    return { enabled, supported, state: configured ? 'restart' : 'unavailable',
      message: configured ? 'Quit and reopen Codex once to finish connecting. Your chats and settings stay unchanged.' : 'Connection needs repair. Turn this option off and on to set it up again.' };
  } finally { client?.close(); }
}
async function validateCli(cli: string): Promise<void> {
  const help = await exec(cli, ['app-server', '--help'], { timeout: 10_000 });
  if (!help.stdout.includes('unix://')) throw new Error('Update Codex: this version does not support the local connection.');
  const folder = mkdtempSync(join(tmpdir(), 'rev-codex-schema-'));
  try {
    await exec(cli, ['app-server', 'generate-json-schema', '--experimental', '--out', folder], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    const schemas = readdirSync(folder).filter(file => file.endsWith('.json')).map(file => readFileSync(join(folder, file), 'utf8')).join('\n');
    if (!['thread/queue/add', 'thread/queue/start', 'turn/steer', 'thread/loaded/list'].every(method => schemas.includes(`"${method}"`)))
      throw new Error('Update Codex: this version does not support queued review comments.');
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
let changing = false;
export async function configureCodex(enabled: boolean): Promise<CodexSetup> {
  if (changing) throw new Error('Codex setup is already in progress.');
  if (process.platform !== 'darwin') throw new Error('Automatic Codex setup requires macOS.');
  changing = true;
  try { return await configure(enabled); } finally { changing = false; }
}
async function configure(enabled: boolean): Promise<CodexSetup> {
  const paths = setupPaths();
  const current = { CODEX_CLI_PATH: await environment('CODEX_CLI_PATH'), REV_CODEX_SHARED_SERVER: await environment('REV_CODEX_SHARED_SERVER') };
  const saved = installation();
  if (!enabled) {
    // Stop delivery immediately; leave the running desktop and its files intact until the user restarts it.
    updateGlobalConfig(config => { config.codexConnection = { enabled: false }; });
    if (existsSync(paths.agent)) { await unload(paths.agent); rmSync(paths.agent); }
    if (current.CODEX_CLI_PATH === paths.wrapper) await setEnvironment('CODEX_CLI_PATH', saved?.previous.CODEX_CLI_PATH ?? '');
    if (current.REV_CODEX_SHARED_SERVER === '1') await setEnvironment('REV_CODEX_SHARED_SERVER', saved?.previous.REV_CODEX_SHARED_SERVER ?? '');
    return codexSetupStatus();
  }
  const cli = desktopCliCandidates().find(path => existsSync(path));
  if (cli === undefined) throw new Error('Install the Codex desktop app in Applications, then enable this option again.');
  await validateCli(cli);
  const legacyRoot = join(homedir(), '.local/share/rev/codex-shared');
  const legacy = current.CODEX_CLI_PATH === join(legacyRoot, 'desktop-cli');
  if (current.CODEX_CLI_PATH && ![paths.wrapper, cli].includes(current.CODEX_CLI_PATH) && !legacy)
    throw new Error('Another custom Codex launcher is configured. Remove that override before enabling the rev connection.');
  if (await environment('CODEX_APP_SERVER_WS_URL'))
    throw new Error('Codex already uses a custom server connection. Remove that override before enabling the rev connection.');
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const source = [join(moduleDir, 'codex-desktop.js'), resolve(moduleDir, '../../dist/codex-desktop.js')].find(path => existsSync(path));
  if (source === undefined) throw new Error('The Codex helper is missing. Reinstall or rebuild rev, then try again.');
  const previous = saved?.previous ?? (legacy ? { CODEX_CLI_PATH: '', REV_CODEX_SHARED_SERVER: '' } : current);
  const state = { version: 1 as const, cli, socket: process.env.REV_CODEX_SOCKET ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'app-server-control/app-server-control.sock'), previous };
  const oldAgent = existsSync(paths.agent) ? readFileSync(paths.agent, 'utf8') : null;
  const files = [paths.state, paths.wrapper, paths.login, join(paths.root, 'codex-desktop.js'), join(paths.root, 'package.json')];
  const beforeFiles = files.map(path => ({ path, content: existsSync(path) ? readFileSync(path, 'utf8') : null }));
  const moved: Array<{ path: string; backup: string }> = [];
  try {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 }); chmodSync(paths.root, 0o700);
    // The desktop launcher must survive moving/updating rev or deleting its source checkout.
    if (!existsSync(join(paths.root, 'node'))) { copyFileSync(process.execPath, join(paths.root, 'node')); chmodSync(join(paths.root, 'node'), 0o700); }
    writePrivate(join(paths.root, 'codex-desktop.js'), readFileSync(source, 'utf8'));
    writePrivate(join(paths.root, 'package.json'), '{"type":"module"}\n');
    writePrivate(paths.state, JSON.stringify(state));
    writePrivate(paths.wrapper, `#!/bin/sh\nexec ${shellQuote(join(paths.root, 'node'))} ${shellQuote(join(paths.root, 'codex-desktop.js'))} "$@"\n`, 0o700);
    writePrivate(paths.login, `#!/bin/sh\nset -eu\n/bin/launchctl setenv CODEX_CLI_PATH ${shellQuote(paths.wrapper)}\n/bin/launchctl setenv REV_CODEX_SHARED_SERVER 1\n`, 0o700);
    writePrivate(paths.agent, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(paths.login)}</string></array><key>RunAtLoad</key><true/></dict></plist>`);
    await unload(paths.agent);
    await exec('/bin/launchctl', ['bootstrap', domain(), paths.agent], { timeout: 10_000 });
    await exec('/bin/sh', [paths.login], { timeout: 5000 });
    if (legacy) {
      // Retire only older rev login helpers, never another application's startup configuration.
      for (const name of readdirSync(dirname(paths.agent)).filter(name => name.endsWith('.plist') && name !== `${label}.plist`)) {
        const path = join(dirname(paths.agent), name);
        let matches = false;
        try {
          const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { timeout: 5000 });
          const value = z.object({ ProgramArguments: z.array(z.string()).optional() }).parse(JSON.parse(stdout));
          matches = value.ProgramArguments?.includes(join(legacyRoot, 'configure.cjs')) === true;
        } catch { /* Unrelated startup files are not ours to repair. */ }
        if (!matches) continue;
        await unload(path);
        const backup = join(paths.root, `previous-${name}`); renameSync(path, backup); moved.push({ path, backup });
      }
    }
    updateGlobalConfig(config => { config.codexConnection = { enabled: true }; });
  } catch (error) {
    await unload(paths.agent);
    if (oldAgent !== null) writePrivate(paths.agent, oldAgent); else rmSync(paths.agent, { force: true });
    for (const file of beforeFiles) {
      if (file.content !== null) writePrivate(file.path, file.content, file.path === paths.wrapper || file.path === paths.login ? 0o700 : 0o600);
      else rmSync(file.path, { force: true });
    }
    for (const item of moved) renameSync(item.backup, item.path);
    for (const [key, value] of Object.entries(current)) await setEnvironment(key, value);
    for (const path of [...(oldAgent !== null ? [paths.agent] : []), ...moved.map(item => item.path)]) {
      try { await exec('/bin/launchctl', ['bootstrap', domain(), path], { timeout: 5000 }); } catch { /* Keep the preserved file for the next login. */ }
    }
    throw error;
  }
  return codexSetupStatus();
}

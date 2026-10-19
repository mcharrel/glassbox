import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

/** Only replace the desktop's stdio transport; preserve every model/tool/permission argument. */
export function sharedArguments(args: string[], socket: string): string[] | null {
  const at = args.indexOf('app-server');
  if (at < 0 || args.some(arg => ['--help', '-h', 'daemon', 'proxy', 'generate-ts', 'generate-json-schema', 'help'].includes(arg))) return null;
  const listen = args.findIndex(arg => arg === '--listen' || arg.startsWith('--listen='));
  if (listen >= 0 && (args[listen].split('=')[1] ?? args[listen + 1]) !== 'stdio://') return null;
  const result = args.filter(arg => arg !== '--stdio');
  const index = result.findIndex(arg => arg === '--listen' || arg.startsWith('--listen='));
  if (index >= 0) result.splice(index, result[index] === '--listen' ? 2 : 1);
  return [...result, '--listen', `unix://${socket}`];
}
export function desktopCliCandidates(home = homedir()): string[] {
  return [join(home, 'Applications'), '/Applications'].flatMap(root => ['ChatGPT.app', 'Codex.app'].flatMap(app => [
    join(root, app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
    join(root, app, 'Contents/Resources/codex'),
  ]));
}
export async function bridge(cli: string, args: string[], socketPath: string): Promise<void> {
  const shared = sharedArguments(args, socketPath);
  if (!shared) {
    const child = spawn(cli, args, { stdio: 'inherit', env: { ...process.env, CODEX_CLI_PATH: cli } });
    child.on('error', () => { process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    return;
  }
  // Never attach a second desktop to a server belonging to an already running chat.
  const occupied = await new Promise<boolean>(resolve => {
    const probe = createConnection(socketPath);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => { probe.destroy(); resolve(false); });
    probe.setTimeout(500, () => { probe.destroy(); resolve(true); });
  });
  if (occupied) throw new Error('Codex is already running. Quit its other instance before reopening it.');
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  const child = spawn(cli, shared, { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CODEX_CLI_PATH: cli } });
  let socket: WebSocket | undefined;
  let input: ReturnType<typeof createInterface> | undefined;
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true; input?.close(); socket?.terminate(); child.kill('SIGTERM');
    setTimeout(() => { child.kill('SIGKILL'); process.exit(0); }, 2000).unref();
  };
  child.on('error', () => { console.error('Could not start the desktop Codex server.'); process.exit(1); });
  child.on('exit', code => { socket?.terminate(); process.exit(code ?? 0); });
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  process.stdin.on('end', shutdown); process.stdout.on('error', shutdown);
  const deadline = Date.now() + 15_000;
  const connect = () => {
    if (stopping) return;
    const ws = new WebSocket('ws://localhost/rpc', { createConnection: () => createConnection(socketPath),
      handshakeTimeout: 1000, perMessageDeflate: false, maxPayload: 128 * 1024 * 1024 });
    let opened = false;
    ws.on('error', () => { /* Retry until the desktop child is ready. */ });
    ws.on('close', () => {
      if (opened) { shutdown(); return; }
      if (stopping) return;
      if (Date.now() > deadline) { console.error('Codex did not expose its local connection.'); shutdown(); return; }
      setTimeout(connect, 100);
    });
    ws.on('open', () => {
      if (stopping) { ws.terminate(); return; }
      opened = true; socket = ws;
      ws.on('message', data => {
        if (!process.stdout.write((Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data).toString('utf8') + '\n')) { ws.pause(); process.stdout.once('drain', () => { ws.resume(); }); }
      });
      input = createInterface({ input: process.stdin, crlfDelay: Infinity });
      input.on('line', line => { if (ws.readyState === WebSocket.OPEN) ws.send(line); });
    });
  };
  connect();
}
async function main(): Promise<void> {
  const root = dirname(fileURLToPath(import.meta.url));
  const config = JSON.parse(readFileSync(join(root, 'installation.json'), 'utf8')) as { cli: string; socket: string };
  const cli = existsSync(config.cli) ? config.cli : desktopCliCandidates().find(path => existsSync(path));
  if (cli === undefined) throw new Error('Install Codex, then repair its connection in rev Settings.');
  await bridge(cli, process.argv.slice(2), config.socket);
}
const entry = process.argv.at(1);
if (entry !== undefined && /(?:^|\/)codex-desktop\.js$/.test(entry)) {
  void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Codex connection failed.'); process.exitCode = 1; });
}

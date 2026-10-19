import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ home: '', config: {} as Record<string, any>, env: {} as Record<string, string>, exec: vi.fn(), connected: false, close: vi.fn(), fail: '', compatible: true }));
vi.mock('node:os', async original => ({ ...await original<any>(), homedir: () => mocks.home }));
vi.mock('node:fs', async original => {
  const fs = await original<any>();
  // Unit setup uses a fixture bundle so a fresh checkout needs no build artifacts.
  const bundle = (path: string) => path.endsWith('/dist/codex-desktop.js');
  return { ...fs, existsSync: (path: string) => bundle(path) || (!path.startsWith('/Applications/') && fs.existsSync(path)),
    readFileSync: (path: string, ...args: any[]) => bundle(path) ? 'export {};\n' : fs.readFileSync(path, ...args),
    copyFileSync: (source: string, destination: string) => source === process.execPath ? fs.writeFileSync(destination, 'runtime fixture') : fs.copyFileSync(source, destination) };
});
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec }), spawn: vi.fn() }));
vi.mock('../../../src/global-config.js', () => ({ readGlobalConfig: () => mocks.config, updateGlobalConfig: (fn: any) => fn(mocks.config) }));
vi.mock('../../../src/workspace/codex-client.js', () => ({ connectCodex: () => ({
  request: async () => { if (!mocks.connected) throw Error('offline'); return { data: [] }; }, notify: vi.fn(), close: mocks.close,
}) }));
import { codexSetupStatus, configureCodex, setupPaths } from '../../../src/workspace/codex-setup.js';
import { codexEnabled } from '../../../src/workspace/codex-settings.js';
let cli: string;
beforeEach(() => {
  mocks.home = mkdtempSync(join(tmpdir(), "rev-setup ' & ")); mocks.config = { themes: { active: 'dark' } }; mocks.env = {};
  mocks.connected = false; mocks.fail = ''; mocks.compatible = true; mocks.close.mockClear();
  vi.stubEnv('REV_CODEX_SHARED_SERVER', ''); vi.stubEnv('CODEX_HOME', join(mocks.home, '.codex'));
  vi.stubEnv('REV_CODEX_SOCKET', '');
  delete process.env.REV_CODEX_SOCKET;
  cli = join(mocks.home, 'Applications/Codex.app/Contents/Resources/codex'); mkdirSync(dirname(cli), { recursive: true }); writeFileSync(cli, 'fixture');
  mocks.exec.mockReset().mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === cli) {
      if (args.includes('--help')) return { stdout: mocks.compatible ? 'unix://' : 'stdio://' };
      const folder = args[args.indexOf('--out') + 1];
      writeFileSync(join(folder, 'requests.json'), JSON.stringify(['thread/queue/add', 'thread/queue/start', 'turn/steer', 'thread/loaded/list']));
    } else if (cmd === '/bin/launchctl') {
      if (args[0] === 'getenv') return { stdout: mocks.env[args[1]] ?? '' };
      if (mocks.fail && args[0] === mocks.fail) throw Error('fixture setup failure');
      if (args[0] === 'setenv') mocks.env[args[1]] = args[2];
      if (args[0] === 'unsetenv') delete mocks.env[args[1]];
    } else if (cmd === '/bin/sh') {
      mocks.env.CODEX_CLI_PATH = setupPaths().wrapper; mocks.env.REV_CODEX_SHARED_SERVER = '1';
    } else if (cmd === '/usr/bin/plutil') return { stdout: readFileSync(args.at(-1)!, 'utf8') };
    return { stdout: '' };
  });
});
afterEach(() => { rmSync(mocks.home, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe.skipIf(process.platform !== 'darwin')('managed desktop setup', () => {
  it('starts disabled without contacting or configuring Codex', async () => {
    expect((await codexSetupStatus()).state).toBe('disabled'); expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('enables from scratch, persists through login, and needs only a desktop restart', async () => {
    expect((await configureCodex(true)).state).toBe('restart');
    const p = setupPaths();
    expect(mocks.env.CODEX_CLI_PATH).toBe(p.wrapper); expect(codexEnabled()).toBe(true);
    expect(statSync(p.root).mode & 0o777).toBe(0o700); expect(statSync(p.state).mode & 0o777).toBe(0o600);
    expect(readFileSync(p.wrapper, 'utf8')).toContain("'\\''"); expect(readFileSync(p.agent, 'utf8')).toContain('&amp;');
    expect(readFileSync(p.agent, 'utf8')).toContain('<key>RunAtLoad</key><true/>');
    expect(readFileSync(join(p.root, 'codex-desktop.js'), 'utf8')).toBe('export {};\n');
    expect(mocks.config.themes).toEqual({ active: 'dark' });
    expect(mocks.exec.mock.calls.filter(([cmd]) => cmd === cli).every(([, args]) => args.includes('--help') || args.includes('generate-json-schema'))).toBe(true);
    mocks.connected = true; expect((await codexSetupStatus()).state).toBe('connected');
  });
  it('can enable twice, disable and re-enable without losing original overrides', async () => {
    mocks.env.CODEX_CLI_PATH = cli;
    await configureCodex(true); await configureCodex(true); await configureCodex(false);
    expect(mocks.env.CODEX_CLI_PATH).toBe(cli); expect(mocks.env.REV_CODEX_SHARED_SERVER).toBeUndefined();
    expect(existsSync(setupPaths().agent)).toBe(false); expect(codexEnabled()).toBe(false);
    vi.stubEnv('REV_CODEX_SHARED_SERVER', '1'); expect(codexEnabled()).toBe(false);
    await configureCodex(true); expect(codexEnabled()).toBe(true);
  });
  it('does not clobber a launcher selected outside rev while disabling', async () => {
    await configureCodex(true); mocks.env.CODEX_CLI_PATH = '/another/launcher'; await configureCodex(false);
    expect(mocks.env.CODEX_CLI_PATH).toBe('/another/launcher');
  });
  it.each(['launcher', 'remote', 'unsupported', 'missing'])('rejects incompatible %s setup without changing settings', async kind => {
    if (kind === 'launcher') mocks.env.CODEX_CLI_PATH = '/custom/launcher';
    if (kind === 'remote') mocks.env.CODEX_APP_SERVER_WS_URL = 'unix:///custom/socket';
    if (kind === 'unsupported') mocks.compatible = false;
    if (kind === 'missing') rmSync(cli);
    const env = { ...mocks.env }; await expect(configureCodex(true)).rejects.toThrow();
    expect(mocks.env).toEqual(env); expect(existsSync(setupPaths().state)).toBe(false); expect(mocks.config.codexConnection).toBeUndefined();
  });
  it('rolls back failed setup without leaving the desktop pointed at a broken helper', async () => {
    mocks.fail = 'bootstrap'; await expect(configureCodex(true)).rejects.toThrow('fixture setup failure');
    expect(mocks.env).toEqual({}); expect(existsSync(setupPaths().state)).toBe(false); expect(existsSync(setupPaths().wrapper)).toBe(false);
    expect(existsSync(setupPaths().agent)).toBe(false); expect(mocks.config.codexConnection).toBeUndefined();
  });
  it('restores the previous working helper if a repair fails', async () => {
    await configureCodex(true);
    const paths = setupPaths(); const before = readFileSync(paths.state, 'utf8');
    const wrapper = readFileSync(paths.wrapper, 'utf8'); const env = { ...mocks.env };
    mocks.fail = 'bootstrap'; await expect(configureCodex(true)).rejects.toThrow();
    expect(readFileSync(paths.state, 'utf8')).toBe(before); expect(readFileSync(paths.wrapper, 'utf8')).toBe(wrapper);
    expect(mocks.env).toEqual(env); expect(codexEnabled()).toBe(true);
  });
  it('adopts the earlier rev helper without stopping its running chat or touching unrelated login items', async () => {
    const legacy = join(mocks.home, '.local/share/rev/codex-shared'); mocks.env.CODEX_CLI_PATH = join(legacy, 'desktop-cli'); mocks.env.REV_CODEX_SHARED_SERVER = '1';
    const agents = dirname(setupPaths().agent); mkdirSync(agents, { recursive: true });
    const old = join(agents, 'old-rev.plist'); writeFileSync(old, JSON.stringify({ ProgramArguments: ['node', join(legacy, 'configure.cjs')] }));
    const other = join(agents, 'unrelated.plist'); writeFileSync(other, '{invalid-unrelated-file');
    mocks.connected = true; expect((await configureCodex(true)).state).toBe('connected');
    expect(existsSync(old)).toBe(false); expect(readFileSync(other, 'utf8')).toBe('{invalid-unrelated-file');
    expect(JSON.parse(readFileSync(setupPaths().state, 'utf8')).previous.CODEX_CLI_PATH).toBe('');
    expect(mocks.exec.mock.calls.every(([, args]) => !args.includes('kill') && !args.includes('stop'))).toBe(true);
  });
});

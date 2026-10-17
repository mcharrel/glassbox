import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { codexConnection, sendToCodex } from '../../../src/workspace/codex-client.js';
let requests: any[];
let status: string;
let child: any;
beforeEach(() => {
  vi.stubEnv('REV_CODEX_SHARED_SERVER', '1');
  requests = []; status = 'active';
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  child.stdin.on('data', (data: Buffer) => {
    const request = JSON.parse(data.toString()); requests.push(request);
    if (request.id === undefined) return;
    const result = request.method === 'thread/read' ? { thread: { status: { type: status }, turns: status === 'active' ? [{ id: 'turn-1', status: 'inProgress' }] : [] } } : {};
    child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
  });
  mocks.spawn.mockReturnValue(child);
});
afterEach(() => vi.unstubAllEnvs());
it('does not connect or spawn an agent without explicit shared-server configuration', async () => {
  vi.stubEnv('REV_CODEX_SHARED_SERVER', ''); mocks.spawn.mockClear();
  await expect(codexConnection('chat')).rejects.toThrow('shared app server'); expect(mocks.spawn).not.toHaveBeenCalled();
});
it('queues atomically in an active existing chat without resuming it or changing its settings', async () => {
  const connection = await codexConnection('chat');
  await sendToCodex(connection, 'chat', 'new comment: fix', 'queue', 'id'); connection.client.close();
  expect(mocks.spawn).toHaveBeenCalledWith('codex', ['app-server', 'proxy'], { stdio: 'pipe' });
  expect(requests.map(r => r.method)).toEqual(['initialize', 'initialized', 'thread/read', 'thread/queue/add']);
  expect(requests.at(-1).params).toEqual({ threadId: 'chat', input: [{ type: 'text', text: 'new comment: fix', text_elements: [] }], clientUserMessageId: 'id' });
});
it('steers only the observed active turn', async () => {
  const c = await codexConnection('chat'); await sendToCodex(c, 'chat', 'new comment: fix', 'steer', 'id'); c.client.close();
  expect(requests.at(-1).method).toBe('turn/steer'); expect(requests.at(-1).params.expectedTurnId).toBe('turn-1');
});
it('starts an idle chat through its queue', async () => {
  status = 'idle'; const c = await codexConnection('chat'); await sendToCodex(c, 'chat', 'new comment: fix', 'steer', 'id'); c.client.close();
  expect(requests.slice(-2).map(r => r.method)).toEqual(['thread/queue/add', 'thread/queue/start']);
});
it('never resumes an unloaded chat into a different process', async () => {
  status = 'notLoaded'; await expect(codexConnection('chat')).rejects.toThrow('Open the originating');
  expect(child.kill).toHaveBeenCalled(); expect(requests.some(r => r.method === 'thread/resume')).toBe(false);
});

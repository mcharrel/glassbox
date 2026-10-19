import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

vi.mock('../../../src/global-config.js', () => ({ readGlobalConfig: () => ({}) }));

import { codexConnection, connectCodex, sendToCodex } from '../../../src/workspace/codex-client.js';

let directory: string;
let server: Server;
let sockets: WebSocketServer;
let requests: any[];
let status: string;
let turnStatus: string;
let rejectQueue: boolean;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rev-codex-'));
  vi.stubEnv('REV_CODEX_SHARED_SERVER', '1');
  vi.stubEnv('REV_CODEX_SOCKET', join(directory, 'rpc.sock'));
  requests = []; status = 'active'; turnStatus = 'inProgress'; rejectQueue = false;
  server = createServer();
  sockets = new WebSocketServer({ server, path: '/rpc' });
  sockets.on('connection', socket => socket.on('message', data => {
    const request = JSON.parse(data.toString()); requests.push(request);
    if (request.id === undefined) return;
    if (request.method === 'disconnect') { socket.terminate(); return; }
    if (request.method === 'malformed') { socket.send('{broken'); return; }
    if (request.method === 'thread/queue/add' && rejectQueue) {
      socket.send(JSON.stringify({ id: request.id, error: { message: 'Queue rejected' } })); return;
    }
    const result = request.method === 'thread/read' ? { thread: { status: { type: status } } }
      : request.method === 'thread/turns/list' ? { data: [{ id: 'turn-1', status: turnStatus }] } : {};
    socket.send(JSON.stringify({ method: 'thread/status/changed', params: {} }));
    socket.send(JSON.stringify({ id: request.id, result }));
  }));
  server.listen(process.env.REV_CODEX_SOCKET);
  await once(server, 'listening');
});
afterEach(async () => {
  for (const socket of sockets.clients) socket.terminate();
  await new Promise<void>(resolve => sockets.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it('does not connect without explicit shared-server configuration', async () => {
  vi.stubEnv('REV_CODEX_SHARED_SERVER', '');
  await expect(codexConnection('chat')).rejects.toThrow('shared app server'); expect(requests).toEqual([]);
});
it('handshakes over a real Unix WebSocket and queues without resuming or changing chat settings', async () => {
  const connection = await codexConnection('chat');
  await sendToCodex(connection, 'chat', 'new comment: fix', 'queue', 'id'); connection.client.close();
  expect(requests.map(r => r.method)).toEqual(['initialize', 'initialized', 'thread/read', 'thread/turns/list', 'thread/queue/add']);
  expect(requests.find(r => r.method === 'thread/read').params.includeTurns).toBe(false);
  expect(requests.find(r => r.method === 'thread/turns/list').params.limit).toBe(1);
  expect(requests.at(-1).params).toEqual({ threadId: 'chat', input: [{ type: 'text', text: 'new comment: fix', text_elements: [] }], clientUserMessageId: 'id' });
});
it('steers only the observed active turn', async () => {
  const c = await codexConnection('chat'); await sendToCodex(c, 'chat', 'new comment: fix', 'steer', 'id'); c.client.close();
  expect(requests.at(-1).method).toBe('turn/steer'); expect(requests.at(-1).params.expectedTurnId).toBe('turn-1');
});
it('starts an idle chat through its queue without reading historical turns', async () => {
  status = 'idle'; const c = await codexConnection('chat'); await sendToCodex(c, 'chat', 'new comment: fix', 'steer', 'id'); c.client.close();
  expect(requests.map(r => r.method)).not.toContain('thread/turns/list');
  expect(requests.slice(-2).map(r => r.method)).toEqual(['thread/queue/add', 'thread/queue/start']);
});
it('never resumes an unloaded chat into a different process', async () => {
  status = 'notLoaded'; await expect(codexConnection('chat')).rejects.toThrow('Open the originating');
  expect(requests.some(r => r.method === 'thread/resume')).toBe(false);
});
it('leaves a comment pending when the active turn cannot be identified', async () => {
  turnStatus = 'completed'; await expect(codexConnection('chat')).rejects.toThrow('identify the active turn');
  expect(requests.some(r => r.method === 'thread/queue/add')).toBe(false);
});
it('surfaces queue rejection instead of silently accepting delivery', async () => {
  rejectQueue = true; const c = await codexConnection('chat');
  await expect(sendToCodex(c, 'chat', 'new comment: fix', 'queue', 'id')).rejects.toThrow('Queue rejected'); c.client.close();
});
it.each(['disconnect', 'malformed'])('fails pending calls and later requests after %s', async method => {
  const c = await codexConnection('chat');
  await expect(c.client.request(method, {})).rejects.toThrow('unavailable');
  await expect(c.client.request('thread/read', {})).rejects.toThrow('unavailable'); c.client.close();
});
it('fails safely when the configured socket is missing', async () => {
  vi.stubEnv('REV_CODEX_SOCKET', join(directory, 'missing.sock'));
  const c = connectCodex();
  await expect(c.request('initialize', {})).rejects.toThrow('unavailable'); c.close();
});

import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import WebSocket from 'ws';
import { z } from 'zod';

import { codexEnabled } from './codex-settings.js';

const ResponseSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(), result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
const ThreadSchema = z.object({ thread: z.object({ status: z.object({ type: z.string() }) }) });
const TurnsSchema = z.object({ data: z.array(z.object({ id: z.string(), status: z.string() })) });

/** Connect only to an existing shared server; never start/resume a second agent. */
export function connectCodex() {
  const socketPath = process.env.REV_CODEX_SOCKET
    ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock');
  const socket = new WebSocket('ws://localhost/rpc', {
    createConnection: () => createConnection(socketPath),
    handshakeTimeout: 10_000, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false,
  });
  let nextId = 0;
  let closed = false;
  const pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  const unavailable = () => new Error('Codex shared server is unavailable');
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('open', () => { resolve(); });
    socket.once('error', () => { reject(unavailable()); });
    socket.once('close', () => { reject(unavailable()); });
  });
  const fail = () => {
    closed = true;
    for (const item of pending.values()) item.reject(unavailable());
    pending.clear();
  };
  socket.on('error', fail);
  socket.on('close', fail);
  socket.on('message', data => {
    try {
      const value = ResponseSchema.parse(JSON.parse((Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data).toString('utf8')));
      if (typeof value.id !== 'number') return;
      const item = pending.get(value.id);
      if (!item) return;
      pending.delete(value.id);
      if (value.error) item.reject(new Error(value.error.message)); else item.resolve(value.result);
    } catch { fail(); socket.terminate(); }
  });
  return {
    request: async (method: string, params: unknown): Promise<unknown> => {
      await ready;
      if (closed) throw unavailable();
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Codex did not acknowledge the request'));
          fail(); socket.terminate();
        }, 10_000);
        pending.set(id, {
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); },
        });
        socket.send(JSON.stringify({ id, method, params }), error => { if (error) fail(); });
      });
    },
    notify: (method: string) => { socket.send(JSON.stringify({ method })); },
    close: () => { fail(); socket.terminate(); },
  };
}
export async function codexConnection(threadId: string) {
  if (!codexEnabled())
    throw new Error('Enable Connect to Codex in Settings → Experimental to use the shared app server');
  const client = connectCodex();
  try {
    await client.request('initialize', { clientInfo: { name: 'rev', version: '1.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    client.notify('initialized');
    const state = ThreadSchema.parse(await client.request('thread/read', { threadId, includeTurns: false }));
    if (!['idle', 'active'].includes(state.thread.status.type))
      throw new Error('Open the originating chat in the shared-server Codex session');
    // Read only the latest turn, so long-running chats do not require their entire history.
    const turns = state.thread.status.type === 'active'
      ? TurnsSchema.parse(await client.request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' })).data : [];
    const activeTurn = turns.find(turn => turn.status === 'inProgress')?.id;
    if (state.thread.status.type === 'active' && activeTurn === undefined)
      throw new Error('Codex did not identify the active turn; leaving the comment pending');
    return { client, activeTurn };
  } catch (error) { client.close(); throw error; }
}
export async function sendToCodex(connection: Awaited<ReturnType<typeof codexConnection>>,
  threadId: string, prompt: string, mode: 'queue' | 'steer', id: string): Promise<void> {
  const input = [{ type: 'text', text: prompt, text_elements: [] }];
  if (mode === 'steer' && connection.activeTurn !== undefined) {
    await connection.client.request('turn/steer', { threadId, input, expectedTurnId: connection.activeTurn, clientUserMessageId: id });
    return;
  }
  // Queueing is atomic at the server even if a new turn starts concurrently.
  await connection.client.request('thread/queue/add', { threadId, input, clientUserMessageId: id });
  if (connection.activeTurn === undefined) {
    // A concurrent turn may have started; the accepted queued message stays in the same chat.
    try { await connection.client.request('thread/queue/start', { threadId }); } catch { /* Already queued. */ }
  }
}

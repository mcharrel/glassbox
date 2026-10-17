import { spawn } from 'node:child_process';

import { z } from 'zod';

const ResponseSchema = z.object({
  id: z.number().optional(), result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
const ThreadSchema = z.object({ thread: z.object({
  status: z.object({ type: z.string() }),
  turns: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
}) });

/** Connect only to an existing shared server; never start/resume a second agent. */
export function connectCodex(): {
  request: (method: string, params: unknown) => Promise<unknown>;
  notify: (method: string) => void;
  close: () => void;
} {
  const child = spawn(process.env.REV_CODEX_BIN ?? 'codex', ['app-server', 'proxy'], { stdio: 'pipe' });
  let nextId = 0;
  let buffer = '';
  const pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  const fail = () => {
    for (const item of pending.values()) item.reject(new Error('Codex shared server is unavailable'));
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  child.stderr.resume(); // Diagnostics may contain private paths; never send them to the UI.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 16 * 1024 * 1024) { child.kill(); fail(); return; }
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const value = ResponseSchema.parse(JSON.parse(line));
        if (value.id === undefined) continue;
        const item = pending.get(value.id);
        if (!item) continue;
        pending.delete(value.id);
        if (value.error) item.reject(new Error(value.error.message)); else item.resolve(value.result);
      } catch { fail(); child.kill(); }
    }
  });
  return {
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Codex did not acknowledge the request'));
        child.kill();
      }, 10_000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    }),
    notify: method => { child.stdin.write(`${JSON.stringify({ method })}\n`); },
    close: () => { child.kill(); fail(); },
  };
}
export async function codexConnection(threadId: string) {
  if (process.env.REV_CODEX_SHARED_SERVER !== '1')
    throw new Error('Codex forwarding needs a desktop session using the shared app server');
  const client = connectCodex();
  try {
    await client.request('initialize', { clientInfo: { name: 'rev', version: '1.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    client.notify('initialized');
    const state = ThreadSchema.parse(await client.request('thread/read', { threadId, includeTurns: true }));
    if (!['idle', 'active'].includes(state.thread.status.type))
      throw new Error('Open the originating chat in the shared-server Codex session');
    const activeTurn = state.thread.turns?.slice().reverse().find(turn => turn.status === 'inProgress')?.id;
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

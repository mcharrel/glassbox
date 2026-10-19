import { Hono } from 'hono';
import { z } from 'zod';

import { isPullAuthor } from '../../api/workspace.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';
import { flushCodexComments } from '../../workspace/codex.js';
import { codexEnabled } from '../../workspace/codex-settings.js';
import { codexHandshake, codexSetupStatus, configureCodex } from '../../workspace/codex-setup.js';
import { reconcileCommentRouting } from '../../workspace/service.js';
import { saveWorkspace, workspaceData } from '../../workspace/storage.js';

export const codexConnectionRoutes = new Hono<AppEnv>();
codexConnectionRoutes.use('/codex/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.req.method !== 'GET' && c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'Use application/json.' }, 415);
  await next();
});
codexConnectionRoutes.get('/codex/connection', async c => c.json(await codexSetupStatus()));
codexConnectionRoutes.put('/codex/connection', async c => {
  const input = await parseBody(c, z.object({ enabled: z.boolean() }));
  if (!input.ok) return input.response;
  try {
    const result = await configureCodex(input.data.enabled);
    if (result.state === 'connected') void flushCodexComments();
    return c.json(result);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not configure Codex.' }, 400); }
});
codexConnectionRoutes.get('/codex/chats', async c => {
  if (!codexEnabled()) return c.json({ chats: [] });
  const client = await codexHandshake();
  try {
    const loaded = z.object({ data: z.array(z.string()) }).parse(await client.request('thread/loaded/list', {}));
    const chats = await Promise.all(loaded.data.slice(0, 50).map(async id => {
      try {
        const result = z.object({ thread: z.object({ id: z.string(), name: z.string().nullish(), preview: z.string().optional() }) })
          .parse(await client.request('thread/read', { threadId: id, includeTurns: false }));
        return { id, title: (result.thread.name ?? '') || (result.thread.preview?.slice(0, 100) ?? '') || 'Untitled chat' };
      } catch { return null; }
    }));
    return c.json({ chats: chats.filter(chat => chat !== null) });
  } finally { client.close(); }
});
codexConnectionRoutes.post('/codex/link', async c => {
  const input = await parseBody(c, z.object({ key: z.string(), threadId: z.uuid() }));
  if (!input.ok) return input.response;
  const tab = workspaceData().tabs.find(tab => tab.key === input.data.key);
  if (!tab || !isPullAuthor(tab)) return c.json({ error: 'Only your own PR can be linked to Codex.' }, 403);
  if (tab.codexThreadId !== undefined && tab.codexThreadId !== input.data.threadId) return c.json({ error: 'This PR is already linked to another chat.' }, 409);
  if (!codexEnabled()) return c.json({ error: 'Enable the Codex connection first.' }, 400);
  const client = await codexHandshake();
  try {
    const result = z.object({ thread: z.object({ id: z.string(), status: z.object({ type: z.string() }) }) })
      .parse(await client.request('thread/read', { threadId: input.data.threadId, includeTurns: false }));
    if (result.thread.id !== input.data.threadId || !['idle', 'active'].includes(result.thread.status.type)) return c.json({ error: 'Open that chat in Codex first.' }, 400);
    if (!workspaceData().tabs.includes(tab) || !isPullAuthor(tab) || !codexEnabled() || (tab.codexThreadId !== undefined && tab.codexThreadId !== input.data.threadId)) return c.json({ error: 'The PR is no longer available.' }, 409);
    tab.codexThreadId = input.data.threadId;
    reconcileCommentRouting(tab); saveWorkspace(); void flushCodexComments();
    return c.json({ ok: true as const });
  } finally { client.close(); }
});

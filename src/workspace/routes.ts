import { Hono } from 'hono';

import { codeCommentDestination, VisibilitySchema, WorkspaceMutationSchema } from '../api/workspace.js';
import type { AppEnv } from '../types.js';
import { parseBody } from '../utils/parseBody.js';
import { listCodexComments, pickUpCodexComment, postCodexReply } from './codex-reply.js';
import { authorizeControl, CodexCommentSchema, CodexCommentsSchema, CodexOpenSchema, CodexReplySchema } from './control.js';
import { parsePullUrl, pullKey } from './github.js';
import { reportVisibility } from './notifications.js';
import { searchAllFiles } from './search.js';
import { flushSourceRefreshes, mutateWorkspace, reconcileCommentRouting, refreshAfterReply } from './service.js';
import { saveWorkspace, workspaceData  } from './storage.js';

export const workspaceRoutes = new Hono<AppEnv>();
workspaceRoutes.post('/codex-comments', async c => {
  if (!authorizeControl(c.req.header('x-rev-token'))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = await parseBody(c, CodexCommentsSchema);
  if (!parsed.ok) return parsed.response;
  try { return c.json({ comments: listCodexComments(parsed.data) }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not read comments' }, 400); }
});
workspaceRoutes.post('/codex-pickup', async c => {
  if (!authorizeControl(c.req.header('x-rev-token'))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = await parseBody(c, CodexCommentSchema);
  if (!parsed.ok) return parsed.response;
  try { pickUpCodexComment(parsed.data); return c.json({ ok: true }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not pick up comment' }, 400); }
});
workspaceRoutes.post('/codex-reply', async c => {
  if (!authorizeControl(c.req.header('x-rev-token'))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = await parseBody(c, CodexReplySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const id = postCodexReply(parsed.data);
    const tab = workspaceData().tabs.find(item => item.key === pullKey(parsePullUrl(parsed.data.url)));
    if (tab?.sourceRefreshRequested !== undefined) void refreshAfterReply(tab);
    return c.json({ ok: true, id });
  }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not post reply' }, 400); }
});
workspaceRoutes.post('/codex-open', async c => {
  if (!authorizeControl(c.req.header('x-rev-token'))) return c.json({ error: 'Unauthorized' }, 401);
  const parsed = await parseBody(c, CodexOpenSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const key = pullKey(parsePullUrl(parsed.data.url));
    const before = workspaceData().tabs.find(tab => tab.key === key);
    if (before && codeCommentDestination(before) !== 'github' && parsed.data.threadId !== undefined && before.codexThreadId !== undefined && before.codexThreadId !== parsed.data.threadId)
      return c.json({ error: 'This PR is already linked to another Codex chat' }, 409);
    await mutateWorkspace({ op: 'open', url: parsed.data.url }, c.get('reviewId'));
    const tab = workspaceData().tabs.find(item => item.key === key);
    if (tab && parsed.data.threadId !== undefined && codeCommentDestination(tab) !== 'github') tab.codexThreadId = parsed.data.threadId;
    if (tab) reconcileCommentRouting(tab);
    workspaceData().externalSelection = (workspaceData().externalSelection ?? 0) + 1;
    saveWorkspace();
    return c.json({ ok: true, linked: Boolean(tab?.codexThreadId) });
  } catch {
    return c.json({ error: 'Could not open the PR' }, 400);
  }
});
workspaceRoutes.post('/visibility', async c => {
  const parsed = await parseBody(c, VisibilitySchema);
  if (!parsed.ok) return parsed.response;
  reportVisibility(parsed.data.id, parsed.data.visible, Date.now(), parsed.data.codeTab, parsed.data.draftTab);
  void flushSourceRefreshes();
  return c.json({ ok: true });
});
workspaceRoutes.get('/', (c) => {
  const { tabs, active, externalSelection } = workspaceData();
  return c.json({ tabs, active, externalSelection });
});
workspaceRoutes.post('/', async (c) => {
  const parsed = await parseBody(c, WorkspaceMutationSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await mutateWorkspace(parsed.data, c.get('reviewId'));
    const { tabs, active, externalSelection } = workspaceData();
    return c.json({ tabs, active, externalSelection });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Workspace request failed',
      },
      400,
    );
  }
});

workspaceRoutes.get('/search', async (c) =>
  c.json(await searchAllFiles(c.get('reviewId'), (c.req.query('q') ?? '').slice(0, 1000))),
);

import { Hono } from 'hono';

import { WorkspaceMutationSchema } from '../api/workspace.js';
import type { AppEnv } from '../types.js';
import { parseBody } from '../utils/parseBody.js';
import { searchAllFiles } from './search.js';
import { mutateWorkspace } from './service.js';
import { workspaceData } from './storage.js';

export const workspaceRoutes = new Hono<AppEnv>();
workspaceRoutes.get('/', (c) => {
  const { tabs, active } = workspaceData();
  return c.json({ tabs, active });
});
workspaceRoutes.post('/', async (c) => {
  const parsed = await parseBody(c, WorkspaceMutationSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await mutateWorkspace(parsed.data, c.get('reviewId'));
    const { tabs, active } = workspaceData();
    return c.json({ tabs, active });
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

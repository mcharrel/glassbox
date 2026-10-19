import { Hono } from 'hono';

import { GitHubAccountsSchema } from '../../api/github-accounts.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';
import { getAccountSettings, saveAccountSettings } from '../../workspace/accounts.js';
import { refreshAccountRouting } from '../../workspace/service.js';

export const githubAccountsRoutes = new Hono<AppEnv>();
githubAccountsRoutes.get('/github/accounts', async c => {
  c.header('Cache-Control', 'no-store');
  try { return c.json(await getAccountSettings()); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not read GitHub accounts.' }, 400); }
});
githubAccountsRoutes.put('/github/accounts', async c => {
  if (c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'Use application/json.' }, 415);
  const parsed = await parseBody(c, GitHubAccountsSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await saveAccountSettings(parsed.data);
    refreshAccountRouting();
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not save GitHub accounts.' }, 400); }
});

import { Hono } from 'hono';

import { SaveSlackSettingsSchema } from '../../api/slack-reactions.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';
import { cancelSlackReactions } from '../../workspace/slack-reactions.js';
import { disconnectSlack, saveSlackSettings, slackSettings } from '../../workspace/slack-settings.js';

export const slackReactionsRoutes = new Hono<AppEnv>();
slackReactionsRoutes.use('/slack/reactions', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
slackReactionsRoutes.get('/slack/reactions', c => c.json(slackSettings()));
slackReactionsRoutes.put('/slack/reactions', async c => {
  if (c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'Use application/json.' }, 415);
  const parsed = await parseBody(c, SaveSlackSettingsSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await saveSlackSettings(parsed.data);
    cancelSlackReactions();
    return c.json(result);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not save Slack settings.' }, 400); }
});
slackReactionsRoutes.delete('/slack/reactions', c => {
  cancelSlackReactions();
  try { return c.json(disconnectSlack()); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not disconnect Slack.' }, 400); }
});

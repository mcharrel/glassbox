import { Hono } from 'hono';

import { SaveSlackSettingsSchema, slackMessageTarget, TestSlackReactionSchema } from '../../api/slack-reactions.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';
import { addSlackReactions } from '../../workspace/slack-provider.js';
import { cancelSlackReactions } from '../../workspace/slack-reactions.js';
import { disconnectSlack, saveSlackSettings, slackSettings } from '../../workspace/slack-settings.js';

let testController: AbortController | undefined;
export const slackReactionsRoutes = new Hono<AppEnv>();
slackReactionsRoutes.use('/slack/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
slackReactionsRoutes.get('/slack/reactions', async c => c.json(await slackSettings()));
slackReactionsRoutes.put('/slack/reactions', async c => {
  if (c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'Use application/json.' }, 415);
  const parsed = await parseBody(c, SaveSlackSettingsSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await saveSlackSettings(parsed.data);
    cancelSlackReactions();
    testController?.abort();
    return c.json(result);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not save Slack settings.' }, 400); }
});
slackReactionsRoutes.delete('/slack/reactions', async c => {
  cancelSlackReactions();
  testController?.abort();
  try { return c.json(await disconnectSlack()); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not disconnect Slack.' }, 400); }
});

let testing = false;
slackReactionsRoutes.post('/slack/reactions/test', async c => {
  if (c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'Use application/json.' }, 415);
  const parsed = await parseBody(c, TestSlackReactionSchema);
  if (!parsed.ok) return parsed.response;
  if (testing) return c.json({ error: 'A Slack test is already running. Wait for its result.' }, 409);
  const target = slackMessageTarget(parsed.data.messageUrl);
  if (!target) return c.json({ error: 'Paste a Slack message link copied from Slack.' }, 400);
  testing = true;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, c.req.raw.signal, AbortSignal.timeout(120_000)]);
  testController = controller;
  try {
    const settings = await saveSlackSettings(parsed.data);
    cancelSlackReactions();
    signal.throwIfAborted();
    const added = await addSlackReactions(settings.settings, target, settings.settings.approvedEmoji, signal);
    signal.throwIfAborted();
    return c.json({ settings, message: added.length ? `Connection working — ${added.map(name => `:${name}:`).join(' and ')} ${added.length === 1 ? 'is' : 'are'} on the Slack message.` : '' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Slack did not confirm the reaction. Check the message before retrying.' }, 400);
  } finally { testing = false; if (testController === controller) testController = undefined; }
});

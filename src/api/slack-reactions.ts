import { z } from 'zod';

import { apiCall } from './_runner.js';

const emoji = z.string().trim().transform(value => value.replace(/^:|:$/g, '')).pipe(
  z.string().min(1).max(100).regex(/^[\w+-]+(?:::skin-tone-[2-6])?$/, 'Use a Slack emoji name, such as stamp-approved.'),
);
export const SlackPreferencesSchema = z.object({
  provider: z.enum(['token', 'claude']).default('token'),
  enabled: z.boolean().default(false),
  approvedEmoji: emoji.default('stamp-approved'),
  changesEmoji: emoji.default('request-changes'),
});
export type SlackPreferences = z.infer<typeof SlackPreferencesSchema>;
export const SlackSettingsSchema = z.object({
  settings: SlackPreferencesSchema,
  connected: z.boolean(),
  keychainAvailable: z.boolean(),
  workspace: z.string().default(''),
  user: z.string().default(''),
});
export type SlackSettings = z.infer<typeof SlackSettingsSchema>;
export const SaveSlackSettingsSchema = z.object({
  settings: SlackPreferencesSchema,
  token: z.string().trim().min(1).max(4096).optional(),
});
export const getSlackSettings = () => apiCall(SlackSettingsSchema, '/slack/reactions');
export const saveSlackSettings = (body: z.infer<typeof SaveSlackSettingsSchema>) =>
  apiCall(SlackSettingsSchema, '/slack/reactions', { method: 'PUT', body });
export const disconnectSlack = () => apiCall(SlackSettingsSchema, '/slack/reactions', { method: 'DELETE' });

/** Parse a permalink without fetching the supplied URL. Thread queries don't change its target. */
export function slackMessageTarget(value: string): { channel: string; timestamp: string } | null {
  try {
    const url = new URL(value);
    const match = /^\/archives\/([CGD][A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^[a-z0-9-]+(?:\.enterprise)?\.slack\.com$/.test(url.hostname) || !match) return null;
    return { channel: match[1], timestamp: `${match[2]}.${match[3]}` };
  } catch { return null; }
}
export const TestSlackReactionSchema = SaveSlackSettingsSchema.extend({
  messageUrl: z.string().trim().max(2048).refine(value => slackMessageTarget(value) !== null, 'Paste a Slack message link copied from Slack.'),
}).refine(value => value.settings.enabled, 'Enable Slack review reactions before testing.');
export const TestSlackReactionResultSchema = z.object({ message: z.string(), settings: SlackSettingsSchema });
export const testSlackReaction = (body: z.infer<typeof TestSlackReactionSchema>) =>
  apiCall(TestSlackReactionResultSchema, '/slack/reactions/test', { method: 'POST', body });

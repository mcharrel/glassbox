import { z } from 'zod';

import { apiCall } from './_runner.js';

const emoji = z.string().trim().transform(value => value.replace(/^:|:$/g, '')).pipe(
  z.string().min(1).max(100).regex(/^[\w+-]+(?:::skin-tone-[2-6])?$/, 'Use a Slack emoji name, such as stamp-approved.'),
);
export const SlackPreferencesSchema = z.object({
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

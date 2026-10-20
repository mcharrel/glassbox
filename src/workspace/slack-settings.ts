import { z } from 'zod';

import { deleteSecretFromKeychain, getSecretFromKeychain, isKeychainAvailable, saveSecretToKeychain } from '../ai/keychain.js';
import { type SaveSlackSettingsSchema, SlackPreferencesSchema, type SlackSettings } from '../api/slack-reactions.js';
import { readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import { validateSlackToken } from './slack-api.js';
import { checkClaudeSlack } from './slack-claude.js';

const ACCOUNT = 'slack-review-token';
const ConfigSchema = SlackPreferencesSchema.extend({ workspace: z.string().default(''), user: z.string().default('') });
let saving = false;
export function slackPreferences() {
  const parsed = ConfigSchema.safeParse(readGlobalConfig().slackReactions ?? {});
  return parsed.success ? parsed.data : ConfigSchema.parse({});
}
export function slackToken(): string | null { return getSecretFromKeychain(ACCOUNT); }
export async function slackSettings(knownClaudeConnection?: boolean): Promise<SlackSettings> {
  const { workspace, user, ...settings } = slackPreferences();
  return { settings, workspace: settings.provider === 'token' ? workspace : '', user: settings.provider === 'token' ? user : '', connected: settings.provider === 'claude' ? (knownClaudeConnection ?? await checkClaudeSlack()) : Boolean(slackToken()), keychainAvailable: isKeychainAvailable() };
}
function restoreToken(previous: string | null): void {
  try {
    if (previous === null) deleteSecretFromKeychain(ACCOUNT);
    else saveSecretToKeychain(ACCOUNT, previous, 'rev Slack');
  } catch { /* The caller reports the failed save without exposing keychain output. */ }
}
export async function saveSlackSettings(input: z.infer<typeof SaveSlackSettingsSchema>): Promise<SlackSettings> {
  if (saving) throw new Error('Slack settings are already being saved. Try again.');
  saving = true;
  try {
    if (input.settings.provider === 'claude' && input.token !== undefined) throw new Error('A token can only be saved for the Slack app connection.');
    const claudeConnected = input.settings.provider === 'claude' ? await checkClaudeSlack() : false;
    if (input.settings.provider === 'claude' && input.settings.enabled && !claudeConnected) throw new Error('Connect the official Slack plugin in Claude Code first. See Slack setup instructions.');
    const current = slackPreferences();
    const previousToken = input.settings.provider === 'token' ? slackToken() : null;
    let identity = { workspace: current.workspace, user: current.user };
    if (input.token !== undefined) {
      if (!isKeychainAvailable()) throw new Error('A system keychain is required to store the Slack connection.');
      identity = await validateSlackToken(input.token);
      try { saveSecretToKeychain(ACCOUNT, input.token, 'rev Slack'); }
      catch {
        restoreToken(previousToken);
        throw new Error('Could not save the Slack connection in your system keychain.');
      }
    }
    if (input.settings.provider === 'token' && input.settings.enabled && (slackToken() ?? '') === '') throw new Error('Connect Slack before enabling review reactions.');
    try { updateGlobalConfig(config => { config.slackReactions = { ...input.settings, ...identity }; }); }
    catch {
      if (input.token !== undefined) restoreToken(previousToken);
      throw new Error('Could not save Slack settings. Check that your local configuration is writable.');
    }
    return await slackSettings(claudeConnected);
  } finally { saving = false; }
}
export async function disconnectSlack(): Promise<SlackSettings> {
  if (saving) throw new Error('Slack settings are already being saved. Try again.');
  updateGlobalConfig(config => { config.slackReactions = { ...slackPreferences(), enabled: false, workspace: '', user: '' }; });
  deleteSecretFromKeychain(ACCOUNT);
  if ((slackToken() ?? '') !== '') throw new Error('Reactions are disabled, but the system keychain could not remove the Slack token. Try disconnecting again.');
  return slackSettings();
}

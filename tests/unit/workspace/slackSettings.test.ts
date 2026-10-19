import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ config: {} as Record<string, any>, failConfig: false, secret: null as string | null, available: true, write: vi.fn(), auth: vi.fn() }));
vi.mock('../../../src/global-config.js', () => ({ readGlobalConfig: () => mocks.config, updateGlobalConfig: (update: Function) => { if (mocks.failConfig) throw new Error('disk unavailable'); update(mocks.config); } }));
vi.mock('../../../src/ai/keychain.js', () => ({
  getSecretFromKeychain: () => mocks.secret, isKeychainAvailable: () => mocks.available,
  saveSecretToKeychain: (...args: unknown[]) => mocks.write(...args),
  deleteSecretFromKeychain: () => { mocks.secret = null; },
}));
vi.mock('../../../src/workspace/slack-api.js', () => ({ validateSlackToken: mocks.auth }));
import { SlackPreferencesSchema, SaveSlackSettingsSchema } from '../../../src/api/slack-reactions.js';
import { disconnectSlack, saveSlackSettings, slackPreferences, slackSettings } from '../../../src/workspace/slack-settings.js';
const preferences = () => SlackPreferencesSchema.parse({});
beforeEach(() => {
  mocks.config = { unrelated: { preserved: true } }; mocks.failConfig = false; mocks.secret = null; mocks.available = true;
  mocks.write.mockReset().mockImplementation((_account, token) => { mocks.secret = token; });
  mocks.auth.mockReset().mockResolvedValue({ workspace: 'Example', user: 'alice' });
});
it('defaults off and validates shortcode names including optional colons', () => {
  expect(slackPreferences()).toMatchObject({ enabled: false, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' });
  expect(SlackPreferencesSchema.parse({ approvedEmoji: ':thumbsup::skin-tone-3:' }).approvedEmoji).toBe('thumbsup::skin-tone-3');
  for (const value of ['', ':', 'two words', '👍']) expect(SlackPreferencesSchema.safeParse({ approvedEmoji: value }).success).toBe(false);
  expect(SaveSlackSettingsSchema.safeParse({ settings: preferences(), token: '' }).success).toBe(false);
});
it('stores credentials only in the keychain and never returns them to the client', async () => {
  const token = 'xoxp-test-only-not-a-credential';
  const result = await saveSlackSettings({ settings: { ...preferences(), enabled: true }, token });
  expect(mocks.write).toHaveBeenCalledWith('slack-review-token', token, 'rev Slack');
  expect(result).toMatchObject({ connected: true, workspace: 'Example', user: 'alice', settings: { enabled: true } });
  expect(JSON.stringify(result)).not.toContain(token);
  expect(JSON.stringify(mocks.config)).not.toContain(token);
  expect(mocks.config.unrelated).toEqual({ preserved: true });
  expect(disconnectSlack()).toMatchObject({ connected: false, settings: { enabled: false } });
});
it('refuses enablement without a connection and leaves prior preferences intact on authentication failure', async () => {
  await expect(saveSlackSettings({ settings: { ...preferences(), enabled: true } })).rejects.toThrow('Connect Slack');
  mocks.auth.mockRejectedValue(new Error('Missing permissions'));
  await expect(saveSlackSettings({ settings: { ...preferences(), enabled: true }, token: 'fixture' })).rejects.toThrow('Missing permissions');
  expect(slackSettings().settings.enabled).toBe(false); expect(mocks.write).not.toHaveBeenCalled();
});
it('does not fall back to plaintext storage or reveal keychain errors', async () => {
  mocks.available = false;
  await expect(saveSlackSettings({ settings: preferences(), token: 'fixture' })).rejects.toThrow('system keychain');
  expect(mocks.auth).not.toHaveBeenCalled();
  mocks.available = true; mocks.write.mockImplementation(() => { throw new Error('private fixture credential'); });
  await expect(saveSlackSettings({ settings: preferences(), token: 'fixture' })).rejects.toThrow('Could not save the Slack connection');
  expect(mocks.config.slackReactions).toBeUndefined();
});
it('serializes connection changes while validation is in flight', async () => {
  let finish!: Function;
  mocks.auth.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = saveSlackSettings({ settings: preferences(), token: 'fixture' });
  await expect(saveSlackSettings({ settings: preferences() })).rejects.toThrow('already being saved');
  expect(() => disconnectSlack()).toThrow('already being saved');
  finish({ workspace: 'Example', user: 'alice' }); await first;
});

it('restores the previous credential if saving preferences fails during replacement', async () => {
  await saveSlackSettings({ settings: { ...preferences(), enabled: true }, token: 'previous-fixture' });
  mocks.failConfig = true;
  await expect(saveSlackSettings({ settings: preferences(), token: 'new-fixture' })).rejects.toThrow('configuration is writable');
  expect(mocks.secret).toBe('previous-fixture'); expect(mocks.config.slackReactions.enabled).toBe(true);
});

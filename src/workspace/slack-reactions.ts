import { type PullTab, viewerReviewState } from '../api/workspace.js';
import { closingTabs } from './lifecycle.js';
import { reactWithSlackProvider } from './slack-provider.js';
import { slackPreferences } from './slack-settings.js';
import { saveWorkspace, workspaceData } from './storage.js';

const jobs = new Map<PullTab, AbortController>();
export function cancelSlackReaction(tab: PullTab): void {
  jobs.get(tab)?.abort();
  jobs.delete(tab);
  delete tab.slackReaction;
}
export function cancelSlackReactions(): void {
  for (const tab of workspaceData().tabs) cancelSlackReaction(tab);
  saveWorkspace();
}
export function stopSlackReactions(): void {
  for (const controller of jobs.values()) controller.abort();
  jobs.clear();
}
export function recoverSlackReactions(): void {
  for (const tab of workspaceData().tabs) if (tab.slackReaction?.status === 'pending') {
    tab.slackReaction.status = 'error';
    tab.slackReaction.message = 'rev restarted before Slack reactions finished. Retry to finish adding them.';
  }
}
export function retrySlackReaction(tab: PullTab): void {
  const previous = tab.slackReaction;
  if (previous?.status !== 'error') throw new Error('No failed Slack reaction to retry.');
  if (!slackPreferences().enabled) throw new Error('Enable Slack reactions in Settings → Slack first.');
  if (tab.viewer.toLowerCase() !== previous.reviewer.toLowerCase() || viewerReviewState(tab) !== previous.review)
    throw new Error('Your review or GitHub account has changed. Submit the intended review before reacting in Slack.');
  queueSlackReaction(tab, { reviewer: previous.reviewer, state: previous.review });
}

/** Only called with GitHub's successful review receipt, never from metadata polling. */
export function queueSlackReaction(tab: PullTab, receipt: { reviewer: string; state: string }): void {
  cancelSlackReaction(tab);
  const settings = slackPreferences();
  if (!settings.enabled || tab.viewer.toLowerCase() !== receipt.reviewer.toLowerCase() || (receipt.state !== 'APPROVED' && receipt.state !== 'CHANGES_REQUESTED') ||
    closingTabs.has(tab) || !workspaceData().tabs.includes(tab)) return;
  const job: NonNullable<PullTab['slackReaction']> = { status: 'pending', review: receipt.state, reviewer: receipt.reviewer, count: 0 };
  tab.slackReaction = job;
  const controller = new AbortController();
  jobs.set(tab, controller);
  const current = () => jobs.get(tab) === controller && workspaceData().tabs.includes(tab) && !closingTabs.has(tab);
  // Let the accepted GitHub review return immediately, including when the keychain is locked.
  setImmediate(() => {
    void (async () => {
      if (!current()) return;
      const emoji = job.review === 'APPROVED' ? settings.approvedEmoji : settings.changesEmoji;
      await reactWithSlackProvider(settings, tab.ref.url, emoji, controller.signal, count => {
        if (current()) job.count = count;
      });
      if (current()) {
        if (job.count) tab.slackReaction = { ...job, status: 'done', message: `Reacted to ${job.count} Slack message${job.count === 1 ? '' : 's'}.` };
        else delete tab.slackReaction;
      }
    })().catch((error: unknown) => {
      if (current()) tab.slackReaction = { ...job, status: 'error', message: `${job.count ? `${job.count} message(s) already reacted to. ` : ''}${error instanceof Error ? error.message : 'Could not add Slack reactions.'}` };
    }).finally(() => {
      if (current()) { jobs.delete(tab); saveWorkspace(); }
    });
  });
}

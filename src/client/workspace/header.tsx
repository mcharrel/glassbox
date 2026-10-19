import { isPullAuthor, type PullTab, viewerReviewState } from '../../api/workspace.js';
import { IconShareApple, IconX } from '../../icons.js';

/** Shared Main/File header; unavailable totals stay pending instead of looking empty. */
export function pullHeader(tab: PullTab, counts: { added: number; removed: number } | null) {
  const info = tab.info;
  const own = isPullAuthor(tab);
  const selected = own && info ? (info.state === 'CLOSED' ? 'close' : info.isDraft ? 'draft' : 'ready') : '';
  const review = own ? '' : viewerReviewState(tab);
  const reviewLabel = review === 'APPROVED' ? 'Approved' : review === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Review';
  const reviewClass = review === 'APPROVED' ? ' pr-review-approved' : review === 'CHANGES_REQUESTED' ? ' pr-review-changes' : '';
  const options = own
    ? [['draft', 'Draft'], ['ready', 'Ready for Review'], ['close', 'Close']]
    : [['approve', 'Approve'], ['changes', 'Request code change'], ['humanize', 'Make explanations more human']];
  return <>
    <div className="pr-heading">
      <h2 data-workspace={own ? 'title' : undefined} title={own ? 'Click to edit PR title' : undefined}>
        {info?.title ?? `${tab.ref.owner}/${tab.ref.repo} #${tab.ref.number}`}
      </h2>
      <button className="btn btn-xs" data-workspace="share" title="Copy PR link" aria-label="Share PR: copy GitHub link"><IconShareApple /></button>
      <button className="btn btn-xs" data-workspace="close" title="Remove PR tab"><IconX /></button>
    </div>
    <div className="pr-counts">
      {counts ? <><span className="pr-additions">+{counts.added}</span>{' '}<span className="pr-deletions">-{counts.removed}</span></> : 'Loading changes…'}
    </div>
    <div className="review-mode pr-branches">
      {info ? <><div>{info.headRefName}</div>
        {!['prod', 'main'].includes(info.baseRefName) && <div>{'-> '}{info.baseRefName}</div>}</> : 'Loading…'}
    </div>
    <div className="pr-actions">
      {info?.state === 'MERGED' ? <button className="pr-merged-status" disabled>Merged</button> :
        <select className={`pr-action-select${reviewClass}`} aria-label={own ? 'PR status' : 'Review PR'} data-pr-action="" disabled={!info}>
          {!own && <option value="" selected disabled>{reviewLabel}</option>}
          {options.map(([action, label]) => <option value={action} selected={selected === action}>{label}</option>)}
        </select>}
    </div>
    {Boolean(tab.error) && <div className="workspace-error" title={tab.error}>{tab.error}</div>}
    {tab.slackReaction && <div className="pr-slack-status" role={tab.slackReaction.status === 'error' ? 'alert' : 'status'}>
      {tab.slackReaction.status === 'pending' ? 'Adding Slack reactions…' : tab.slackReaction.message}
      {tab.slackReaction.status === 'error' && <button className="btn btn-xs" data-workspace="retry-slack">Retry Slack</button>}
    </div>}
    {tab.sourceRefreshRequested === undefined && tab.reviewedHead && info && tab.reviewedHead !== info.headRefOid &&
      <div className="workspace-error">New commits on GitHub. Press Cmd+R to refresh this review.</div>}
  </>;
}

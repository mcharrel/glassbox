import { delegate, effect, mount } from 'kerfjs';

import { type PullTab, reviewerStates } from '../../api/workspace.js';
import { parseDiffData } from '../../git/parseDiffData.js';
import { IconGear, IconX } from '../../icons.js';
import { renderNoteMarkdown } from '../../utils/noteMarkdown.js';
import { refreshFind } from '../diff/find.js';
import { navigateToLocation } from '../diff/goToDefinition.js';
import { invalidateDiffCache } from '../diff/index.js';
import { asEl, asInput, asTextarea, toElement } from '../dom.js';
import { loadFiles } from '../sidebar/fileTree.js';
import { filePriority } from '../sidebar/readingOrder.js';
import { allFileOrder, reviewStore } from '../stores/index.js';
import { openExternalUrl } from '../tauri.js';
import { showToast } from '../toast.js';
import { bindDivider } from './resize.js';
import { activeTab, addingPull, mutate, refreshWorkspace, workspace } from './state.js';
import { bindThreads, threadHtml } from './threads.js';

function lifecycle(tab: PullTab): string {
  return tab.info?.state === 'MERGED'
    ? 'merged'
    : tab.info?.state === 'CLOSED'
      ? 'closed'
      : tab.info?.isDraft === true
        ? 'draft'
        : 'open';
}
function title(tab: PullTab): string {
  return tab.info?.title ?? `${tab.ref.owner}/${tab.ref.repo} #${tab.ref.number}`;
}
function tabList() {
  const state = workspace.value;
  return (
    <>
      <div className="pr-tabs-list">
        {state.tabs.map((tab) => (
          <button
            className={`pr-tab ${lifecycle(tab)} ${state.active === tab.key && !addingPull.value ? 'selected' : ''}`}
            data-tab={tab.key}
            data-key={tab.key}
            title={title(tab)}
          >
            <span className="pr-status-dot"></span>
            <span className="pr-tab-number">#{tab.ref.number}</span>
            <span className="pr-tab-title">{title(tab)}</span>
            {tab.loading && <span className="pr-loading">…</span>}
          </button>
        ))}
      </div>
      <button className="pr-add" data-workspace="add" title="Add PR">
        +
      </button>
    </>
  );
}
function totals() {
  let added = 0;
  let removed = 0;
  for (const file of reviewStore.state.value.files) {
    if ([2, 4].includes(filePriority(file))) continue;
    for (const hunk of parseDiffData(file.diff_data)?.hunks ?? [])
      for (const line of hunk.lines) {
        if (line.type === 'add') added++;
        else if (line.type === 'remove') removed++;
      }
  }
  return { added, removed };
}
function header(tab: PullTab) {
  const info = tab.info;
  const own = info?.author.login === tab.viewer;
  const buttons = own
    ? [
        ['draft', 'Draft'],
        ['ready', 'Ready for Review'],
        ['close', 'Close'],
      ]
    : [
        ['approve', 'Approve'],
        ['changes', 'Request Changes'],
        ['slop', 'This is AI slop'],
      ];
  const selected = own ? (info.state === 'CLOSED' ? 'close' : info.isDraft ? 'draft' : 'ready') : tab.action;
  const counts = tab.reviewId === document.body.dataset.reviewId ? totals() : { added: 0, removed: 0 };
  return (
    <>
      <div className="pr-heading">
        <h2 data-workspace="title" title="Click to edit PR title">
          {title(tab)}
        </h2>
        <button className="btn btn-xs" data-workspace="settings" title="Settings">
          <IconGear />
        </button>
        <button className="btn btn-xs" data-workspace="close" title="Remove PR tab">
          <IconX />
        </button>
      </div>
      <div className="review-mode">{info ? `${info.baseRefName} ← ${info.headRefName}` : 'Loading…'}</div>
      <div className="pr-counts">
        <span className="pr-additions">+{counts.added}</span>{' '}
        <span className="pr-deletions">-{counts.removed}</span>
      </div>
      <div className="pr-actions">
        {info?.state === 'MERGED' ? (
          <button className="selected" disabled>
            Merged
          </button>
        ) : (
          buttons.map(([action, label]) => (
            <button
              data-key={action}
              data-pr-action={action}
              className={selected === action ? 'selected' : ''}
              disabled={!info}
            >
              {label}
            </button>
          ))
        )}
      </div>
      {Boolean(tab.error) && (
        <div className="workspace-error" title={tab.error}>
          {tab.error}
        </div>
      )}
      {tab.reviewedHead && info && tab.reviewedHead !== info.headRefOid && (
        <div className="workspace-error">New commits on GitHub. Press Cmd+R to refresh this review.</div>
      )}
    </>
  );
}
function reviewers(tab: PullTab) {
  const states = tab.info ? reviewerStates(tab.info) : new Map<string, string>();
  return (
    <>
      <h3>Reviewers</h3>
      {[...states]
        .filter(([name]) => name)
        .map(([name, state]) => (
          <div className="pr-reviewer" data-key={name}>
            <span className={state === 'APPROVED' ? 'review-approved' : 'review-pending'} title={state}>
              {state === 'APPROVED' ? '✓' : '●'}
            </span>
            {tab.slack[name] ? (
              <a href={tab.slack[name]} target="_blank" rel="noreferrer">
                {name}
              </a>
            ) : (
              <span>{name}</span>
            )}
          </div>
        ))}
    </>
  );
}
function checks(tab: PullTab) {
  if (tab.info?.state === 'MERGED') return <h3>Deployment</h3>;
  const rank = (check: NonNullable<NonNullable<PullTab['info']>['statusCheckRollup']>[number]) => {
    const state = check.conclusion ?? check.state ?? check.status;
    return ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state ?? '')
      ? 0
      : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state ?? '')
        ? 2
        : 1;
  };
  return (
    <>
      <h3>CI checks</h3>
      {[...(tab.info?.statusCheckRollup ?? [])]
        .sort((a, b) => rank(a) - rank(b))
        .map((check) => (
          <div className={`pr-check check-${rank(check)}`} data-key={check.name ?? check.context}>
            <span>{['×', '●', '✓'][rank(check)]}</span>
            <a href={check.detailsUrl ?? check.targetUrl} target="_blank" rel="noreferrer">
              {check.name ?? check.context}
            </a>
          </div>
        ))}
    </>
  );
}
function switchTo(tab: PullTab): void {
  addingPull.value = false;
  workspace.value = { ...workspace.value, active: tab.key };
  void mutate({ op: 'select', key: tab.key });
}
export function initWorkspace(): void {
  const body = document.querySelector('.review-body');
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  const main = document.querySelector('.main-content');
  const oldHeader = document.querySelector<HTMLElement>('.sidebar-header');
  if (!body || !sidebar || !main || !oldHeader) return;
  const rail = toElement(<aside className="pr-tabs compact" aria-label="Pull requests"></aside>);
  const railDivider = toElement(
    <div
      className="workspace-divider vertical"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize PR tabs"
      tabIndex={0}
    ></div>,
  );
  body.prepend(rail, railDivider);
  mount(rail, tabList);
  bindDivider(railDivider, rail, 'width', 'glassbox.tabsWidth', 100, 100);
  const headerDivider = toElement(
    <div
      className="workspace-divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize PR header"
      tabIndex={0}
    ></div>,
  );
  oldHeader.after(headerDivider);
  bindDivider(headerDivider, oldHeader, 'height', 'glassbox.headerHeight', 130, 180);
  const mainSections = toElement(
    <div className="pr-main-sections">
      <section className="pr-reviewers"></section>
      <div
        className="workspace-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize reviewers"
        tabIndex={0}
      ></div>
      <section className="pr-checks"></section>
      <div
        className="workspace-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize CI checks"
        tabIndex={0}
      ></div>
      <section className="pr-conversation">
        <h3>Comments</h3>
        <textarea className="pr-comment-input" placeholder="Comment ..."></textarea>
        <div className="pr-conversation-list"></div>
      </section>
    </div>,
  );
  headerDivider.after(mainSections);
  const reviewerSection = asEl(mainSections.querySelector<HTMLElement>('.pr-reviewers'));
  const checksSection = asEl(mainSections.querySelector<HTMLElement>('.pr-checks'));
  const conversation = asEl(mainSections.querySelector<HTMLElement>('.pr-conversation-list'));
  bindDivider(
    reviewerSection.nextElementSibling as HTMLElement,
    reviewerSection,
    'height',
    'glassbox.reviewersHeight',
    55,
    120,
  );
  bindDivider(
    checksSection.nextElementSibling as HTMLElement,
    checksSection,
    'height',
    'glassbox.checksHeight',
    55,
    180,
  );
  const description = toElement(<section className="pr-description" aria-label="PR description"></section>);
  const add = toElement(
    <section className="pr-add-screen">
      <div>
        <h2>Open a pull request</h2>
        <input className="pr-url-input" placeholder="https://github.com/owner/repo/pull/123" />
        <button className="btn btn-primary" data-workspace="load">
          Open PR
        </button>
        <p className="pr-load-status"></p>
      </div>
    </section>,
  );
  main.append(description);
  body.append(add);
  let mountedHeader = false;
  let navigationTarget: string | null = null;
  let renderedHead: string | null = null;
  effect(() => {
    const tab = activeTab();
    const adding = addingPull.value || workspace.value.tabs.length === 0;
    document.body.dataset.workspaceView = adding ? 'add' : (tab?.view ?? 'file');
    if (tab !== undefined && tab.reviewId === document.body.dataset.reviewId) {
      if (renderedHead !== null && renderedHead !== tab.reviewedHead) {
        void loadFiles().then(() => {
          invalidateDiffCache();
        });
      }
      renderedHead = tab.reviewedHead;
    }
    if (tab && !mountedHeader) {
      mountedHeader = true;
      mount(oldHeader, () => {
        const current = activeTab();
        return current ? header(current) : <></>;
      });
    }
    if (
      tab !== undefined &&
      tab.reviewId !== null &&
      tab.reviewId !== document.body.dataset.reviewId &&
      !adding
    ) {
      if (navigationTarget !== tab.reviewId) {
        navigationTarget = tab.reviewId;
        window.location.assign(`/?reviewId=${encodeURIComponent(tab.reviewId)}`);
      }
    }
  });
  mount(reviewerSection, () => {
    const tab = activeTab();
    return tab ? reviewers(tab) : <></>;
  });
  mount(checksSection, () => {
    const tab = activeTab();
    return tab ? checks(tab) : <></>;
  });
  mount(conversation, () => {
    const tab = activeTab();
    queueMicrotask(refreshFind);
    return (
      <>
        {tab?.comments
          .filter((m) => !m.deleted && m.kind === 'issue')
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((m) => threadHtml(m, tab.comments))}
        {tab && !tab.commentsLoaded && <p>Loading comments…</p>}
      </>
    );
  });
  let editingDescription = false;
  effect(() => {
    const tab = activeTab();
    if (!editingDescription)
      description.replaceChildren(
        toElement(
          <div className="pr-description-body">
            {renderNoteMarkdown(tab?.info?.body ?? 'Loading description…')}
          </div>,
        ),
      );
  });
  description.addEventListener('click', (event) => {
    if (editingDescription || (event.target as Element).closest('a')) return;
    const tab = activeTab();
    if (!tab?.info) return;
    editingDescription = true;
    const form = toElement(
      <div className="pr-description-editor">
        <textarea>{tab.info.body}</textarea>
        <button className="btn btn-primary" data-save>
          Save
        </button>
        <button className="btn" data-cancel>
          Cancel
        </button>
      </div>,
    );
    description.replaceChildren(form);
    const textarea = asTextarea(form.querySelector('textarea'));
    textarea.focus();
    const finish = async (save: boolean) => {
      if (save && !(await mutate({ op: 'edit', key: tab.key, body: textarea.value }))) return;
      editingDescription = false;
      workspace.value = { ...workspace.value };
    };
    asEl(form.querySelector('[data-save]')).addEventListener('click', (e) => {
      e.stopPropagation();
      void finish(true);
    });
    asEl(form.querySelector('[data-cancel]')).addEventListener('click', (e) => {
      e.stopPropagation();
      void finish(false);
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        e.stopPropagation();
        void finish(e.key === 'Enter');
      }
    });
  });
  const editTitle = (tab: PullTab, target: Element | null = oldHeader.querySelector('h2')) => {
    const input = asInput(toElement(<input className="pr-title-input" value={title(tab)} />));
    if (!target) return;
    target.replaceWith(input);
    input.focus();
    input.select();
    let saving = false;
    const save = async () => {
      if (saving) return;
      saving = true;
      if (input.value.trim() && input.value !== title(tab))
        await mutate({ op: 'edit', key: tab.key, title: input.value });
      workspace.value = { ...workspace.value };
    };
    input.addEventListener('blur', () => {
      void save();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        saving = true;
        workspace.value = { ...workspace.value };
      }
    });
  };
  let tabClick: ReturnType<typeof setTimeout> | undefined;
  void delegate(rail, 'click', '[data-tab]', (event, element) => {
    if ((event.target as Element).closest('input')) return;
    const tab = workspace.value.tabs.find((t) => t.key === (element as HTMLElement).dataset.tab);
    clearTimeout(tabClick);
    if (tab) {
      if (rail.classList.contains('compact')) switchTo(tab);
      else tabClick = setTimeout(() => { switchTo(tab); }, 250);
    }
  });
  void delegate(rail, 'dblclick', '[data-tab]', (_event, element) => {
    clearTimeout(tabClick);
    if (rail.classList.contains('compact')) return;
    const tab = workspace.value.tabs.find((t) => t.key === (element as HTMLElement).dataset.tab);
    if (tab) editTitle(tab, element.querySelector('.pr-tab-title'));
  });
  bindTabReorder(rail);
  void delegate(document.body, 'click', '[data-workspace]', (_event, element) => {
    const action = (element as HTMLElement).dataset.workspace;
    const tab = activeTab();
    if (action === 'add') {
      addingPull.value = true;
      add.querySelector('input')?.focus();
    } else if (action === 'load') void loadPullInput(add);
    else if (action === 'settings')
      void import('../settings/dialog.js').then((m) => {
        m.showSettingsDialog();
      });
    else if (action === 'title' && tab) editTitle(tab);
    else if (action === 'close' && tab) void mutate({ op: 'close', key: tab.key });
  });
  asInput(add.querySelector('input')).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void loadPullInput(add);
  });
  void delegate(oldHeader, 'click', '[data-pr-action]', (_event, element) => {
    const action = (element as HTMLElement).dataset.prAction;
    const tab = activeTab();
    if (!tab) return;
    if (action === 'slop') {
      void mutate({ op: 'close', key: tab.key });
      return;
    }
    if (action === 'changes') {
      const box = toElement(
        <div className="request-changes-form">
          <textarea placeholder="Describe the changes needed…"></textarea>
          <button className="btn btn-primary">Request Changes</button>
        </div>,
      );
      oldHeader.querySelector('.request-changes-form')?.remove();
      oldHeader.append(box);
      asTextarea(box.querySelector('textarea')).focus();
      asEl(box.querySelector('button')).addEventListener('click', () => {
        void mutate({
          op: 'action',
          key: tab.key,
          action: 'changes',
          body: asTextarea(box.querySelector('textarea')).value,
        }).then((ok) => {
          if (ok) box.remove();
        });
      });
    } else if (action === 'draft' || action === 'ready' || action === 'close' || action === 'approve')
      void mutate({ op: 'action', key: tab.key, action });
  });
  const commentInput = asTextarea(mainSections.querySelector<HTMLTextAreaElement>('.pr-comment-input'));
  commentInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    const tab = activeTab();
    if (!tab || !commentInput.value.trim() || commentInput.disabled) return;
    const text = commentInput.value;
    commentInput.disabled = true;
    void mutate({ op: 'comment', key: tab.key, body: text })
      .then((ok) => {
        if (ok) commentInput.value = '';
      })
      .finally(() => {
        commentInput.disabled = false;
        commentInput.focus();
      });
  });
  void delegate(
    document.body,
    'click',
    '.pr-reviewer a, .pr-check a, .pr-description a, .pr-message a',
    (event, element) => {
      const url = element.getAttribute('href');
      if (url !== null && openExternalUrl(url)) event.preventDefault();
    },
  );
  bindThreads();
  bindWorkspaceKeys();
  void refreshWorkspace().catch((error: unknown) => {
    showToast(String(error));
  });
  setInterval(() => {
    void refreshWorkspace().catch(() => {});
  }, 2000);
}
async function loadPullInput(container: HTMLElement): Promise<void> {
  const input = asInput(container.querySelector<HTMLInputElement>('input'));
  if (await mutate({ op: 'open', url: input.value })) {
    addingPull.value = false;
    input.value = '';
  }
}
function bindTabReorder(rail: HTMLElement): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dragging: HTMLElement | null = null;
  let suppressClick = false;
  rail.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }
    },
    true,
  );
  rail.addEventListener('pointerdown', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('[data-tab]');
    if (!row) return;
    timer = setTimeout(() => {
      dragging = row;
      suppressClick = true;
      row.classList.add('dragging');
      rail.setPointerCapture(event.pointerId);
    }, 350);
  });
  rail.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-tab]');
    if (target && target !== dragging)
      target.insertAdjacentElement(
        event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2
          ? 'afterend'
          : 'beforebegin',
        dragging,
      );
  });
  const stop = () => {
    clearTimeout(timer);
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    void mutate({
      op: 'order',
      keys: [...rail.querySelectorAll<HTMLElement>('[data-tab]')].map((row) => row.dataset.tab ?? ''),
    });
  };
  rail.addEventListener('pointerup', stop);
  rail.addEventListener('pointercancel', stop);
  window.addEventListener('pointerup', stop);
}
function bindWorkspaceKeys(): void {
  let hovered: Element | null = null;
  document.addEventListener('pointermove', (event) => {
    hovered = event.target instanceof Element ? event.target : null;
  });
  document.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const tab = activeTab();
    if (event.altKey && event.key === 'Tab') {
      event.preventDefault();
      const tabs = workspace.value.tabs;
      const index = tabs.findIndex((t) => t === tab);
      const next = tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
      if (tabs.length > 0) switchTo(next);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (tab)
        void mutate({ op: 'refresh', key: tab.key })
          .then(() => loadFiles())
          .then(() => {
            invalidateDiffCache();
          });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!tab?.info) return;
      const line = hovered?.closest<HTMLElement>('.diff-line');
      const row = hovered?.closest<HTMLElement>('.file-item');
      const file = row
        ? reviewStore.state.value.files.find((f) => f.id === row.dataset.fileId)?.file_path
        : document.querySelector<HTMLElement>('.diff-view')?.dataset.filePath;
      if (file !== undefined && (line || row)) {
        const sha =
          line?.dataset.side === 'old'
            ? tab.reviewedBase || tab.info.baseRefOid
            : tab.reviewedHead || tab.info.headRefOid;
        const record = reviewStore.state.value.files.find((f) => f.file_path === file);
        const path =
          line?.dataset.side === 'old' && record ? (parseDiffData(record.diff_data)?.oldPath ?? file) : file;
        const url = `https://github.com/${tab.ref.owner}/${tab.ref.repo}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line.dataset.line}` : ''}`;
        void navigator.clipboard.writeText(url).then(() => {
          showToast('GitHub link copied');
        });
      }
      return;
    }
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (event.target as Element).closest('input, textarea, select, [contenteditable="true"], dialog') ||
      document.querySelector('dialog[open]')
    )
      return;
    if (event.key === 'r' && tab) {
      event.preventDefault();
      tab.view = tab.view === 'main' ? 'file' : 'main';
      workspace.value = { ...workspace.value };
      void mutate({ op: 'view', key: tab.key, view: tab.view });
    }
    if ((event.key === 'c' || event.key === 'v' || event.key === 'C') && tab?.view === 'file') {
      event.preventDefault();
      const direction = event.key === 'c' ? 1 : -1;
      void navigateComment(direction);
    }
  });
}
let commentCursor: HTMLElement | null = null;
let commentScroll = -1;
async function navigateComment(direction: number): Promise<void> {
  const pane = document.getElementById('diff-container');
  if (!pane) return;
  const top = pane.getBoundingClientRect().top + 25;
  const threads = [
    ...pane.querySelectorAll<HTMLElement>(
      '[data-comment-thread], .annotation-item:not([data-comment-thread])',
    ),
  ];
  const previousIndex =
    commentCursor !== null && Math.abs(pane.scrollTop - commentScroll) < 2
      ? threads.indexOf(commentCursor)
      : -1;
  const ordered = direction < 0 ? [...threads].reverse() : threads;
  const next =
    previousIndex >= 0
      ? threads[previousIndex + direction]
      : ordered.find((t) =>
          direction > 0 ? t.getBoundingClientRect().top > top + 5 : t.getBoundingClientRect().top < top - 5,
        );
  if (next !== undefined) {
    next.scrollIntoView({ block: 'start', behavior: 'instant' });
    commentCursor = next;
    commentScroll = pane.scrollTop;
    return;
  }
  const files = allFileOrder.value
    .map((id) => reviewStore.state.value.files.find((file) => file.id === id))
    .filter((file) => file !== undefined);
  const current = files.findIndex((f) => f.id === reviewStore.state.value.currentFileId);
  for (let offset = 1; offset < files.length; offset++) {
    const file = files[(current + direction * offset + files.length) % files.length];
    const comment = activeTab()?.comments.find(
      (m) => !m.deleted && m.path === file.file_path && (m.line ?? 0) > 0,
    );
    if (comment?.line !== undefined && comment.line !== null) {
      const hidden = new Set(reviewStore.state.value.hiddenFileIds);
      hidden.delete(file.id);
      reviewStore.actions.update({ hiddenFileIds: hidden });
      await navigateToLocation(file.file_path, comment.line);
      const thread = pane.querySelector<HTMLElement>(`[data-comment-thread="${comment.id}"]`);
      if (thread) {
        thread.scrollIntoView({ block: 'start', behavior: 'instant' });
        commentCursor = thread;
        commentScroll = pane.scrollTop;
      }
      return;
    }
  }
}

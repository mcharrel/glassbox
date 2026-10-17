import { delegate, effect } from 'kerfjs';

import type { ThreadMessage } from '../../api/workspace.js';
import { IconTrash } from '../../icons.js';
import { renderNoteMarkdown } from '../../utils/noteMarkdown.js';
import { refreshFind } from '../diff/find.js';
import { asTextarea, toElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';
import { showToast } from '../toast.js';
import { commentAnchor } from './commentAnchor.js';
import { activeTab, mutate, workspace } from './state.js';

export function messageHtml(message: ThreadMessage) {
  const pending = message.status === 'pending' || message.status === 'error';
  return (
    <article
      className={`pr-message ${message.kind === 'ai' ? 'agent-message' : ''}`}
      data-message={message.id}
      data-key={message.id}
      data-editable={message.editable ? 'true' : 'false'}
    >
      <div className="pr-message-meta">
        {pending && (
          <span
            className="comment-offline"
            title={message.error ?? 'Waiting to sync; retrying every five minutes'}
          >
            ☁
          </span>
        )}
        <span>{message.author}</span>
        <time dateTime={message.date}>{new Date(message.date).toLocaleString()}</time>
        <span className="pr-message-actions">
          <button
            className="btn btn-xs comment-share"
            data-comment-action="share"
            title="Copy GitHub comment link"
            disabled={!message.url}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8" />
            </svg>
          </button>
          {message.editable && (
            <button className="btn btn-xs btn-danger" data-comment-action="delete" title="Delete">
              <IconTrash />
            </button>
          )}
        </span>
      </div>
      <div className="pr-message-body">{renderNoteMarkdown(message.body)}</div>
      {message.status === 'working' && <div className="agent-status">AI working…</div>}
      {Boolean(message.error) && (
        <div className="workspace-error">
          {message.error}
          {message.kind === 'ai' && (
            <button className="btn btn-xs" data-comment-action="retry">
              Retry
            </button>
          )}
        </div>
      )}
    </article>
  );
}
export function threadHtml(root: ThreadMessage, comments: ThreadMessage[]) {
  const replies = comments.filter(
    (m) =>
      !m.deleted &&
      (m.parentKey === root.id || (root.remoteId !== undefined && m.parentId === root.remoteId)),
  );
  return (
    <div className="pr-thread" data-comment-thread={root.id} data-key={root.id}>
      {messageHtml(root)}
      {replies.map((reply) => (
        <>
          {messageHtml(reply)}
          {comments.filter((child) => !child.deleted && child.parentKey === reply.id).map(messageHtml)}
        </>
      ))}
      {root.kind === 'review' && root.remoteId !== undefined && (
        <textarea className="pr-reply-input" data-reply-to={root.remoteId} placeholder="Reply ..." />
      )}
    </div>
  );
}
export function bindThreads(): void {
  const candidate = document.getElementById('diff-container');
  if (!candidate) return;
  const pane = candidate;
  let previousView: Element | null = null;
  let previous = '';
  function render(): void {
    const tab = activeTab();
    const view = pane.querySelector<HTMLElement>('.diff-view');
    if (!tab || !view || tab.reviewId !== reviewStore.state.value.reviewId
      || view.dataset.fileId !== reviewStore.state.value.currentFileId) return;
    const signature = JSON.stringify(tab.comments);
    if (view === previousView && signature === previous) return;
    if (pane.querySelector('textarea:focus')) return;
    previousView = view;
    previous = signature;
    pane
      .querySelectorAll(
        '.pr-inline-thread, .local-thread-details, .local-comment-status, .local-comment-share',
      )
      .forEach((el) => {
        el.remove();
      });
    for (const message of tab.comments) {
      if (!message.deleted || message.annotationId === undefined) continue;
      const item = pane.querySelector(`[data-annotation-id="${message.annotationId}"]`);
      const row = item?.closest('.annotation-row');
      item?.remove();
      if (row && !row.querySelector('.annotation-item')) row.remove();
    }
    const comments = tab.comments.filter((m) => !m.deleted);
    const roots = comments.filter(
      (m) => m.kind === 'review' && m.parentId === undefined && m.path === view.dataset.filePath,
    );
    for (const root of roots) {
      const local =
        root.annotationId !== undefined
          ? pane.querySelector<HTMLElement>(`[data-annotation-id="${root.annotationId}"]`)
          : null;
      if (local) {
        local.dataset.commentThread = root.id;
        const localText = local.querySelector('.annotation-text');
        if (localText && localText.textContent !== root.body) localText.textContent = root.body;
        const status = toElement(
          <span className="local-comment-status" title={root.error ?? 'Queued for GitHub'}>
            {root.status === 'synced' ? '' : '☁'}
          </span>,
        );
        local.prepend(status);
        const share = toElement(
          <button
            className="btn btn-xs local-comment-share"
            title="Copy GitHub comment link"
            disabled={!root.url}
          >
            ↗
          </button>,
        );
        share.addEventListener('click', (e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(root.url).then(() => {
            showToast('Comment link copied');
          });
        });
        local.querySelector('.annotation-actions')?.prepend(share);
        const replies = comments.filter(
          (m) => m.parentKey === root.id || (root.remoteId !== undefined && m.parentId === root.remoteId),
        );
        const details = toElement(
          <div className="local-thread-details">
            {replies.map((reply) => (
              <>
                {messageHtml(reply)}
                {comments.filter((child) => !child.deleted && child.parentKey === reply.id).map(messageHtml)}
              </>
            ))}
            {root.kind === 'review' && root.remoteId !== undefined && (
              <textarea className="pr-reply-input" data-reply-to={root.remoteId} placeholder="Reply ..." />
            )}
          </div>,
        );
        local.after(details);
        continue;
      }
      const line = commentAnchor(view, root);
      // Outdated/unanchored remote comments belong to history, not the current code.
      if (!line) continue;
      const holder = toElement(
        <div className="annotation-row pr-inline-thread">{threadHtml(root, comments)}</div>,
      );
      (line.closest('.split-row') ?? line).after(holder);
    }
    refreshFind();
  }
  effect(() => {
    void workspace.value;
    void reviewStore.state.value.currentFileId;
    render();
  });
  document.addEventListener('glassbox-diff-ready', () => {
    previousView = null;
    render();
  });
  document.addEventListener('glassbox-comment-saved', () => {
    previous = '';
    render();
  });
  void delegate(document.body, 'click', '[data-comment-action]', (event, element) => {
    event.stopPropagation();
    const item = element.closest<HTMLElement>('[data-message]');
    const tab = activeTab();
    const message = tab?.comments.find((m) => m.id === item?.dataset.message);
    if (!tab || !message) return;
    if ((element as HTMLElement).dataset.commentAction === 'share')
      void navigator.clipboard.writeText(message.url).then(() => {
        showToast('Comment link copied');
      });
    else if ((element as HTMLElement).dataset.commentAction === 'retry')
      void mutate({ op: 'retry-agent', key: tab.key, id: message.id });
    else void mutate({ op: 'delete-comment', key: tab.key, id: message.id });
  });
  void delegate(document.body, 'click', '.pr-message[data-editable="true"]', (event, element) => {
    if (
      (event.target as Element).closest('button, a, textarea, input') ||
      window.getSelection()?.isCollapsed === false
    )
      return;
    const item = element as HTMLElement;
    const tab = activeTab();
    const message = tab?.comments.find((m) => m.id === item.dataset.message);
    if (!tab || !message || item.querySelector('textarea')) return;
    const body = item.querySelector('.pr-message-body');
    if (!body) return;
    const textarea = asTextarea(toElement(<textarea className="pr-message-editor">{message.body}</textarea>));
    body.replaceWith(textarea);
    textarea.focus();
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        textarea.replaceWith(body);
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!textarea.value.trim() || textarea.disabled) return;
        textarea.disabled = true;
        void mutate({
          op: 'edit-comment',
          key: tab.key,
          id: message.id,
          body: textarea.value,
        }).then((ok) => {
          if (!ok) {
            textarea.disabled = false;
            return;
          }
          textarea.blur();
          textarea.replaceWith(body);
          previous = '';
          render();
        });
      }
    });
  });
  void delegate(document.body, 'keydown', '.pr-reply-input', (event, element) => {
    const e = event as KeyboardEvent;
    const input = element as HTMLTextAreaElement;
    const tab = activeTab();
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || !tab || !input.value.trim() || input.disabled)
      return;
    e.preventDefault();
    input.disabled = true;
    void mutate({
      op: 'comment',
      key: tab.key,
      body: input.value,
      parentId: Number(input.dataset.replyTo),
    })
      .then((ok) => {
        if (ok) {
          input.value = '';
          input.blur();
          previous = '';
          render();
        }
      })
      .finally(() => {
        input.disabled = false;
      });
  });
}

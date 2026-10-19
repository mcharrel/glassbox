import { delegate, morph } from 'kerfjs';

import { deleteAnnotation, keepAnnotation } from '../../api/index.js';
import { asEl, asElOrNull } from '../dom.js';
import type { Annotation } from '../state.js';
import { reviewStore } from '../stores/index.js';
import { showToast } from '../toast.js';
import { bindAttachmentEvents } from './attachments.js';
import { buildAnnotationItemHtml } from './render.js';

/** Register all annotation-related delegates on the diff container. Called
 *  once from `initDiffView()`. Annotations are server-rendered inline in the
 *  diff HTML (under a `data-morph-skip` wrapper from Phase 4) — these
 *  delegated handlers fire for every annotation row, current and future,
 *  without ever needing per-element `addEventListener`. */
export function bindAnnotationEvents(diffContainer: HTMLElement): void {
  // Attachment chips/upload/preview delegates (doc 25) — same once-per-surface
  // model as the annotation handlers below.
  bindAttachmentEvents(diffContainer);

  void delegate(diffContainer, 'click', '.annotation-item [data-action="delete"]', (e, btn) => {
    e.stopPropagation();
    const item = asEl(btn).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    const button = btn as HTMLButtonElement;
    if (button.disabled) return;
    button.disabled = true;
    void handleDelete(item).catch((error: unknown) => { showToast(String(error)); }).finally(() => { button.disabled = false; });
  });

  void delegate(diffContainer, 'click', '.annotation-item [data-action="keep"]', (e, btn) => {
    e.stopPropagation();
    const item = asEl(btn).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    void handleKeep(item);
  });
}

function readAnnotation(item: HTMLElement): Annotation | null {
  const id = item.dataset.annotationId;
  if (id === undefined || id === '') return null;
  const category = item.dataset.category ?? 'note';
  const content = item.querySelector('.annotation-text')?.textContent ?? '';
  const isStale = item.dataset.isStale === 'true';
  // Preserve the artifact-region marker across re-renders (GB-953) so an
  // edit/keep morph doesn't drop a reply's marked-region thumbnail.
  const regionData = item.dataset.regionData ?? null;
  return { id, category, content, is_stale: isStale, region_data: regionData, reply_to_note_id: item.dataset.replyToNoteId ?? null };
}

async function handleDelete(item: HTMLElement): Promise<void> {
  const annotation = readAnnotation(item);
  if (annotation === null) return;
  const annotationRow = item.closest<HTMLElement>('.annotation-row');
  const lineEl = asElOrNull(annotationRow?.previousElementSibling);

  await deleteAnnotation({ id: annotation.id });
  item.remove();
  if (annotationRow !== null && annotationRow.querySelector('.annotation-item') === null) {
    annotationRow.remove();
    lineEl?.classList.remove('has-annotation');
  }
  const fileId = reviewStore.state.value.currentFileId ?? '';
  const ann = reviewStore.state.value.annotationCounts[fileId] ?? 1;
  reviewStore.actions.setAnnotationCount(fileId, Math.max(0, ann - 1));
  if (annotation.is_stale) {
    const stale = reviewStore.state.value.staleCounts[fileId] ?? 1;
    reviewStore.actions.setStaleCount(fileId, Math.max(0, stale - 1));
  }
}

async function handleKeep(item: HTMLElement): Promise<void> {
  const annotation = readAnnotation(item);
  if (annotation === null) return;
  await keepAnnotation({ id: annotation.id });
  const updated = { ...annotation, is_stale: false };
  item.classList.remove('annotation-stale');
  delete item.dataset.isStale;
  morph(item, buildAnnotationItemHtml(updated));
  const fileId = reviewStore.state.value.currentFileId ?? '';
  const stale = reviewStore.state.value.staleCounts[fileId] ?? 1;
  reviewStore.actions.setStaleCount(fileId, Math.max(0, stale - 1));
}

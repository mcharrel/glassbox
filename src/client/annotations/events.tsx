import { delegate, morph } from 'kerfjs';

import { deleteAnnotation, keepAnnotation, updateAnnotation } from '../../api/index.js';
import { asEl, asElement, asElOrNull, asTextarea, cssEscape, toElement } from '../dom.js';
import { asCategory } from '../narrow.js';
import type { Annotation } from '../state.js';
import {
  editFormSignal,
  reviewStore,
  setEditForm,
} from '../stores/index.js';
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
    void handleDelete(item);
  });

  void delegate(diffContainer, 'click', '.annotation-item', (e, item) => {
    // Keep buttons, links, attachments and text selection independently usable.
    if (asElement(e.target).closest('button, a, input, textarea, select, .attachment-chip, .ai-note-reply-region')) return;
    if (window.getSelection()?.isCollapsed === false) return;
    e.stopPropagation();
    startEdit(asEl(item));
  });

  void delegate(diffContainer, 'keydown', '.annotation-item', (e, item) => {
    if (e.target !== item || (e as KeyboardEvent).key !== 'Enter') return;
    e.preventDefault();
    startEdit(asEl(item));
  });

  void delegate(diffContainer, 'click', '.annotation-item [data-action="keep"]', (e, btn) => {
    e.stopPropagation();
    const item = asEl(btn).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    void handleKeep(item);
  });

  // Edit-form delegates. Scoped to `[data-edit-for]` so the equivalent
  // create-form delegates in `form.tsx` (which target `[data-form-key]`)
  // don't double-fire — both forms reuse the `.annotation-form` shell.
  void delegate(diffContainer, 'click', '.annotation-form-container[data-edit-for] .cancel-edit', (e) => {
    e.stopPropagation();
    cancelEdit();
  });

  void delegate(diffContainer, 'click', '.annotation-form-container[data-edit-for] .save-edit', (e) => {
    e.stopPropagation();
    void saveEdit();
  });

  void delegate(diffContainer, 'input', '.annotation-form-container[data-edit-for] textarea', (_e, textarea) => {
    const cur = editFormSignal.value;
    if (cur === null) return;
    setEditForm({ ...cur, content: asTextarea(textarea).value });
  });

  void delegate(diffContainer, 'keydown', '.annotation-form-container[data-edit-for] textarea', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !ke.shiftKey && !ke.isComposing) {
      ke.preventDefault();
      void saveEdit();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      cancelEdit();
    }
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

function startEdit(item: HTMLElement): void {
  const annotation = readAnnotation(item);
  if (annotation === null) return;
  const annotationRow = item.closest<HTMLElement>('.annotation-row');
  if (annotationRow === null) return;

  if (editFormSignal.value !== null) return;

  // Seed the edit-form signal so any concurrent re-render reads the same
  // content/category we're about to put in the textarea.
  setEditForm({
    annotationId: annotation.id,
    formKey: null,
    content: annotation.content,
    category: annotation.category,
  });

  const formContainer = toElement(
    <div className="annotation-form-container" data-edit-for={annotation.id}>
      <div className="annotation-form">
        <textarea>{annotation.content}</textarea>
        <div className="annotation-form-actions">
          <button className="btn btn-sm cancel-edit">Cancel</button>
          <button className="btn btn-sm save-edit">Save</button>
        </div>
      </div>
    </div>
  );

  item.style.display = 'none';
  annotationRow.parentNode?.insertBefore(formContainer, annotationRow.nextSibling);

  const textarea = formContainer.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea !== null) {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}

function cancelEdit(): void {
  closeEditForm();
}

let saving = false;
async function saveEdit(): Promise<void> {
  if (saving) return;
  const state = editFormSignal.value;
  if (state === null || state.annotationId === null) return;
  const content = state.content.trim();
  if (content === '') return;

  saving = true;
  try {
    await updateAnnotation({
      id: state.annotationId,
      content,
      category: asCategory(state.category),
    });

    const item = findAnnotationItem(state.annotationId);
    if (item !== null) {
      const updated: Annotation = {
        ...readAnnotation(item),
        id: state.annotationId,
        category: state.category,
        content,
        is_stale: item.dataset.isStale === 'true',
      };
      morph(item, buildAnnotationItemHtml(updated));
      item.style.display = '';
    }
    closeEditForm();
    document.dispatchEvent(new Event('glassbox-comment-saved'));
    void import('../workspace/state.js').then(m => m.refreshWorkspace());
  } finally { saving = false; }
}

function closeEditForm(): void {
  const state = editFormSignal.value;
  const id = state?.annotationId ?? null;
  setEditForm(null);
  if (id !== null) {
    document.querySelectorAll<HTMLElement>(`.annotation-form-container[data-edit-for="${cssEscape(id)}"]`).forEach(el => { el.remove(); });
    const item = findAnnotationItem(id);
    if (item !== null) item.style.display = '';
  }
}

function findAnnotationItem(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.annotation-item[data-annotation-id="${cssEscape(id)}"]`);
}

// Expose `closeEditForm` so the diff view's outside-click handler (if any)
// can dismiss the picker without reaching into module internals.
export { closeEditForm };

import type { SafeHtml } from 'kerfjs';

import { renderNoteMarkdown } from '../../utils/noteMarkdown.js';
import type { FileNotes } from '../state.js';
import { aiStore, reviewStore } from '../stores/index.js';

/** Reading guidance follows the selected file independently of diff mounts. */
export function sidebarNotesJsx(): SafeHtml {
  const { currentFileId, files } = reviewStore.state.value;
  const file = files.find(item => item.id === currentFileId);
  if (!file) return <></>;
  const ai = aiStore.state.value;
  const guide = ai.sortMode === 'narrative' || ai.sortMode === 'risk' ? ai.fileNotes[file.id] : undefined;
  const learn = ai.guidedReviewEnabled ? ai.guidedNotes[file.id] : undefined;
  return <>
    {noteSection(guide, ai.sortMode === 'risk' ? 'risk' : 'narrative', file.file_path)}
    {noteSection(learn, 'guided', file.file_path)}
  </>;
}

function noteSection(notes: FileNotes | undefined, kind: 'risk' | 'narrative' | 'guided', filePath: string): SafeHtml | null {
  if (!notes || (notes.overview.trim() === '' && notes.lines.length === 0)) return null;
  const label = kind === 'narrative' ? 'Guide' : kind === 'guided' ? 'Learn' : 'Risk';
  return (
    <section className={`sidebar-ai-note ai-note-${kind}`} aria-label={label}>
      <h3 className={`ai-note-label ai-note-label-${kind}`}>{label}</h3>
      {notes.overview.trim() !== '' ? <div className="ai-note-text">{renderNoteMarkdown(notes.overview)}</div> : null}
      {notes.lines.map(note => (
        <div className="sidebar-note-line">
          <button className="sidebar-note-location" data-note-path={filePath} data-note-line={note.line}>
            Line {note.line}
          </button>
          <div className="ai-note-text">{renderNoteMarkdown(note.content)}</div>
        </div>
      ))}
    </section>
  );
}

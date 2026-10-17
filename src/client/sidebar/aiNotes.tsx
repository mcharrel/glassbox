import type { SafeHtml } from 'kerfjs';

import { renderNoteMarkdown } from '../../utils/noteMarkdown.js';
import type { FileNotes } from '../state.js';
import { aiStore, reviewStore, visibleNoteLines } from '../stores/index.js';

/** Only anchored explanations for code actually visible in the viewport. */
export function sidebarNotesJsx(): SafeHtml {
  const { currentFileId, files } = reviewStore.state.value;
  const file = files.find(item => item.id === currentFileId);
  const visible = visibleNoteLines.value;
  if (!file || visible.fileId !== file.id) return <></>;
  const ai = aiStore.state.value;
  const guide = ai.sortMode === 'narrative' || ai.sortMode === 'risk' ? ai.fileNotes[file.id] : undefined;
  const learn = ai.guidedReviewEnabled ? ai.guidedNotes[file.id] : undefined;
  const guideSection = noteSection(guide, ai.sortMode === 'risk' ? 'risk' : 'narrative', file.file_path, visible.lines);
  const learnSection = noteSection(learn, 'guided', file.file_path, visible.lines);
  return <>{guideSection}{guideSection && learnSection && <div className="guide-learn-divider workspace-divider" role="separator" aria-label="Resize guide and learn" aria-orientation="horizontal" tabIndex={0} />}{learnSection}</>;

}

function noteSection(notes: FileNotes | undefined, kind: 'risk' | 'narrative' | 'guided', filePath: string, visible: ReadonlySet<number>): SafeHtml | null {
  const lines = notes?.lines.filter(note => visible.has(note.line)) ?? [];
  if (lines.length === 0) return null;
  const label = kind === 'narrative' ? 'Guide' : kind === 'guided' ? 'Learn' : 'Risk';
  return (
    <section className={`sidebar-ai-note ai-note-${kind}`} aria-label={label}>
      {lines.map(note => (
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

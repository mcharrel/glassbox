import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { body: { dataset: {} } });
const { aiStore, reviewStore, visibleFileOrder, visibleNoteLines } = await import('../../../src/client/stores/index.js');
const { sidebarNotesJsx } = await import('../../../src/client/sidebar/aiNotes.js');
const { fileListJsx } = await import('../../../src/client/sidebar/fileListView.js');
const { parseDiff } = await import('../../../src/git/parseDiff.js');

const files = ['test/service_test.go', 'src/z.go', 'src/a.go'].map(path => ({
  id: path, file_path: path, review_id: 'r', status: 'pending', created_at: '', diff_data: null,
}));

beforeEach(() => {
  visibleNoteLines.value = { fileId: 'src/z.go', lines: new Set([4, 7, 9]) };
  reviewStore.actions.update({ files, currentFileId: 'src/z.go', filterText: '', groundTruth: {}, annotationCounts: {}, staleCounts: {} });
  aiStore.actions.update({ sortMode: 'narrative', guidedReviewEnabled: true, fileNotes: {}, guidedNotes: {}, narrativeOrder: null });
});

describe('sidebar guidance', () => {
  it('filters notes as their anchors enter and leave the page, retaining Guide before Learn', () => {
    aiStore.actions.update({
      fileNotes: { 'src/z.go': { overview: 'Unanchored summary', lines: [{ line: 7, content: 'Visible guide' }, { line: 400, content: 'Distant guide' }] } },
      guidedNotes: { 'src/z.go': { overview: '', lines: [{ line: 9, content: 'Visible learn' }] } },
    });
    let html = sidebarNotesJsx().toString();
    expect(html).toContain('Visible guide');
    expect(html).toContain('Visible learn');
    expect(html).not.toContain('Distant guide');
    visibleNoteLines.value = { fileId: 'src/z.go', lines: new Set([400]) };
    html = sidebarNotesJsx().toString();
    expect(html).toContain('Distant guide');
    expect(html).not.toContain('Visible guide');
    expect(html).not.toContain('aria-label="Learn"');
    visibleNoteLines.value = { fileId: 'src/z.go', lines: new Set() };
    expect(sidebarNotesJsx().toString()).toBe('');
    visibleNoteLines.value = { fileId: 'src/a.go', lines: new Set([7]) };
    expect(sidebarNotesJsx().toString()).toBe('');
  });

  it('shows Guide before Learn with markdown and clickable line references', () => {
    aiStore.actions.update({
      fileNotes: { 'src/z.go': { overview: '**Guide overview**', lines: [{ line: 7, content: '**Guide detail**' }] } },
      guidedNotes: { 'src/z.go': { overview: 'Learn overview', lines: [{ line: 9, content: 'Learn detail' }] } },
    });
    const html = sidebarNotesJsx().toString();
    expect(html).toContain('<strong>Guide detail</strong>');
    expect(html).not.toContain('Guide overview');
    expect(html).not.toContain('Learn overview');
    expect(html.indexOf('aria-label="Guide"')).toBeLessThan(html.indexOf('aria-label="Learn"'));
    expect(html).toContain('data-note-path="src/z.go" data-note-line="7"');
    expect(html).toContain('Learn detail');
    expect(html).not.toContain('guide-learn-divider');
    expect(html).not.toContain('role="separator"');
  });

  it('updates when analysis arrives, a file changes, or the guided toggle changes', () => {
    expect(sidebarNotesJsx().toString()).toBe('');
    aiStore.actions.update({ guidedNotes: { 'src/z.go': { overview: '', lines: [{ line: 7, content: 'Learn Z' }] } } });
    expect(sidebarNotesJsx().toString()).toContain('Learn Z');
    reviewStore.actions.update({ currentFileId: 'src/a.go' });
    expect(sidebarNotesJsx().toString()).toBe('');
    reviewStore.actions.update({ currentFileId: 'src/z.go' });
    aiStore.actions.update({ guidedReviewEnabled: false });
    expect(sidebarNotesJsx().toString()).toBe('');
  });

  it('keeps Learn independent of sort mode and clears old Guide/Risk sections', () => {
    const notes = { overview: 'Mode overview', lines: [{ line: 7, content: 'Mode note' }] };
    aiStore.actions.update({ fileNotes: { 'src/z.go': notes }, guidedNotes: { 'src/z.go': notes }, sortMode: 'risk' });
    expect(sidebarNotesJsx().toString()).toContain('aria-label="Risk"');
    expect(sidebarNotesJsx().toString()).not.toContain('aria-label="Guide"');
    aiStore.actions.update({ sortMode: 'folder' });
    expect(sidebarNotesJsx().toString()).toContain('aria-label="Learn"');
    expect(sidebarNotesJsx().toString()).not.toContain('aria-label="Risk"');
    reviewStore.actions.update({ currentFileId: null });
    expect(sidebarNotesJsx().toString()).toBe('');
  });

  it('omits empty sections but retains notes that only have line explanations', () => {
    aiStore.actions.update({
      fileNotes: { 'src/z.go': { overview: '  ', lines: [] } },
      guidedNotes: { 'src/z.go': { overview: '', lines: [{ line: 4, content: '<script>alert(1)</script>' }] } },
    });
    const html = sidebarNotesJsx().toString();
    expect(html).not.toContain('aria-label="Guide"');
    expect(html).toContain('data-note-line="4"');
    expect(html).not.toContain('<script>');
  });
});

describe('sidebar order agrees with keyboard navigation', () => {
  it('congratulates only after all loaded files are reviewed, not while loading or filtering', () => {
    reviewStore.actions.update({ hiddenFileIds: new Set(files.map(file => file.id)) });
    expect(fileListJsx().toString()).toContain('You reviewed all the files, congrats!');
    reviewStore.actions.update({ hiddenFileIds: new Set([files[0].id]), filterText: 'missing' });
    expect(fileListJsx().toString()).not.toContain('congrats');
    reviewStore.actions.update({ files: [] });
    expect(fileListJsx().toString()).not.toContain('congrats');
    reviewStore.actions.update({ hiddenFileIds: new Set() });
  });
  it.each(['narrative', 'risk', 'folder'] as const)('keeps change and comment counts separate in %s, including after a PR switch', sortMode => {
    const diff = parseDiff('diff --git a/z.go b/z.go\n--- a/z.go\n+++ b/z.go\n@@ -1,3 +1,3 @@\n-old\n+new\n same\n-old again\n+new again\n')[0];
    reviewStore.actions.update({ files: files.map(file => ({ ...file, diff_data: JSON.stringify(diff) })), annotationCounts: { 'src/z.go': 7 } });
    aiStore.actions.update({ sortMode, riskScores: [{ reviewFileId: 'src/z.go', filePath: 'src/z.go', aggregateScore: 0.5, dimensionScores: {}, rationale: '', sortOrder: 0 }] });
    const html = fileListJsx().toString();
    expect(html.match(/class="change-block-count" title="2 change blocks"/g)).toHaveLength(3);
    expect(html).toContain('class="annotation-count">7</span>');
    reviewStore.actions.update({ files: [files[0]], annotationCounts: {} });
    expect(fileListJsx().toString()).not.toContain('change-block-count');
    reviewStore.actions.update({ files: [] });
    expect(fileListJsx().toString()).not.toContain('change-block-count');
  });

  it('shows filenames alone while retaining full paths in hover titles', () => {
    const html = fileListJsx().toString();
    expect(html).toContain('class="file-name" title="src/z.go">z.go</span>');
    expect(html).not.toContain('file-path-dim');
    aiStore.actions.update({ sortMode: 'risk', riskScores: [{ reviewFileId: 'src/z.go', filePath: 'src/z.go', aggregateScore: 0.5, dimensionScores: {}, rationale: '', sortOrder: 0 }] });
    expect(fileListJsx().toString()).not.toContain('file-path-dim');
  });
  it('uses the same category and AI order while analysis loads and after filtering', () => {
    const renderedIds = () => [...fileListJsx().toString().matchAll(/data-file-id="([^"]+)"/g)].map(match => match[1]);
    expect(renderedIds()).toEqual(['src/a.go', 'src/z.go', 'test/service_test.go']);
    aiStore.actions.update({ narrativeOrder: [{ reviewFileId: 'src/z.go', filePath: 'old/path.go', position: 1, rationale: 'Start here' }] });
    expect(renderedIds()).toEqual(['src/z.go', 'src/a.go', 'test/service_test.go']);
    expect(renderedIds()).toEqual(visibleFileOrder.value);
    reviewStore.actions.update({ filterText: 'src' });
    expect(renderedIds()).toEqual(['src/z.go', 'src/a.go']);
    expect(renderedIds()).toEqual(visibleFileOrder.value);
    reviewStore.actions.update({ filterText: 'missing' });
    expect(renderedIds()).toEqual([]);
    expect(visibleFileOrder.value).toEqual([]);
  });
});

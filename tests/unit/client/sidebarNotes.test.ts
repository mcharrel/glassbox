import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { body: { dataset: {} } });
const { aiStore, reviewStore, visibleFileOrder } = await import('../../../src/client/stores/index.js');
const { sidebarNotesJsx } = await import('../../../src/client/sidebar/aiNotes.js');
const { fileListJsx } = await import('../../../src/client/sidebar/fileListView.js');

const files = ['test/service_test.go', 'src/z.go', 'src/a.go'].map(path => ({
  id: path, file_path: path, review_id: 'r', status: 'pending', created_at: '', diff_data: null,
}));

beforeEach(() => {
  reviewStore.actions.update({ files, currentFileId: 'src/z.go', filterText: '', groundTruth: {}, annotationCounts: {}, staleCounts: {} });
  aiStore.actions.update({ sortMode: 'narrative', guidedReviewEnabled: true, fileNotes: {}, guidedNotes: {}, narrativeOrder: null });
});

describe('sidebar guidance', () => {
  it('shows Guide before Learn with markdown and clickable line references', () => {
    aiStore.actions.update({
      fileNotes: { 'src/z.go': { overview: '**Guide overview**', lines: [{ line: 7, content: 'Guide detail' }] } },
      guidedNotes: { 'src/z.go': { overview: 'Learn overview', lines: [{ line: 9, content: 'Learn detail' }] } },
    });
    const html = sidebarNotesJsx().toString();
    expect(html).toContain('<strong>Guide overview</strong>');
    expect(html.indexOf('aria-label="Guide"')).toBeLessThan(html.indexOf('aria-label="Learn"'));
    expect(html).toContain('data-note-path="src/z.go" data-note-line="7"');
    expect(html).toContain('Learn detail');
  });

  it('updates when analysis arrives, a file changes, or the guided toggle changes', () => {
    expect(sidebarNotesJsx().toString()).toBe('');
    aiStore.actions.update({ guidedNotes: { 'src/z.go': { overview: 'Learn Z', lines: [] } } });
    expect(sidebarNotesJsx().toString()).toContain('Learn Z');
    reviewStore.actions.update({ currentFileId: 'src/a.go' });
    expect(sidebarNotesJsx().toString()).toBe('');
    reviewStore.actions.update({ currentFileId: 'src/z.go' });
    aiStore.actions.update({ guidedReviewEnabled: false });
    expect(sidebarNotesJsx().toString()).toBe('');
  });

  it('keeps Learn independent of sort mode and clears old Guide/Risk sections', () => {
    const notes = { overview: 'Mode note', lines: [] };
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

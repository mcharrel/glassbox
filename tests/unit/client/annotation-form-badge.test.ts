import { readFileSync } from 'node:fs';
import { buildAnnotationItemHtml } from '../../../src/client/annotations/render.js';
describe('simple comment controls', () => {
  it('keeps reply metadata and attachment containers without extra buttons', () => {
    const html = buildAnnotationItemHtml({ id: 'a', content: 'A comment', category: 'bug', is_stale: true, reply_to_note_id: 'note-1' }).toString();
    expect(html).toContain('annotation-reply-tag');
    expect(html).toContain('data-att-list="a"');
    expect(html).toContain('data-action="keep"');
    expect(html).toContain('data-action="delete"');
    for (const control of ['annotation-drag-handle', 'data-action="attach"', 'data-action="edit"', 'annotation-category']) expect(html).not.toContain(control);
  });
  it('omits the category picker from both composers', () => {
    for (const file of ['form.tsx', 'events.tsx']) {
      const source = readFileSync(new URL(`../../../src/client/annotations/${file}`, import.meta.url), 'utf8');
      expect(source).not.toContain('buildCategoryBadge');
    }
  });
});

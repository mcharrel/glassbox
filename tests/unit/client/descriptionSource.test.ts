import { describe, expect, it } from 'vitest';
import { descriptionSourceOffset } from '../../../src/client/workspace/descriptionSource.js';

function check(source: string, rendered: string, word: string, occurrence = 0) {
  const renderedAt = [...rendered.matchAll(new RegExp(word, 'g'))][occurrence].index;
  const sourceAt = source.lastIndexOf(word);
  expect(descriptionSourceOffset(source, rendered, renderedAt + 2)).toBe(sourceAt + 2);
}
describe('description source caret', () => {
  it('keeps the exact character in ordinary and wrapped paragraphs', () => {
    const text = 'First paragraph.\n\nA longer second paragraph wraps across the page.';
    for (let offset = 0; offset < text.length; offset++) {
      if (/\S/.test(text[offset])) expect(descriptionSourceOffset(text, text, offset)).toBe(offset);
    }
  });
  it('skips long links, destinations and reference definitions before the clicked word', () => {
    check('Before [reference](https://example.test/target/target) then target.', 'Before reference then target.', 'target');
    check('[reference]: https://example.test/target\n\nBefore [reference] then target.', 'Before reference then target.', 'target');
  });
  it('uses surrounding text to distinguish repeated words and paragraphs', () => {
    check('Same repeated sentence.\n\nSame repeated sentence.', 'Same repeated sentence.\n\nSame repeated sentence.', 'repeated', 1);
    check('**First** repeated word.\n\n[Link](https://example.test/repeated)\n\n**Second** repeated word.', 'First repeated word.\n\nLink\n\nSecond repeated word.', 'repeated', 1);
  });
  it('does not place the caret in hidden HTML comments, attributes, definitions or image alt text', () => {
    check('<!-- target target -->\n\n<img alt="target" src="https://example.test/image">\n\nVisible target.', '\n\nVisible target.', 'target');
    check('![target](https://example.test/target)\n\nVisible target.', '\nVisible target.', 'target');
    check('<div title="target">Visible target.</div>', 'Visible target.', 'target');
  });
  it('handles bold, headings, lists, tasks, quotes, tables and code fences', () => {
    const cases = [
      ['# Heading\n\nA **target** here.', 'Heading\nA target here.'],
      ['- [x] First\n- Second target', 'First\nSecond target'],
      ['> First line\n> A [link](https://example.test/target)\n> Next target', 'First line\nA link\nNext target'],
      ['| Name | Value |\n| --- | --- |\n| first | target |', 'Name\nValue\nfirst\ntarget'],
      ['```target\ntarget\n```', 'target\n'],
      ['`<target>` then target', '<target> then target'],
    ];
    for (const [source, rendered] of cases) check(source, rendered, 'target', [...rendered.matchAll(/target/g)].length - 1);
  });
  it('maps text split across inline formatting and HTML without losing character offsets', () => {
    const source = 'A re**view** and anoth<span>er</span>.';
    const rendered = 'A review and another.';
    expect(descriptionSourceOffset(source, rendered, rendered.indexOf('view') + 2)).toBe(source.indexOf('view') + 2);
    expect(descriptionSourceOffset(source, rendered, rendered.indexOf('er.') + 1)).toBe(source.indexOf('er</') + 1);
  });
  it('decodes entities while preserving exact source offsets and leaves code literal', () => {
    const source = 'A caf&eacute; &amp; tea. `&amp;` then target.';
    const rendered = 'A café & tea. &amp; then target.';
    expect(descriptionSourceOffset(source, rendered, rendered.indexOf('é'))).toBe(source.indexOf('&eacute;'));
    expect(descriptionSourceOffset(source, rendered, rendered.indexOf('é') + 1)).toBe(source.indexOf('&eacute;') + '&eacute;'.length);
    check(source, rendered, 'target');
  });
  it('preserves UTF-16 offsets with emoji and non-Latin text', () => {
    check('😀 Intro\n\n**Éclair** 世界 target.', '😀 Intro\n\nÉclair 世界 target.', 'target');
  });
  it('handles empty descriptions, missing rendered characters and end-of-text clicks', () => {
    expect(descriptionSourceOffset('', 'Add a description…', 8)).toBe(0);
    expect(descriptionSourceOffset('Text', 'Text', 4)).toBe(4);
    check('Before\n\nActual target.', 'Before generated-label\nActual target.', 'target');
  });
  it('bounds work for large generated markup while retaining the clicked context', () => {
    const source = 'unrendered '.repeat(1200) + 'Unique next target phrase.';
    const rendered = 'Unique next target phrase.';
    check(source, rendered, 'target');
  });
});

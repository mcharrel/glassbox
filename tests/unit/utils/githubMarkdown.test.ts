import { describe, expect, it } from 'vitest';
import { githubMarkdownText, renderGitHubMarkdown } from '../../../src/utils/githubMarkdown.js';

const render = (body: string, html?: string) => String(renderGitHubMarkdown(body, html));
describe('GitHub prose rendering', () => {
  it('renders GFM tables, tasks, nested lists, strike-through, reference links and literal code', () => {
    const result = render('# Heading\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] Done\n- [ ] Pending\n  - Nested\n\n~~old~~ [link][ref]\n\n[ref]: https://example.test\n\n```html\n<img onerror="bad()"> **literal**\n```');
    for (const part of ['<h1>Heading</h1>', '<table>', '<td>1</td>', 'type="checkbox"', 'disabled', 'checked', '<del>old</del>', 'href="https://example.test/"', '&lt;img onerror="bad()"&gt; **literal**']) expect(result).toContain(part);
    expect(result.match(/<ul>/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('renders bot HTML and mixed Markdown without exposing hidden metadata', () => {
    const result = render('<details><summary>Report</summary>\n\n**Passed**\n\n<table><tr><td>Result</td></tr></table>\n</details>\n<!-- internal marker -->\n<picture><source media="(prefers-color-scheme: dark)" srcset="https://example.test/dark.png"><img src="https://example.test/light.png" width="32" alt="Report"></picture>');
    for (const part of ['<details>', '<summary>Report</summary>', '<strong>Passed</strong>', '<table>', '<picture>', '<source', '<img', 'loading="lazy"']) expect(result).toContain(part);
    expect(result).not.toContain('internal marker');
  });
  it('prefers GitHub HTML, including an intentionally empty body, and normalizes links', () => {
    expect(render('raw fallback', '<p><a href="/example/project/issues/2">#2</a></p>')).toContain('href="https://github.com/example/project/issues/2"');
    expect(render('raw fallback', '<p>Rendered</p>')).toBe('<p>Rendered</p>');
    expect(render('hidden source', '')).toBe('');
    expect(render('')).toBe('');
  });
  it.each([undefined, 'remote'])('sanitizes %s content without admitting app actions, forms, CSS or executable URLs', source => {
    const hostile = '<script>bad()</script><style>body{display:none}</style><iframe src="https://evil.test">hidden</iframe><svg><script>bad()</script></svg><math>hidden</math><template>hidden</template><form action="/api/workspace"><button data-workspace="close">Close</button><input type="submit" formaction="javascript:bad()"></form><a href="javascript:bad()" onclick="bad()" data-comment-action="delete" id="settings-close" class="pr-message">Link</a><img src="data:image/svg+xml,bad" onerror="bad()"><div style="position:fixed" data-workspace="close">Safe</div>';
    const result = source ? render('', hostile) : render(hostile);
    expect(result).not.toMatch(/script|iframe|<svg|<math|<template|<form|<button|onerror|onclick|javascript:|data:image|style=|data-workspace|data-comment-action|id=|pr-message/);
    expect(result).toContain('Safe'); expect(result).toContain('disabled');
    expect(result).toContain('rel="noopener noreferrer"');
  });
  it('preserves only the known formatting classes', () => {
    const result = render('', '<div class="highlight markdown-alert markdown-alert-note pr-description"><span class="pl-k pr-message">const</span></div>');
    expect(result).toContain('class="highlight markdown-alert markdown-alert-note"');
    expect(result).toContain('class="pl-k"'); expect(result).not.toContain('pr-description');
  });
  it('indexes displayed text and decoded entities without markup or link URLs', () => {
    expect(githubMarkdownText('', '<details><summary>Report</summary><p>target &amp; &#128077; &lt;literal&gt; <a href="https://target.test">target</a></p></details><!-- target -->')).toBe('Reporttarget & 👍 <literal> target');
    expect(githubMarkdownText('`<literal>` **target**')).toContain('<literal> target');
  });
});

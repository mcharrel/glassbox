import { decodeHTML } from 'entities';
import { raw, type SafeHtml } from 'kerfjs';
import { html } from 'kerfjs/html';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

function renderedBody(body: string, bodyHTML?: string): string {
  let source: string;
  try { source = bodyHTML ?? marked.parse(body, { async: false, gfm: true, breaks: true }); }
  catch { source = html`${body}`.toString(); }
  // Even GitHub-rendered HTML crosses the same allowlist; never admit app actions or executable markup.
  return sanitizeHtml(source, {
    allowedTags: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'strong', 'b', 'em', 'i',
      'del', 's', 'ins', 'sub', 'sup', 'kbd', 'samp', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'a', 'img', 'picture', 'source', 'details', 'summary', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'input'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      source: ['srcset', 'media', 'type'], details: ['open'], ol: ['start'],
      th: ['align', 'colspan', 'rowspan'], td: ['align', 'colspan', 'rowspan'],
      input: ['type', 'checked', 'disabled', 'class'],
    },
    allowedClasses: {
      div: ['highlight', /^highlight-source-[\w-]+$/, /^markdown-alert(?:-[\w-]+)?$/],
      span: [/^pl-[\w-]+$/], code: [/^language-[\w-]+$/],
      ul: ['contains-task-list'], li: ['task-list-item'], input: ['task-list-item-checkbox'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'http'], source: ['https', 'http'] },
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    transformTags: {
      '*': (tagName, attribs) => {
        // GitHub often returns root-relative links; never resolve them against rev's local server.
        for (const key of ['href', 'src']) if (attribs[key]) {
          try { attribs[key] = new URL(attribs[key], 'https://github.com/').href; }
          catch { Reflect.deleteProperty(attribs, key); }
        }
        if (tagName === 'a') Object.assign(attribs, { target: '_blank', rel: 'noopener noreferrer' });
        if (tagName === 'img') attribs.loading = 'lazy';
        if (tagName === 'input') { attribs.type = 'checkbox'; attribs.disabled = ''; }
        return { tagName, attribs };
      },
    },
  });
}

/** GitHub's rendering when available, with an offline GFM fallback for cached and unsent content. */
export function renderGitHubMarkdown(body: string, bodyHTML?: string): SafeHtml {
  // eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- renderedBody sanitizes every tag, attribute and URL before this boundary
  return raw(renderedBody(body, bodyHTML));
}

/** Search the displayed prose, not HTML tags, link destinations or hidden bot metadata. */
export function githubMarkdownText(body: string, bodyHTML?: string): string {
  return decodeHTML(sanitizeHtml(renderedBody(body, bodyHTML), { allowedTags: [], allowedAttributes: {} }));
}

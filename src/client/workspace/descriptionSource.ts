import { decodeHTML } from 'entities';
import { Lexer, type MarkedToken, type Token } from 'marked';

type Word = { text: string; start: number; end: number; positions?: number[] };
const words = (text: string): Word[] => [...text.matchAll(/[\p{L}\p{N}_]+|[^\s]/gu)]
  .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));

/** Remove invisible Markdown while retaining offsets into the untouched source. */
function sourceWords(source: string): Word[] {
  const visible = new Uint8Array(source.length).fill(1);
  const literal = new Uint8Array(source.length);
  const hide = (start: number, end: number) => { visible.fill(0, start, end); };
  const visit = (tokens: Token[], start: number, end: number) => {
    let cursor = start;
    for (const item of tokens) {
      // This lexer has no extensions, so every token is a built-in Markdown token.
      const token = item as MarkedToken;
      const found = source.indexOf(token.raw, cursor);
      const located = found >= cursor && found + token.raw.length <= end;
      const from = located ? found : cursor;
      const to = located ? found + token.raw.length : end;
      if (located) cursor = to;
      if (token.type === 'code' || token.type === 'codespan') {
        literal.fill(1, from, to);
        if (token.type === 'codespan') {
          const label = token.raw.indexOf(token.text);
          if (label >= 0) { hide(from, from + label); hide(from + label + token.text.length, to); }
        }
        if (token.type === 'code' && /^ {0,3}(`{3,}|~{3,})/.test(token.raw)) hide(from, from + token.raw.indexOf('\n') + 1);
        continue;
      }
      if (located && ['image', 'def', 'checkbox'].includes(token.type)) { hide(from, to); continue; }
      if (located && ['link', 'strong', 'em', 'del'].includes(token.type) && 'text' in token) {
        const label = token.raw.indexOf(token.text);
        if (label >= 0) { hide(from, from + label); hide(from + label + token.text.length, to); }
      }
      if (located && token.type === 'html') {
        for (const match of token.raw.matchAll(/<!--[\s\S]*?-->|<(script|style|iframe|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>/gi))
          {
            hide(from + match.index, from + match.index + match[0].length);
            if (/^<\/?(?:p|div|h[1-6]|li|th|td|blockquote|pre|br|hr|dt|dd)\b/i.test(match[0])) visible[from + match.index] = 2;
          }
      }
      if (token.type === 'list') visit(token.items, from, to);
      else if (token.type === 'table') visit([...token.header, ...token.rows.flat()].flatMap(cell => cell.tokens), from, to);
      else if ('tokens' in token && token.tokens) visit(token.tokens, from, to);
    }
  };
  visit(Lexer.lex(source, { gfm: true, extensions: null }), 0, source.length);
  let text = '';
  const offsets: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (!visible[i]) continue;
    if (visible[i] === 2) { text += ' '; offsets.push(i); ends.push(i + 1); continue; }
    const entity = !literal[i] && source[i] === '&' ? /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(source.slice(i))?.[0] : undefined;
    const value = entity === undefined ? source[i] : decodeHTML(entity);
    text += value;
    for (let j = 0; j < value.length; j++) { offsets.push(i); ends.push(i + (entity?.length ?? 1)); }
    if (entity !== undefined) i += entity.length - 1;
  }
  return words(text).map(word => ({ ...word, start: offsets[word.start], end: ends[word.end - 1], positions: [...offsets.slice(word.start, word.end), ends[word.end - 1]] }));
}

/** Myers alignment tracks only the clicked token, with bounded work for large/generated descriptions. */
function alignedWord(source: Word[], rendered: Word[], target: number): number | null {
  const frontier = new Map<number, { x: number; target: number | null }>([[1, { x: 0, target: null }]]);
  let work = 0;
  for (let distance = 0; distance <= 512; distance++) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (++work > 1_000_000) return null;
      const left = frontier.get(diagonal - 1);
      const right = frontier.get(diagonal + 1);
      const down = diagonal === -distance || (diagonal !== distance && (left?.x ?? -1) < (right?.x ?? -1));
      const previous = down ? right : left;
      let x = (previous?.x ?? 0) + (down ? 0 : 1);
      let y = x - diagonal;
      let mapped = previous?.target ?? null;
      if (down && y - 1 === target) mapped = x;
      while (x < source.length && y < rendered.length && source[x].text === rendered[y].text) {
        if (++work > 1_000_000) return null;
        if (y === target) mapped = x;
        x++; y++;
      }
      frontier.set(diagonal, { x, target: mapped });
      if (x >= source.length && y >= rendered.length) return mapped;
    }
  }
  return null;
}

export function descriptionSourceOffset(source: string, rendered: string, offset: number): number {
  if (!source || !rendered) return 0;
  const targetWords = words(rendered);
  const target = targetWords.findIndex(word => word.end >= offset);
  if (target < 0) return source.length;
  const sourceTokens = sourceWords(source);
  const clicked = targetWords[target];
  let index = alignedWord(sourceTokens, targetWords, target);
  if (index === null) {
    // Unusual GitHub-generated markup: prefer matching neighboring words over document position alone.
    let best = -Infinity;
    sourceTokens.forEach((word, candidate) => {
      if (word.text !== clicked.text) return;
      let score = -Math.abs(candidate / Math.max(1, sourceTokens.length) - target / targetWords.length);
      for (let delta = -6; delta <= 6; delta++) {
        const neighbor = target + delta >= 0 ? targetWords.at(target + delta) : undefined;
        if (neighbor && neighbor.text === sourceTokens[candidate + delta]?.text) score += 1 / (Math.abs(delta) + 1);
      }
      if (score > best) { best = score; index = candidate; }
    });
  }
  index ??= Math.round(target / Math.max(1, targetWords.length - 1) * (sourceTokens.length - 1));
  const word = sourceTokens.at(index);
  if (!word) return source.length;
  const within = Math.max(0, Math.min(clicked.text.length, offset - clicked.start));
  return word.positions?.[within] ?? word.start;
}

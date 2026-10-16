interface SourceLine { line: number; content: string }

/** Best-effort local lookup, scoped by braces; the server handles named functions/classes. */
export function localDeclaration(lines: SourceLine[], name: string, clickedLine: number): number | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const escaped = name.replace(/\$/g, '\\$');
  const keyword = new RegExp(`^(?:(?:export|public|private|protected|static|final|readonly)\\s+)*(?:const|let|var|val)\\s+${escaped}(?![\\w$])`);
  const typed = new RegExp(`^(?:(?:public|private|protected|static|final|volatile|transient)\\s+)*(?:[\\w$]+(?:\\.[\\w$]+)*(?:<[^;=]+>)?(?:\\[\\])*)\\s+${escaped}\\s*(?:[=;,]|$)`);
  const shortGo = new RegExp(`^${escaped}\\s*:=`);
  const parameter = new RegExp(`(?:\\(|,)\\s*(?:final\\s+)?(?:[\\w$]+(?:<[^;=]+>)?(?:\\[\\])*)\\s+${escaped}\\s*[,)]`);
  const scopes: Map<string, number>[] = [new Map<string, number>()];
  let blockComment = false;
  let quote = '';
  for (const source of [...lines].sort((a, b) => a.line - b.line)) {
    if (source.line > clickedLine) break;
    // Ignore strings/comments before inspecting declarations or scope delimiters.
    let code = '';
    for (let i = 0; i < source.content.length; i++) {
      const c = source.content[i], next = source.content[i + 1];
      if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '/' && next === '/') break;
      if (c === '/' && next === '*') { blockComment = true; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      code += c;
    }
    code = code.trim();
    if (keyword.test(code) || shortGo.test(code) || (!/^(return|throw|new|case)\b/.test(code) && typed.test(code))) {
      scopes[scopes.length - 1].set(name, source.line);
    }
    const parameterLine = parameter.test(code) && code.includes('{');
    for (const c of code) {
      if (c === '{') {
        const scope = new Map<string, number>();
        if (parameterLine) scope.set(name, source.line);
        scopes.push(scope);
      } else if (c === '}' && scopes.length > 1) scopes.pop();
    }
  }
  for (let i = scopes.length - 1; i >= 0; i--) {
    const line = scopes[i].get(name);
    if (line !== undefined) return line;
  }
  return null;
}

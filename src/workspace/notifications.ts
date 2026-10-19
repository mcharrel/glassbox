import { execFile } from 'node:child_process';

const clients = new Map<string, { visible: boolean; at: number; codeTab?: string | null; draftTab?: string | null }>();
export function reportVisibility(id: string, visible: boolean, now = Date.now(), codeTab?: string | null, draftTab?: string | null): void {
  clients.set(id, { visible, at: now, codeTab, draftTab });
  for (const [key, state] of clients) if (now - state.at > 30000) clients.delete(key);
}
export function hasVisibleClient(now = Date.now()): boolean {
  return [...clients.values()].some(state => state.visible && now - state.at < 30000);
}
export function hasCodeFocus(key: string, now = Date.now()): boolean {
  // Older clients cannot identify their code view; conservatively protect it.
  return [...clients.values()].some(state => now - state.at < 30000
    && (state.draftTab === key || (state.visible && (state.codeTab === undefined || state.codeTab === key))));
}
export function notify(title: string, body: string): void {
  if (process.platform !== 'darwin' || hasVisibleClient()) return;
  const script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
  execFile('osascript', ['-e', script, title, body], { timeout: 5000 }, () => {});
}

import type { SearchHit } from '../api/workspace.js';
import { getAnnotationsForReview, getReview, getReviewFiles } from '../db/queries.js';
import { getModeFileContent, parseModeString } from '../git/diff.js';
import { parseDiffData } from '../git/parseDiffData.js';
import { noteMarkdownText } from '../utils/noteMarkdown.js';
import { tabForReview } from './service.js';

export function occurrences(text: string, query: string): number[] {
  if (!query) return [];
  const result: number[] = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  for (
    let offset = lower.indexOf(needle);
    offset >= 0;
    offset = lower.indexOf(needle, offset + needle.length)
  )
    result.push(offset);
  return result;
}
export async function searchAllFiles(reviewId: string, query: string): Promise<SearchHit[]> {
  if (!query) return [];
  const review = await getReview(reviewId);
  if (!review) return [];
  const mode = parseModeString(review.mode);
  const files = await getReviewFiles(reviewId);
  const hits: SearchHit[] = [];
  for (const file of files) {
    const diff = parseDiffData(file.diff_data);
    if (diff?.isBinary === true) continue;
    const text = getModeFileContent(mode, file.file_path, 'new', review.repo_path);
    text.split('\n').forEach((line, index) => {
      occurrences(line, query).forEach((_, occurrence) => {
        hits.push({
          fileId: file.id,
          path: file.file_path,
          line: index + 1,
          side: 'new',
          occurrence,
        });
      });
    });
    for (const hunk of diff?.hunks ?? [])
      for (const line of hunk.lines)
        if (line.type === 'remove' && line.oldNum !== null) {
          occurrences(line.content, query).forEach((_, occurrence) => {
            hits.push({
              fileId: file.id,
              path: file.file_path,
              line: line.oldNum ?? 0,
              side: 'old',
              occurrence,
            });
          });
        }
  }
  const tab = tabForReview(reviewId);
  const annotations = await getAnnotationsForReview(reviewId);
  for (const annotation of annotations) {
    const file = files.find((f) => f.id === annotation.review_file_id);
    if (!file) continue;
    occurrences(annotation.content, query).forEach((_, occurrence) => {
      hits.push({
        fileId: file.id,
        path: file.file_path,
        line: annotation.line_number,
        side: annotation.side === 'old' ? 'old' : 'new',
        occurrence,
        annotationId: annotation.id,
      });
    });
  }
  for (const message of tab?.comments ?? []) {
    if (message.deleted || (message.annotationId !== undefined && message.kind !== 'ai')) continue;
    const file = files.find((f) => f.file_path === message.path);
    occurrences(noteMarkdownText(message.body), query).forEach((_, occurrence) => {
      hits.push({
        fileId: file?.id ?? null,
        path: message.path ?? '',
        line: message.line ?? 0,
        side: message.side ?? 'new',
        occurrence,
        commentId: message.id,
      });
    });
  }
  return hits;
}

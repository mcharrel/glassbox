import { listFiles } from '../../api/index.js';
import { reviewStore } from '../stores/index.js';

export async function loadFiles(): Promise<void> {
  const reviewId = reviewStore.state.value.reviewId;
  const data = await listFiles();
  if (reviewStore.state.value.reviewId !== reviewId) return;
  const selected = reviewStore.state.value.currentFileId;
  reviewStore.actions.update({
    ...(selected !== null && !data.files.some(file => file.id === selected) ? { currentFileId: data.files[0]?.id ?? null } : {}),
    files: data.files,
    annotationCounts: data.annotationCounts,
    staleCounts: data.staleCounts,
    groundTruth: data.groundTruth ?? {},
    pluginRendered: new Set(data.pluginRendered ?? []),
    notedFileIds: new Set(data.notedFileIds ?? []),
  });
}

import type { RetrievalInfo } from './PromptHandler';

export function parseRagInfo(
  requestInfo?: string | null,
): RetrievalInfo | null {
  if (!requestInfo) return null;
  try {
    const parsed = JSON.parse(requestInfo) as { rag?: unknown };
    const rag = parsed?.rag as Partial<RetrievalInfo> | undefined;
    if (!rag || typeof rag.ms !== 'number' || !Array.isArray(rag.results)) {
      return null;
    }
    const results = rag.results.filter(
      (entry): entry is string => typeof entry === 'string' && !!entry.trim(),
    );
    return { ms: Math.round(rag.ms), results };
  } catch {
    return null;
  }
}

export function formatRagDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

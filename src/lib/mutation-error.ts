const MAX_ERROR_DETAIL_LENGTH = 240;

/** Turns an unknown rejected value into concise, user-visible mutation copy. */
export function mutationErrorMessage(summary: string, error: unknown): string {
  const detail = errorDetail(error);
  if (!detail) return summary;
  return `${summary} ${detail.slice(0, MAX_ERROR_DETAIL_LENGTH)}`;
}

function errorDetail(error: unknown): string | null {
  const value = error instanceof Error
    ? error.message
    : (typeof error === 'string' ? error : null);
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

export const HISTORY_PAGE_SIZE = 200;

/** Appends a page while preserving order and rejecting overlapping row IDs. */
export function mergeUniquePage<Item extends { id: number }>(
  current: Item[],
  page: Item[],
): Item[] {
  const seen = new Set(current.map((item) => item.id));
  const unique = page.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return unique.length === 0 ? current : [...current, ...unique];
}

export function pageMayHaveMore(pageLength: number, pageSize = HISTORY_PAGE_SIZE): boolean {
  return pageLength >= pageSize;
}

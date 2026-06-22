export const DEFAULT_PAGE_SIZE = 30;

export type PaginationMeta = {
  total: number;
  limit: number;
  offset: number;
  loaded: number;
  hasMore: boolean;
};

export function parsePaginationParams(
  searchParams: URLSearchParams,
  defaultLimit = DEFAULT_PAGE_SIZE,
): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? defaultLimit), 1), 100);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);
  return { limit, offset };
}

export function buildPaginationMeta(
  total: number,
  limit: number,
  offset: number,
  pageCount: number,
): PaginationMeta {
  const loaded = offset + pageCount;
  return {
    total,
    limit,
    offset,
    loaded,
    hasMore: loaded < total,
  };
}

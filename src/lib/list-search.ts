export function matchesListSearch(
  query: string,
  values: Array<string | number | null | undefined>,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

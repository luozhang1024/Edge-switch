export function ordered<T extends { id: string }>(
  items: T[],
  ids: string[] = [],
): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return items
    .slice()
    .sort(
      (a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length),
    );
}

export function moveItem(
  ids: string[],
  source: string,
  target: string,
): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target))
    return ids;
  const next = ids.filter((id) => id !== source);
  next.splice(ids.indexOf(target), 0, source);
  return next;
}

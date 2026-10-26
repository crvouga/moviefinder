import { useState } from "react";

// UI slot identities only: records always come from the current canonical view.
// New batches append; an explicit refresh applies the provider's latest ranking.
export function useStableOrder<T extends { id: string }>(key: string, rows: readonly T[]) {
  const [view, setView] = useState<{ key: string; ids: string[] }>({ key, ids: [] });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ids = view.key === key ? view.ids.filter((id) => byId.has(id)) : [];
  const placed = new Set(ids);
  for (const row of rows) {
    if (placed.has(row.id)) continue;
    placed.add(row.id);
    ids.push(row.id);
  }
  if (
    view.key !== key ||
    ids.length !== view.ids.length ||
    ids.some((id, index) => id !== view.ids[index])
  )
    setView({ key, ids });
  return {
    rows: ids.map((id) => byId.get(id)!),
    isCurrent: ids.every((id, index) => rows[index]?.id === id),
    refresh: () => setView({ key: "", ids: [] }),
  };
}

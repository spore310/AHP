import type { ResourceRef } from "@authorization";
import { RepositoryError } from "../../types";
import { memoryResourceKey } from "./helpers";
import type { StoredWork, WorkKeyPage, WorkPageKey } from "./workTypes";

export function pageLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) throw new RepositoryError("conflict", "Invalid work page size.");
}
const compare = (a: WorkPageKey, b: WorkPageKey) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
function following(rows: readonly WorkPageKey[], key: WorkPageKey) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const item = rows[mid];
    if (item && compare(item, key) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Per-session ordered keys survive ordinary status/data changes because creation time and ID are immutable. */
export function memoryWorkPages(jobs: ReadonlyMap<string, StoredWork>) {
  const sessions = new Map<string, WorkPageKey[]>();
  function entriesFor(row: StoredWork) {
    const key = memoryResourceKey(row.session);
    const entries = sessions.get(key) ?? [];
    sessions.set(key, entries);
    return entries;
  }
  for (const row of jobs.values()) entriesFor(row).push({ createdAt: row.createdAt, id: row.id });
  for (const entries of sessions.values()) entries.sort(compare);
  return {
    add(row: StoredWork) {
      const entries = entriesFor(row);
      entries.splice(following(entries, row), 0, { createdAt: row.createdAt, id: row.id });
    },
    remove(row: StoredWork) {
      const key = memoryResourceKey(row.session);
      const entries = sessions.get(key);
      if (!entries) return;
      const i = following(entries, row) - 1;
      if (entries[i]?.id === row.id) entries.splice(i, 1);
      if (!entries.length) sessions.delete(key);
    },
    page(session: ResourceRef<"session">, limit: number, after?: WorkPageKey, upper?: WorkPageKey): WorkKeyPage {
      pageLimit(limit);
      const entries = sessions.get(memoryResourceKey(session)) ?? [];
      const end = upper ?? entries.at(-1);
      if (!end) return { rows: [] };
      const start = after ? following(entries, after) : 0;
      return structuredClone({ rows: entries.slice(start, Math.min(start + limit, following(entries, end))), upper: end });
    } };
}

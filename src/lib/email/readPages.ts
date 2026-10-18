import { withTimeout } from '@/lib/fetchWithRetry';

export interface ReadPage<T> { data: T[] | null; error: unknown; count: number | null }

export async function readPage<T>(request: PromiseLike<ReadPage<T>>, offset: number) {
  const { data, error, count } = await withTimeout(request);
  if (error) throw error;
  if (!data || count === null || !Number.isSafeInteger(count) || count < 0 || (data.length === 0 && offset < count)) {
    throw new Error('Lecture incomplète : étendue des données inconnue');
  }
  return { rows: data, total: count, nextOffset: offset + data.length < count ? offset + data.length : null };
}

/** Metadata and attachment IDs only; full message bodies use an explicit UI page. */
export async function readAllPages<T>(query: (from: number, to: number) => PromiseLike<ReadPage<T>>) {
  const rows: T[] = [];
  for (let offset = 0; ;) {
    const page = await readPage(query(offset, offset + 499), offset);
    rows.push(...page.rows);
    if (page.nextOffset === null) return rows;
    offset = page.nextOffset;
  }
}

/** Literal substring, not a user-controlled expression. imatch avoids LIKE's * alias.
 * PostgREST requires quoted reserved values; JSON quoting escapes its quotes/backslashes.
 * https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators
 */
export function literalEmailSearch(columns: readonly string[], query: string) {
  const literal = query.trim().replace(/[\\.^$|?*+()[\]{}]/g, '\\$&');
  return columns.map(column => `${column}.imatch.${JSON.stringify(literal)}`).join(',');
}

export function uniqueRows<T extends { id: string }>(rows: T[]) {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

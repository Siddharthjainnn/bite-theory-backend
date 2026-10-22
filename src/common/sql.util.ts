/**
 * TypeORM's postgres driver returns UPDATE / DELETE ... RETURNING results as
 * `[rows, affectedCount]`, not as rows (SELECT and INSERT return plain rows).
 * Code that did `res.length` / `res[0].col` on an UPDATE ... RETURNING always
 * saw length 2 and an undefined column. returned() gives back the rows for
 * every statement kind, so callers never need to remember which is which.
 */
export function returned<T = any>(res: unknown): T[] {
  if (
    Array.isArray(res) &&
    res.length === 2 &&
    Array.isArray(res[0]) &&
    typeof res[1] === 'number'
  ) {
    return res[0] as T[];
  }
  return (Array.isArray(res) ? res : []) as T[];
}

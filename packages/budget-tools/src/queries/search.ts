import { query, guardSelect } from "../db.js";

export async function runSql(a: { query: string; limit?: number }): Promise<{ sql: string; row_count: number; rows: any[] }> {
  const sql = guardSelect(a.query, a.limit ?? 200); // throws on invalid input
  try {
    const rows = await query(sql);
    return { sql, row_count: rows.length, rows };
  } catch (e: any) {
    throw new Error(`Query failed: ${e.message}`);
  }
}

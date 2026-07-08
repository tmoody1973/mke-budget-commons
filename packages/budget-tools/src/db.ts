import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.MCP_DATABASE_URL;
if (!url) {
  console.error(
    "MCP_DATABASE_URL not set. Run `make load-neon` to build the DB and write it to .env.",
  );
  process.exit(1);
}

// Read-only pool. The mcp_ro role is SELECT-only at the database level; the
// guards below are defense in depth for the run_sql escape hatch.
export const pool = new pg.Pool({ connectionString: url, max: 4 });

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 5000");
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

const DENY = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge|pg_read_file|pg_ls_dir)\b/i;
const CATALOG = /\b(pg_catalog|pg_authid|pg_shadow|information_schema|pg_roles|pg_user)\b/i;

/** Validate + shape a user query for the run_sql escape hatch. */
export function guardSelect(raw: string, limit = 200): string {
  let sql = raw.trim().replace(/;+\s*$/, "");
  if (sql.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Only SELECT / WITH queries are allowed.");
  if (DENY.test(sql)) throw new Error("Query contains a disallowed keyword (read-only).");
  if (CATALOG.test(sql)) throw new Error("System catalogs are not accessible.");
  if (!/\blimit\s+\d+/i.test(sql)) sql = `${sql} LIMIT ${limit}`;
  return sql;
}

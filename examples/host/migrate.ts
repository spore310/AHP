/**
 * Creates one PostgreSQL schema per namespace and applies every forward
 * migration inside it. A namespace's schema is its logical store.
 *
 * Usage: AHP_DATABASE_URL=... vite-node examples/host/migrate.ts <namespaceId>...
 */
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { namespaceSchemaName } from "@host";

const url = process.env.AHP_DATABASE_URL;
if (url === undefined) throw new Error("AHP_DATABASE_URL is required.");
const directory = new URL("../../database/migrations/", import.meta.url);
const scripts = readdirSync(directory).filter((name) => /^\d{4}_.*\.sql$/u.test(name)).sort().map((name) => ({ version: name.replace(/\.sql$/u, ""), sql: readFileSync(new URL(name, directory), "utf8") }));
for (const namespaceId of process.argv.slice(2)) {
  // The schema name is derived from a validated identifier and contains only [a-z0-9_].
  const schema = namespaceSchemaName(namespaceId);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path = ${schema}`);
    const known = await client.query<{ present: boolean }>("SELECT to_regclass('schema_migrations') IS NOT NULL AS present");
    const applied = new Set(known.rows[0]?.present ? (await client.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((row) => row.version) : []);
    for (const script of scripts) if (!applied.has(script.version)) await client.query(script.sql);
    const versions = (await client.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => row.version);
    process.stdout.write(`${namespaceId} -> schema ${schema}: ${versions.join(", ")}\n`);
  } finally {
    await client.end();
  }
}

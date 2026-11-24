import { runPostgresPersistenceConformance } from "../src/tests/persistence/adapters/postgres/conformance";

const input = process.env.AHP_TEST_DATABASE_URL;
if (input === undefined) throw new Error("Set AHP_TEST_DATABASE_URL to a disposable, migrated local database.");

try {
  const target = new URL(input);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("The conformance example expects a local PostgreSQL URL.");
  }
} catch {
  throw new Error("AHP_TEST_DATABASE_URL must identify a disposable local PostgreSQL database.");
}

try {
  await runPostgresPersistenceConformance({ connectionString: input });
  process.stdout.write("PostgreSQL registration, durable session/resource, migration and ownership conformance passed.\n");
} catch {
  throw new Error("PostgreSQL conformance failed. Check the dedicated database, applied migrations, and server logs.");
}

#!/usr/bin/env node
/**
 * Idempotent schema bootstrap for Quorum.
 *
 * Fresh database: applies migrations/000_baseline.sql (the full current schema)
 * and records every existing migration as already-applied.
 * Existing database: skips the baseline and applies only migration files that
 * have not been recorded yet.
 *
 * Runs with production dependencies only (pg), so Docker and Replit do not need
 * drizzle-kit at runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const migrationsDir = path.join(root, "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required. Refusing to start without a database.");
  process.exit(1);
}

// pg reads sslmode from the connection string and verifies the server
// certificate normally; we never disable TLS verification here.
const client = new pg.Client({ connectionString });

const sqlFiles = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
  .sort();

async function main() {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const { rows } = await client.query("SELECT to_regclass('public.users') AS users");
  const fresh = !rows[0]?.users;

  if (fresh) {
    console.log("[migrate] fresh database — applying baseline schema");
    const baseline = fs.readFileSync(path.join(migrationsDir, "000_baseline.sql"), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(baseline);
      for (const name of sqlFiles) {
        await client.query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log(`[migrate] baseline applied (${sqlFiles.length} migrations recorded)`);
    return;
  }

  const applied = new Set((await client.query("SELECT name FROM _migrations")).rows.map((row) => row.name));
  const pending = sqlFiles.filter((name) => name !== "000_baseline.sql" && !applied.has(name));
  if (pending.length === 0) {
    console.log("[migrate] schema up to date");
    return;
  }

  for (const name of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    console.log(`[migrate] applying ${name}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(`[migrate] applied ${pending.length} migration(s)`);
}

main()
  .catch((error) => {
    console.error("[migrate] failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));

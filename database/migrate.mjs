#!/usr/bin/env node
/**
 * BUZZNA D74 - Sequential SQL migration runner
 * Runs every .sql file in database/migrations in filename order,
 * tracking applied files in public.buzzna_schema_migrations.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from './../apps/api/node_modules/pg/lib/index.js';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  await client.query('SET search_path TO buzzna, public;');
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.buzzna_schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await client.query('SELECT filename FROM public.buzzna_schema_migrations')).rows.map(
      (r) => r.filename
    )
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`apply  ${file} ... `);
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO public.buzzna_schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [file]
      );
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`\nMigration ${file} failed:\n${err.message}\n`);
      await client.end();
      process.exit(1);
    }
  }

  console.log('\nAll migrations applied.');
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await client.end(); } catch {}
  process.exit(1);
});

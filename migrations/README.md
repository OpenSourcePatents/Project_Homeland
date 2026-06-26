# Migrations

This directory is the **canonical source of truth** for the database schema.

## How it works

- Each migration is a plain `.sql` file.
- Migrations are **ordered** and applied in lexicographic filename order. Prefix
  each file with a zero-padded sequence number, e.g.:
  - `0001_init.sql`
  - `0002_add_widgets.sql`
- The full schema is reproducible by applying every migration, in order, to an
  empty database.

## Rules

- Once a migration has been applied to any shared environment, treat it as
  **immutable** — never edit it. Make further changes by adding a new migration.
- Keep each migration focused and forward-only for now (no separate down files).

## Applying migrations

For now, migrations are applied **manually** — e.g. paste the SQL into the Neon
SQL Editor, or run it with `psql "$DATABASE_URL" -f migrations/0001_init.sql`.
A migration runner may be added later.

> No migrations exist yet — schema work comes in a later step.

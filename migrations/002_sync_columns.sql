-- =============================================================================
-- Project Homeland — 002_sync_columns.sql
-- Additive schema changes for the daily FBI sync job.
-- Apply once, manually, after review. DO NOT auto-apply.
-- =============================================================================
--
-- PURPOSE
--   001 is applied and live; suspect_profiles holds 20 real rows, all
--   data_class = 'official'. The forthcoming daily sync job needs to:
--       (a) STAMP every record it sees in a successful, COMPLETE pull, and
--       (b) MARK records that have VANISHED from the FBI list.
--   This migration adds the column, status vocabulary, backfill, and index that
--   support that. Everything here is additive and safe against the populated
--   table.
--
-- SAFETY
--   * Purely additive: one nullable column, a one-time backfill UPDATE, a
--     WIDENED (superset) status CHECK, and one index. No column is dropped and
--     no existing data is rewritten beyond the backfill.
--   * The new status set is a strict SUPERSET of the old, so re-validating the
--     existing 20 rows (all status = 'na') when the CHECK is re-added cannot
--     fail.
--   * Runs in a single transaction: all-or-nothing (BEGIN/COMMIT).
--
-- HOW THE status CHECK IS HANDLED  (the constraint name matters — read this)
--   001 declared status with an INLINE column constraint:
--       status TEXT DEFAULT 'na'
--           CHECK (status IN ('na','captured','deceased','recovered'))
--   PostgreSQL auto-names a single inline column CHECK deterministically as
--   "<table>_<column>_check", i.e. suspect_profiles_status_check. There is only
--   ONE CHECK on the status column, so no numeric suffix (_check1, _check2, ...)
--   is appended — the name is guaranteed for this schema.
--   We therefore:
--     1. DROP CONSTRAINT IF EXISTS suspect_profiles_status_check
--        — IF EXISTS so a re-run / already-dropped state is a harmless no-op
--          rather than an error.
--     2. ADD CONSTRAINT suspect_profiles_status_check with the widened list and
--        an EXPLICIT name, so every future migration has a stable, predictable
--        handle instead of relying on auto-naming again.
--   TO CONFIRM the live constraint name BEFORE applying (recommended), run:
--       SELECT conname, pg_get_constraintdef(oid)
--       FROM   pg_constraint
--       WHERE  conrelid = 'suspect_profiles'::regclass
--         AND  contype  = 'c'
--         AND  pg_get_constraintdef(oid) ILIKE '%status%';
--   Expected conname: suspect_profiles_status_check. If a deployment somehow
--   reports a different name, substitute it in the DROP below before applying —
--   otherwise the old (narrow) CHECK would survive and keep rejecting the new
--   values while a second CHECK is added alongside it.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. last_seen_at — per-record "last appeared in a sync" timestamp
--    Nullable. The sync job stamps now() on every record it sees in a
--    successful pull; vanished-detection reads it to find records that have
--    dropped off the list.
-- -----------------------------------------------------------------------------
ALTER TABLE suspect_profiles
    ADD COLUMN last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN suspect_profiles.last_seen_at IS
    'Last FBI sync run in which this record appeared in the API list. Used by vanished-detection: records not seen in a COMPLETE pull are candidates for removal-marking.';

-- Backfill the existing 20 rows: they were all seen during the original import,
-- so last_verified_at (set to now() by the importer at ingest) is an honest
-- "last seen" value. WHERE last_seen_at IS NULL keeps this UPDATE idempotent.
UPDATE suspect_profiles
    SET last_seen_at = last_verified_at
    WHERE last_seen_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Widen the status CHECK  (superset — see header note on the constraint name)
--    Old allowed: ('na','captured','deceased','recovered')
--    Added:
--      'surrendered', 'resolved'  — real FBI status values seen during the test
--                                   import and previously flattened to 'na'.
--      'removed_from_fbi'         — vanished-detection state: the record dropped
--                                   off the FBI list with no explicit
--                                   captured/resolved signal.
--    Final allowed:
--      ('na','captured','deceased','recovered',
--       'surrendered','resolved','removed_from_fbi')
-- -----------------------------------------------------------------------------
ALTER TABLE suspect_profiles
    DROP CONSTRAINT IF EXISTS suspect_profiles_status_check;

ALTER TABLE suspect_profiles
    ADD CONSTRAINT suspect_profiles_status_check
    CHECK (status IN (
        'na',
        'captured',
        'deceased',
        'recovered',
        'surrendered',
        'resolved',
        'removed_from_fbi'
    ));

-- -----------------------------------------------------------------------------
-- 3. Index for the vanished-detection query (which filters on last_seen_at)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_suspect_profiles_last_seen_at
    ON suspect_profiles (last_seen_at);

COMMIT;

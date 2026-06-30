-- =============================================================================
-- Project Homeland — 003_resolved_state.sql
-- Additive schema changes for the location-recovery workflow.
-- Apply once, manually, after review. DO NOT auto-apply.
-- =============================================================================
--
-- PURPOSE
--   001 and 002 are applied and live; suspect_profiles holds ~1196 real rows,
--   all data_class = 'official'. Many records have a NULL primary_state because
--   the field-office lookup could not resolve one. The location-recovery
--   workflow (next) derives a BEST-AVAILABLE state from richer signals and
--   records both the value and HOW it was derived. This migration adds the two
--   columns and the index that workflow needs.
--
-- DESIGN — resolved_state is ENRICHMENT, not a rewrite
--   primary_state stays exactly what the FBI importer set (field-office-derived,
--   often NULL) and is never touched here. resolved_state is a SEPARATE,
--   best-available value with its own provenance column (state_source), so the
--   sourced field and the derived field never get conflated. The public map
--   filters on resolved_state; audits can always see how it was reached.
--
-- SAFETY
--   * Purely additive: two nullable columns (one with a fail-safe 'none' default
--     and a CHECK) and one index. No existing column or row is modified.
--   * state_source defaults to 'none', so existing rows are valid against the new
--     CHECK immediately — no backfill, no possible constraint violation.
--   * Runs in a single transaction: all-or-nothing (BEGIN/COMMIT).
--   * IDEMPOTENT / re-runnable: every statement uses IF NOT EXISTS. An earlier
--     attempt partially applied (it added resolved_state, then died on the old
--     COMMENT ON statements without honoring the transaction), so re-running this
--     version is a no-op for resolved_state and adds the rest (state_source + its
--     CHECK, and the index). Safe to run as many times as needed.
--
-- NOTE
--   No COMMENT ON statements are used: the migration runner splits on ';' and
--   would break on punctuation inside a COMMENT string literal. Column docs live
--   in the -- line comments above each column instead (the runner strips those).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. resolved_state — best-available US state, derived by location-recovery.
--    Nullable. Derived in priority order:
--        possible_states  >  description text  >  field_office lookup
--    NULL when none determinable. Does NOT overwrite primary_state (which stays
--    field-office-derived). This is the enriched value; its provenance lives in
--    state_source below.
-- -----------------------------------------------------------------------------
ALTER TABLE suspect_profiles
    ADD COLUMN IF NOT EXISTS resolved_state CHAR(2);

-- -----------------------------------------------------------------------------
-- 2. state_source — provenance: HOW resolved_state was derived (audit trail).
--    Nullable, fail-safe default 'none' so every existing row is valid against
--    the CHECK the instant the column is added.
--      possible_states  — from the record's possible-states signal
--      description      — parsed from free-text description
--      field_office     — fell back to the field-office lookup
--      none             — not determinable / not yet run
-- -----------------------------------------------------------------------------
ALTER TABLE suspect_profiles
    ADD COLUMN IF NOT EXISTS state_source TEXT DEFAULT 'none'
        CHECK (state_source IN ('possible_states', 'description', 'field_office', 'none'));

-- -----------------------------------------------------------------------------
-- 3. Index for the map filter on resolved_state.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_suspect_profiles_resolved_state
    ON suspect_profiles (resolved_state);

COMMIT;

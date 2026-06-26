-- =============================================================================
-- Project Homeland — 001_initial_schema.sql
-- Complete final-product schema (superset). Apply once, manually, after review.
-- =============================================================================
--
-- PURPOSE
--   This is the FULL final-product schema. The first shipped surface
--   ("Product B") uses only part of it; the remainder is provisioned now on
--   purpose, to avoid a later structural migration. Do not simplify it down to
--   only what the first feature needs.
--
-- THE OFFICIAL / ANALYTICAL WALL  (load-bearing for credibility)
--   Every fact-bearing row carries a `data_class`:
--       'official'    — sourced from authoritative records (FBI Wanted API,
--                       court records, etc.). Eligible for the public surface.
--       'analytical'  — our own OSINT synthesis / inference. NOT authoritative.
--   The public / read-facing surface MUST filter `WHERE data_class = 'official'`.
--   Leaking 'analytical' rows into public views breaks the credibility promise.
--
--   FAIL-SAFE DEFAULT: data_class DEFAULTs to 'analytical' on both fact tables
--   (suspect_profiles, incident_logs). A forgotten flag therefore HIDES a row
--   from the public surface rather than exposing an unvetted one — the wall
--   fails closed, not open. Ingestion paths that write authoritative records
--   MUST set data_class = 'official' EXPLICITLY; the FBI importer (next
--   migration) does exactly this.
--
-- PROVENANCE SPINE
--   suspect_profiles carries source_type / source_url / last_verified_at /
--   confidence / raw_payload (the verbatim API response — source is never lost).
--   incident_logs carries source_type / source_url / last_verified_at and cites
--   its source via source_url. So no claim is uncitable.
--
-- JUNCTION TABLES = PRODUCT-A CONVERGENCE LAYER
--   suspect_network_mapping and incident_network_mapping model the convergence
--   of suspects / incidents onto threat_networks. They are the Product-A
--   feature and are EMPTY in Product B. role_type is intentionally left without
--   a CHECK constraint — the affiliation vocabulary is still being discovered.
--
-- CONVENTIONS
--   * All timestamp columns are timestamptz, default now().
--   * UUID primary keys via uuid-ossp's uuid_generate_v4().
--   * Rigid / structural vocabularies  -> Postgres ENUM types.
--   * Extensible vocabularies          -> text + CHECK constraints.
--   * The whole migration runs in one transaction: all-or-nothing.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS postgis;       -- geography(Point, 4326)

-- -----------------------------------------------------------------------------
-- Controlled vocabularies — rigid / structural (ENUM)
-- -----------------------------------------------------------------------------
CREATE TYPE data_class_enum       AS ENUM ('official', 'analytical');
CREATE TYPE incident_outcome_enum AS ENUM ('executed', 'prevented');

-- Extensible vocabularies (source_type, prevention_vector, suspect status) are
-- modeled as text + CHECK inline on the tables below, so the allowed set can be
-- widened with a cheap constraint swap rather than an ENUM ALTER.

-- -----------------------------------------------------------------------------
-- 1. threat_networks
--    Named threat networks that suspects / incidents converge onto (Product A).
-- -----------------------------------------------------------------------------
CREATE TABLE threat_networks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL UNIQUE,
    color_code  VARCHAR(7) DEFAULT '#64748B',          -- #RRGGBB for the UI
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. suspect_profiles
--    Aligned to the real FBI Wanted API shape (api.fbi.gov/wanted/v1/list).
--    The API is messy: names are often absent, DOBs come as arrays, location is
--    unreliable. Columns below reflect that reality rather than an idealized
--    "person" record. Manual OSINT records share the table (no fbi_uid).
-- -----------------------------------------------------------------------------
CREATE TABLE suspect_profiles (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- FBI Wanted API alignment ------------------------------------------------
    fbi_uid               VARCHAR(255) UNIQUE,   -- nullable: manual OSINT has none
    first_name            VARCHAR(155),
    last_name             VARCHAR(155),
    title                 TEXT,                  -- API display title; may be "seeking info"
    aliases               TEXT[],
    dates_of_birth_used   TEXT[],                -- API returns an array of DOB strings
    physical_description  JSONB,                 -- height/weight/eyes/hair/scars consolidated
    subjects              TEXT[],                -- API category tags
    field_offices         TEXT[],
    reward_text           TEXT,
    warning_message       TEXT,                  -- e.g. 'ARMED AND DANGEROUS'
    status                TEXT DEFAULT 'na'
                              CHECK (status IN ('na','captured','deceased','recovered')),
    person_classification VARCHAR(50),           -- API field, e.g. 'Main'
    poster_classification VARCHAR(50),           -- API: 'ten','default','information','missing'
    primary_state         CHAR(2),               -- best-effort; often null
    image_url             TEXT,
    source_link           TEXT,                  -- FBI public URL for this record

    -- Provenance spine --------------------------------------------------------
    source_type           TEXT NOT NULL DEFAULT 'fbi_api'
                              CHECK (source_type IN ('fbi_api','manual_osint','court_record','news')),
    data_class            data_class_enum NOT NULL DEFAULT 'analytical',
    source_url            TEXT,
    last_verified_at      TIMESTAMPTZ,           -- set when verified; null = unverified
    confidence            SMALLINT CHECK (confidence BETWEEN 0 AND 100),  -- nullable
    raw_payload           JSONB,                 -- verbatim API response; never lose source

    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. incident_logs
--    Real-world events: executed attacks and prevented plots. Outcome stays
--    null until known; prevention_vector explains *how* a plot was stopped.
-- -----------------------------------------------------------------------------
CREATE TABLE incident_logs (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title             VARCHAR(255) NOT NULL,
    event_date        DATE,
    state             CHAR(2),
    city              VARCHAR(100),
    location          geography(Point, 4326),         -- PostGIS; nullable
    outcome           incident_outcome_enum,          -- executed | prevented; null until known
    prevention_vector TEXT DEFAULT 'na'
                          CHECK (prevention_vector IN
                                 ('citizen_tip','traffic_stop','federal_intercept','self_failure','na')),
    tactical_lessons  TEXT,                            -- plain-English public takeaway

    -- Provenance spine --------------------------------------------------------
    data_class        data_class_enum NOT NULL DEFAULT 'analytical',
    source_type       TEXT NOT NULL DEFAULT 'manual_osint'
                          CHECK (source_type IN ('fbi_api','manual_osint','court_record','news')),
    source_url        TEXT,
    last_verified_at  TIMESTAMPTZ,

    created_at        TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. suspect_network_mapping  (junction — convergence spine, empty in Product B)
--    Every affiliation claim must be citable (source_url). role_type has no
--    CHECK yet: the vocabulary ('facilitator','logistics','financier',
--    'recruiter', ...) is still being discovered.
-- -----------------------------------------------------------------------------
CREATE TABLE suspect_network_mapping (
    suspect_id  UUID REFERENCES suspect_profiles(id) ON DELETE CASCADE,
    network_id  UUID REFERENCES threat_networks(id)  ON DELETE CASCADE,
    role_type   TEXT,
    role_notes  TEXT,
    source_url  TEXT,
    confidence  SMALLINT CHECK (confidence BETWEEN 0 AND 100),
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (suspect_id, network_id)
);

-- -----------------------------------------------------------------------------
-- 5. incident_network_mapping  (junction — convergence spine, empty in Product B)
-- -----------------------------------------------------------------------------
CREATE TABLE incident_network_mapping (
    incident_id UUID REFERENCES incident_logs(id)   ON DELETE CASCADE,
    network_id  UUID REFERENCES threat_networks(id) ON DELETE CASCADE,
    PRIMARY KEY (incident_id, network_id)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
-- suspect_profiles
CREATE INDEX idx_suspect_profiles_primary_state ON suspect_profiles (primary_state);
CREATE INDEX idx_suspect_profiles_status        ON suspect_profiles (status);
CREATE INDEX idx_suspect_profiles_data_class    ON suspect_profiles (data_class);
CREATE INDEX idx_suspect_profiles_subjects      ON suspect_profiles USING GIN (subjects);
CREATE INDEX idx_suspect_profiles_raw_payload   ON suspect_profiles USING GIN (raw_payload);

-- incident_logs
CREATE INDEX idx_incident_logs_state      ON incident_logs (state);
CREATE INDEX idx_incident_logs_outcome    ON incident_logs (outcome);
CREATE INDEX idx_incident_logs_data_class ON incident_logs (data_class);
CREATE INDEX idx_incident_logs_location   ON incident_logs USING GIST (location);

COMMIT;

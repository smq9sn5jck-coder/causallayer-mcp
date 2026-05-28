-- ────────────────────────────────────────────────────────────────────────────
-- Migration 0001 — leads
-- ────────────────────────────────────────────────────────────────────────────
-- First-party lead capture table for faultkey.com.
--
-- Backs the POST /v1/leads endpoint defined in src/leads.ts. Replaces the
-- Formspree fallback (xlgvnqek) for any environment where the LEADS_DB
-- binding is configured. The Formspree path remains as a graceful fallback
-- on the client side when /v1/leads is unreachable.
--
-- Apply with:
--   wrangler d1 execute LEADS_DB --file=migrations/0001_create_leads.sql --remote
--
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  -- Server-issued opaque id. Returned to the client on success so the visitor
  -- has a stable reference if they need to follow up. ULID-like (k-sortable +
  -- random), generated in the Worker — never sourced from client input.
  id              TEXT PRIMARY KEY,

  -- Submission timestamp (UTC milliseconds since epoch). Indexed for time-
  -- range queries from the admin dashboard.
  created_at_ms   INTEGER NOT NULL,

  -- Required: the visitor's email. Validated server-side (length 6..254,
  -- RFC-5322-lite regex). Stored case-preserved; lookups should LOWER() at
  -- query time. Not unique — the same person can submit twice with intent.
  email           TEXT    NOT NULL,

  -- Optional self-reported fields. All length-capped at 200 chars. Stored
  -- as raw user input (no HTML, no normalisation) — UI layer is responsible
  -- for escaping on render.
  company         TEXT,
  role            TEXT,
  sector          TEXT,
  use_case        TEXT,

  -- Marketing attribution. `source` is the high-level channel
  -- ("hero_email_capture", "sticky_cta", "footer", "homepage_keep_posted").
  -- `ref` is the free-form referrer (utm_source / utm_campaign / Referer).
  source          TEXT,
  ref             TEXT,

  -- Country code derived from the Cloudflare `CF-IPCountry` header at the
  -- moment of submission. Two-letter ISO-3166. Stored verbatim — "XX" or
  -- "T1" (Tor) are valid values.
  cf_country      TEXT,

  -- Privacy-preserving IP attribution. Stored as SHA-256(IP || daily_salt)
  -- truncated to 32 hex chars. Lets us deduplicate same-day submissions and
  -- enforce rate limits without storing the raw IP. The daily salt rotates
  -- at UTC midnight so the hash space is unlinkable across days.
  ip_hash         TEXT,

  -- User-agent string at submission time. Truncated to 500 chars. Useful
  -- only for spam triage; never used for fingerprinting.
  user_agent      TEXT,

  -- Cloudflare Turnstile verification result. Either NULL (Turnstile not
  -- configured in this env), "pass" (token verified by siteverify), or
  -- "fail" (token present but verification failed). When Turnstile is
  -- enforced (env.TURNSTILE_REQUIRED = "true") fail-rows are rejected
  -- before insert, so only "pass" + NULL ever land here.
  turnstile       TEXT,

  -- Loose payload field reserved for future additions. JSON-encoded; nullable.
  -- Keeps the schema stable while letting us add per-page metadata without
  -- another migration.
  extras_json     TEXT
);

-- Time-range index for the admin dashboard "leads today" / "leads this week"
-- queries. SQLite is happy with a single-column index on the timestamp.
CREATE INDEX IF NOT EXISTS leads_created_at_ms_idx
  ON leads(created_at_ms DESC);

-- Email-lookup index for de-duplication and individual-lead lookups.
-- Stored on LOWER(email) so case-insensitive lookups stay sargable.
CREATE INDEX IF NOT EXISTS leads_email_lower_idx
  ON leads(LOWER(email));

-- IP-hash + day index for rate-limit checks ("how many submissions has
-- this IP-hash made today?"). Composite key keeps the query single-pass.
CREATE INDEX IF NOT EXISTS leads_iphash_day_idx
  ON leads(ip_hash, created_at_ms);

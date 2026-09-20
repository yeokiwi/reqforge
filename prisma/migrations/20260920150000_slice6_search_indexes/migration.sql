-- Search indexes for the RQL compiler.
-- spec: 02-query-language.md §5 (ILIKE for ~), 07 §5 (performance budget), RD-024.

-- Trigram indexes make `~` (compiled to ILIKE) usable on the large text columns instead of
-- forcing a sequential scan. RD-024 chose one `bodySearch` column plus an index over a
-- second lower-cased generated column.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Requirement_bodySearch_trgm"
  ON "Requirement" USING gin (lower("bodySearch") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Requirement_title_trgm"
  ON "Requirement" USING gin (lower("title") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Requirement_upperKey_pattern"
  ON "Requirement" ("upperKey" text_pattern_ops);

-- `@Name = 'value'` is an equality over (searchName, value); `@Name ~ '%x%'` needs trigrams.
CREATE INDEX IF NOT EXISTS "Property_value_trgm"
  ON "Property" USING gin (lower("value") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Property_searchName_kind"
  ON "Property" ("searchName", "kind", "requirementId");

-- The visibility predicate joins memberships by space, and document links by version.
CREATE INDEX IF NOT EXISTS "Membership_space_user" ON "Membership" ("spaceId", "userId");
CREATE INDEX IF NOT EXISTS "Membership_space_group" ON "Membership" ("spaceId", "groupId");

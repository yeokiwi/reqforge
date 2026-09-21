-- Slice 11 — external properties.
-- spec: 01-domain-model.md (Property, ExternalPropertyDefinition); RD-037, RD-038.

-- A definition is edited from the instance admin screen; record when.
ALTER TABLE "ExternalPropertyDefinition"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Deletion is refused while values exist (spec 01), which is a lookup by definition.
CREATE INDEX "Property_definitionId_idx" ON "Property"("definitionId");

-- ---------------------------------------------------------------------------
-- Hand-written additions. Invariants the Prisma schema cannot express.
-- ---------------------------------------------------------------------------

-- Invariant E1: an EXTERNAL value always carries its definition, so its declared data
-- type is never unknown. This is what makes typed `ext@` comparison sound (RD-037).
-- INLINE values come out of the document and have no definition.
ALTER TABLE "Property"
  ADD CONSTRAINT "Property_external_has_definition"
  CHECK ("kind" <> 'EXTERNAL' OR "definitionId" IS NOT NULL);

-- Invariant E2: an external value is single-valued per requirement (RD-038). Setting a
-- value replaces it; the five aggregations of spec 04 §2.1 are defined on that basis.
-- INLINE properties stay list-valued (RD-027), so the index is partial.
CREATE UNIQUE INDEX "Property_external_single_value_key"
  ON "Property" ("requirementId", "definitionId")
  WHERE "kind" = 'EXTERNAL';

-- Invariant E3: a definition is looked up by its lowercased name, so two definitions may
-- not differ only in case — "Approval" and "approval" would be the same property.
CREATE UNIQUE INDEX "ExternalPropertyDefinition_name_lower_key"
  ON "ExternalPropertyDefinition" (lower("name"));

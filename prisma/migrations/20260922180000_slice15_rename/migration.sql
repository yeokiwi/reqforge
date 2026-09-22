-- Slice 15 — renaming.
-- spec: 03-authoring-and-indexing.md §5; RD-051 (the alias chain), RD-007 (baselined rows
-- are never renamed, which the existing reqforge_reject_baselined_update trigger enforces
-- at the database level — a rename needs no new protection, only the discipline of
-- filtering `baselineId IS NULL`).

-- Every key a live requirement has ever had. RD-051.
CREATE TABLE "RequirementKeyAlias" (
    "id"            TEXT NOT NULL,
    "spaceId"       TEXT NOT NULL,
    "key"           TEXT NOT NULL,
    "upperKey"      TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "renamedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId"       TEXT NOT NULL,
    "jobId"         TEXT,

    CONSTRAINT "RequirementKeyAlias_pkey" PRIMARY KEY ("id")
);

-- One owner per historical key. This is also the rename's collision check: a key an alias
-- still claims is not free, so a link written before the rename can never later resolve to
-- a *different* requirement that happened to take the freed key.
CREATE UNIQUE INDEX "RequirementKeyAlias_spaceId_upperKey_key"
    ON "RequirementKeyAlias" ("spaceId", "upperKey");

-- Reading a requirement's chain, and cascading a delete.
CREATE INDEX "RequirementKeyAlias_requirementId_idx"
    ON "RequirementKeyAlias" ("requirementId");

ALTER TABLE "RequirementKeyAlias"
    ADD CONSTRAINT "RequirementKeyAlias_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RequirementKeyAlias"
    ADD CONSTRAINT "RequirementKeyAlias_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- spec 03 §5 — the rename job ends with an explicit acknowledgement.
ALTER TABLE "Job" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);

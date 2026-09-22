-- Slice 14 — history.
-- spec: 05-baselines-and-diff.md §6 — a per-requirement change log, off by default per
-- space (research §2.7), "because it is the largest table in the system".

-- Retention, per space. NULL means keep for ever. `historyEnabled` already existed and
-- starts being read by this slice.
ALTER TABLE "Space" ADD COLUMN "historyRetentionDays" INTEGER;

-- Denormalised so pruning and the history screen do not join through "Requirement" for
-- every row — this is the table that grows fastest.
ALTER TABLE "RequirementHistory" ADD COLUMN "spaceId" TEXT;

UPDATE "RequirementHistory" h
   SET "spaceId" = r."spaceId"
  FROM "Requirement" r
 WHERE r.id = h."requirementId";

-- The per-field history view reads one requirement's rows of one kind, newest first.
CREATE INDEX "RequirementHistory_requirementId_changeKind_at_idx"
  ON "RequirementHistory" ("requirementId", "changeKind", "at");

-- Pruning and the space-wide history screen read by space and date (spec 05 §6, RD-049).
CREATE INDEX "RequirementHistory_spaceId_at_idx" ON "RequirementHistory" ("spaceId", "at");

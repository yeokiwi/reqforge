-- Slice 13 — baselines: draft and freeze.
-- spec: 05-baselines-and-diff.md §2 (lifecycle), §3.2 step 6 (pinning), §7 (the three
-- mechanisms that make a snapshot hold, "at the database level, not just application
-- code").

-- ---------------------------------------------------------------------------
-- A correction. `Requirement.baselineId` was ON DELETE SET NULL, so deleting a baseline
-- would try to null its frozen rows: that is an UPDATE, which the invariant-R2 trigger
-- rejects, so deletion failed outright — and without the trigger it would have turned
-- frozen rows into live ones, colliding with the live rows of the same keys and breaking
-- invariant R1. Spec 05 §2 allows delete from DRAFT and from FROZEN, so the rows go with
-- the baseline and nothing else does.
-- ---------------------------------------------------------------------------
ALTER TABLE "Requirement" DROP CONSTRAINT "Requirement_baselineId_fkey";
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_baselineId_fkey"
  FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every baseline read is scoped to one baseline, and freeze looks members up by key.
CREATE INDEX "Requirement_baselineId_upperKey_idx" ON "Requirement" ("baselineId", "upperKey");

-- ---------------------------------------------------------------------------
-- Spec 05 §7.2: a document version behind a frozen row is undeletable. Enforced here
-- rather than in the repository, for the same reason invariant R2 is: an auditor's
-- guarantee that only application code keeps is not a guarantee. This closes research
-- §5.3 leak 3 — RY cannot stop Confluence deleting the page version underneath it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reqforge_reject_pinned_version_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Document version % is pinned by a frozen baseline and cannot be deleted (spec 05 §3.2)',
    OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DocumentVersion_pinned_is_undeletable"
  BEFORE DELETE ON "DocumentVersion"
  FOR EACH ROW
  WHEN (OLD."pinned")
  EXECUTE FUNCTION reqforge_reject_pinned_version_delete();

-- ---------------------------------------------------------------------------
-- Invariant B2: "sequential per space, assigned at creation, immutable, never reused
-- (invariant B2), including after deletion" (spec 05 §4).
--
-- Deriving the next number from max(number) over the surviving rows cannot hold that:
-- delete the highest and the next baseline reuses its number, so two different snapshots
-- could both be cited as "baseline 5" in two different audits. The number comes from a
-- counter that only moves forward, and deletion does not touch it.
-- ---------------------------------------------------------------------------
ALTER TABLE "Space" ADD COLUMN "nextBaselineNumber" INTEGER NOT NULL DEFAULT 1;

-- Existing spaces carry on from where they are rather than restarting at 1.
UPDATE "Space" s
   SET "nextBaselineNumber" = COALESCE(
     (SELECT MAX(b."number") + 1 FROM "Baseline" b WHERE b."spaceId" = s.id),
     1
   );

-- Slice 16 — permissions, restrictions and classification.
-- spec: 07-permissions-and-limits.md §2.2 (rules X1–X4), §2.3 (classification), §6 (audit).
-- Decisions: RD-056 (view restrictions inherit down the tree), RD-059 (X4 as an
-- intersection of the frozen and the current gates), RD-060 (ordered classification levels).

-- ------------------------------------------------------------------ classification levels
CREATE TABLE "ClassificationLevel" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "rank"      INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassificationLevel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClassificationLevel_name_key" ON "ClassificationLevel"("name");
CREATE UNIQUE INDEX "ClassificationLevel_rank_key" ON "ClassificationLevel"("rank");

-- The free-text labels become levels, in first-seen order (RD-060). An instance admin is
-- expected to reorder them; until then the order is at least deterministic.
INSERT INTO "ClassificationLevel" ("id", "name", "rank")
SELECT 'cls_' || md5(label), label, (row_number() OVER (ORDER BY first_seen, label))::int * 10
  FROM (
    SELECT label, min(seen) AS first_seen
      FROM (
        SELECT "classification" AS label, "createdAt" AS seen FROM "Space"    WHERE "classification" IS NOT NULL AND btrim("classification") <> ''
        UNION ALL
        SELECT "classification" AS label, "createdAt" AS seen FROM "Document" WHERE "classification" IS NOT NULL AND btrim("classification") <> ''
      ) labels
     GROUP BY label
  ) ordered;

ALTER TABLE "Space"    ADD COLUMN "classificationId" TEXT;
ALTER TABLE "Document" ADD COLUMN "classificationId" TEXT;
ALTER TABLE "Baseline" ADD COLUMN "classificationId" TEXT;

UPDATE "Space"    s SET "classificationId" = l."id" FROM "ClassificationLevel" l WHERE l."name" = s."classification";
UPDATE "Document" d SET "classificationId" = l."id" FROM "ClassificationLevel" l WHERE l."name" = d."classification";

ALTER TABLE "Space"    DROP COLUMN "classification";
ALTER TABLE "Document" DROP COLUMN "classification";

ALTER TABLE "Space"    ADD CONSTRAINT "Space_classificationId_fkey"    FOREIGN KEY ("classificationId") REFERENCES "ClassificationLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "ClassificationLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "ClassificationLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------------------- view gates
-- RD-056: one row per restricted ancestor-or-self of every document.
CREATE TABLE "DocumentViewGate" (
    "documentId"     TEXT NOT NULL,
    "gateDocumentId" TEXT NOT NULL,
    CONSTRAINT "DocumentViewGate_pkey" PRIMARY KEY ("documentId", "gateDocumentId")
);
CREATE INDEX "DocumentViewGate_gateDocumentId_idx" ON "DocumentViewGate"("gateDocumentId");
ALTER TABLE "DocumentViewGate" ADD CONSTRAINT "DocumentViewGate_documentId_fkey"     FOREIGN KEY ("documentId")     REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentViewGate" ADD CONSTRAINT "DocumentViewGate_gateDocumentId_fkey" FOREIGN KEY ("gateDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every EXPLICIT document gates itself and all of its descendants. Before this
-- slice INHERIT meant "unrestricted", so this is the moment a child of a restricted page
-- stops being public.
INSERT INTO "DocumentViewGate" ("documentId", "gateDocumentId")
WITH RECURSIVE subtree AS (
    SELECT d."id" AS "documentId", d."id" AS "gateDocumentId"
      FROM "Document" d
     WHERE d."restrictionMode" = 'EXPLICIT'
    UNION
    SELECT c."id", s."gateDocumentId"
      FROM "Document" c
      JOIN subtree s ON c."parentId" = s."documentId"
)
SELECT "documentId", "gateDocumentId" FROM subtree
ON CONFLICT DO NOTHING;

CREATE INDEX "DocumentRestriction_documentId_canView_idx" ON "DocumentRestriction"("documentId", "canView");
CREATE INDEX "DocumentRestriction_documentId_canEdit_idx" ON "DocumentRestriction"("documentId", "canEdit");

-- --------------------------------------------------------------- frozen gates (rule X4)
CREATE TABLE "BaselineViewGate" (
    "baselineId"     TEXT NOT NULL,
    "documentId"     TEXT NOT NULL,
    "gateDocumentId" TEXT NOT NULL,
    CONSTRAINT "BaselineViewGate_pkey" PRIMARY KEY ("baselineId", "documentId", "gateDocumentId")
);
CREATE INDEX "BaselineViewGate_baselineId_documentId_idx" ON "BaselineViewGate"("baselineId", "documentId");
ALTER TABLE "BaselineViewGate" ADD CONSTRAINT "BaselineViewGate_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BaselineGateGrant" (
    "id"             TEXT NOT NULL,
    "baselineId"     TEXT NOT NULL,
    "gateDocumentId" TEXT NOT NULL,
    "userId"         TEXT,
    "groupId"        TEXT,
    CONSTRAINT "BaselineGateGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BaselineGateGrant_baselineId_gateDocumentId_idx" ON "BaselineGateGrant"("baselineId", "gateDocumentId");
ALTER TABLE "BaselineGateGrant" ADD CONSTRAINT "BaselineGateGrant_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Baselines frozen before this slice captured no restriction state. The closest honest
-- reconstruction is the state now, which is what they were being checked against anyway;
-- from here on X4 holds for them too.
INSERT INTO "BaselineViewGate" ("baselineId", "documentId", "gateDocumentId")
SELECT DISTINCT r."baselineId", v."documentId", g."gateDocumentId"
  FROM "Requirement" r
  JOIN "DocumentVersion" v ON v."id" = r."originVersionId"
  JOIN "DocumentViewGate" g ON g."documentId" = v."documentId"
 WHERE r."baselineId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "BaselineGateGrant" ("id", "baselineId", "gateDocumentId", "userId", "groupId")
SELECT 'bgg_' || md5(bg."baselineId" || dr."id"), bg."baselineId", bg."gateDocumentId", dr."userId", dr."groupId"
  FROM (SELECT DISTINCT "baselineId", "gateDocumentId" FROM "BaselineViewGate") bg
  JOIN "DocumentRestriction" dr ON dr."documentId" = bg."gateDocumentId" AND dr."canView";

-- CreateEnum
CREATE TYPE "SpacePermission" AS ENUM ('VIEW', 'EDIT', 'EXPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "RestrictionMode" AS ENUM ('INHERIT', 'EXPLICIT');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MOVED', 'DELETED');

-- CreateEnum
CREATE TYPE "PropertyKind" AS ENUM ('INLINE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DataType" AS ENUM ('STRING', 'TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM');

-- CreateEnum
CREATE TYPE "BaselineState" AS ENUM ('DRAFT', 'FROZEN');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('REQUIRED_PROPERTY', 'OPTIONAL_PROPERTY', 'REQUIRED_DEPENDENCY', 'PROPERTY_MATCHES', 'PROPERTY_IN');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('TRUE', 'FALSE', 'WARNING');

-- CreateEnum
CREATE TYPE "MatrixKind" AS ENUM ('TRACEABILITY', 'DEPENDENCY');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsed" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isolated" BOOLEAN NOT NULL DEFAULT false,
    "globalKeys" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT,
    "historyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "limits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "permissions" "SpacePermission"[],

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "classification" TEXT,
    "restrictionMode" "RestrictionMode" NOT NULL DEFAULT 'INHERIT',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRestriction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "authorId" TEXT NOT NULL,
    "message" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "upperKey" TEXT NOT NULL,
    "baselineId" TEXT,
    "status" "RequirementStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodySearch" TEXT NOT NULL,
    "anchorPath" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "originVersionId" TEXT,
    "typeId" TEXT,
    "newKey" TEXT,
    "newSpaceId" TEXT,
    "renamedFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "kind" "PropertyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "searchName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueOrdinal" INTEGER NOT NULL DEFAULT 0,
    "valueIndex" INTEGER NOT NULL DEFAULT 0,
    "definitionId" TEXT,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPropertyDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" "DataType" NOT NULL,
    "enumValues" TEXT[],
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalPropertyDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementLabel" (
    "requirementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "RequirementLabel_pkey" PRIMARY KEY ("requirementId","label")
);

-- CreateTable
CREATE TABLE "Dependency" (
    "relationship" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "targetBaselineId" TEXT,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("relationship","parentId","childId")
);

-- CreateTable
CREATE TABLE "UnresolvedDependency" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "targetSpaceKey" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetBaselineId" TEXT,

    CONSTRAINT "UnresolvedDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "origin" BOOLEAN NOT NULL DEFAULT false,
    "anchorPath" TEXT,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baseline" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "state" "BaselineState" NOT NULL DEFAULT 'DRAFT',
    "sourceQuery" TEXT NOT NULL,
    "includedDependencies" BOOLEAN NOT NULL DEFAULT false,
    "includedExternal" BOOLEAN NOT NULL DEFAULT false,
    "reportDocumentId" TEXT,
    "frozenAt" TIMESTAMP(3),
    "frozenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineRevision" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "countBefore" INTEGER NOT NULL,
    "countAfter" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "BaselineRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineDanglingDependency" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "childKey" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,

    CONSTRAINT "BaselineDanglingDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementType" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT,
    "keyPattern" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#4a5568',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "preventReusingDeletedKeys" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RequirementType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementTypeRule" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "name" TEXT,
    "relationship" TEXT,
    "direction" TEXT,
    "pattern" TEXT,
    "values" TEXT[],
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RequirementTypeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateColumn" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementValidation" (
    "requirementId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "messages" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementValidation_pkey" PRIMARY KEY ("requirementId","typeId")
);

-- CreateTable
CREATE TABLE "SavedMatrix" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MatrixKind" NOT NULL,
    "query" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'space',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "spaceId" TEXT,
    "payload" JSONB NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "resultRef" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementHistory" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "changeKind" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "RequirementHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "spaceId" TEXT,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_hash_key" ON "ApiToken"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "Space_key_key" ON "Space"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_spaceId_userId_groupId_key" ON "Membership"("spaceId", "userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "Document_spaceId_parentId_ordinal_idx" ON "Document"("spaceId", "parentId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRestriction_documentId_userId_groupId_key" ON "DocumentRestriction"("documentId", "userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_number_key" ON "DocumentVersion"("documentId", "number");

-- CreateIndex
CREATE INDEX "Requirement_spaceId_baselineId_status_idx" ON "Requirement"("spaceId", "baselineId", "status");

-- CreateIndex
CREATE INDEX "Requirement_baselineId_idx" ON "Requirement"("baselineId");

-- CreateIndex
CREATE INDEX "Requirement_originVersionId_idx" ON "Requirement"("originVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_spaceId_upperKey_baselineId_key" ON "Requirement"("spaceId", "upperKey", "baselineId");

-- CreateIndex
CREATE INDEX "Property_requirementId_kind_idx" ON "Property"("requirementId", "kind");

-- CreateIndex
CREATE INDEX "Property_searchName_value_idx" ON "Property"("searchName", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPropertyDefinition_name_key" ON "ExternalPropertyDefinition"("name");

-- CreateIndex
CREATE INDEX "RequirementLabel_label_idx" ON "RequirementLabel"("label");

-- CreateIndex
CREATE INDEX "Dependency_childId_idx" ON "Dependency"("childId");

-- CreateIndex
CREATE INDEX "Dependency_parentId_idx" ON "Dependency"("parentId");

-- CreateIndex
CREATE INDEX "UnresolvedDependency_childId_idx" ON "UnresolvedDependency"("childId");

-- CreateIndex
CREATE INDEX "UnresolvedDependency_targetSpaceKey_targetKey_idx" ON "UnresolvedDependency"("targetSpaceKey", "targetKey");

-- CreateIndex
CREATE INDEX "DocumentLink_requirementId_idx" ON "DocumentLink"("requirementId");

-- CreateIndex
CREATE INDEX "DocumentLink_versionId_idx" ON "DocumentLink"("versionId");

-- CreateIndex
CREATE INDEX "Baseline_spaceId_state_idx" ON "Baseline"("spaceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Baseline_spaceId_number_key" ON "Baseline"("spaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementType_spaceId_keyPattern_key" ON "RequirementType"("spaceId", "keyPattern");

-- CreateIndex
CREATE INDEX "RequirementValidation_typeId_status_idx" ON "RequirementValidation"("typeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SavedMatrix_spaceId_name_key" ON "SavedMatrix"("spaceId", "name");

-- CreateIndex
CREATE INDEX "Job_state_createdAt_idx" ON "Job"("state", "createdAt");

-- CreateIndex
CREATE INDEX "RequirementHistory_requirementId_at_idx" ON "RequirementHistory"("requirementId", "at");

-- CreateIndex
CREATE INDEX "RequirementHistory_actorId_at_idx" ON "RequirementHistory"("actorId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_spaceId_at_idx" ON "AuditEvent"("spaceId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_objectType_objectId_at_idx" ON "AuditEvent"("objectType", "objectId", "at");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRestriction" ADD CONSTRAINT "DocumentRestriction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_originVersionId_fkey" FOREIGN KEY ("originVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RequirementType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ExternalPropertyDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLabel" ADD CONSTRAINT "RequirementLabel_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedDependency" ADD CONSTRAINT "UnresolvedDependency_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineRevision" ADD CONSTRAINT "BaselineRevision_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineDanglingDependency" ADD CONSTRAINT "BaselineDanglingDependency_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementType" ADD CONSTRAINT "RequirementType_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTypeRule" ADD CONSTRAINT "RequirementTypeRule_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RequirementType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateColumn" ADD CONSTRAINT "TemplateColumn_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RequirementType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementValidation" ADD CONSTRAINT "RequirementValidation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementValidation" ADD CONSTRAINT "RequirementValidation_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RequirementType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMatrix" ADD CONSTRAINT "SavedMatrix_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementHistory" ADD CONSTRAINT "RequirementHistory_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions. Invariants the Prisma schema cannot express.
-- spec: 01-domain-model.md (R1, R2)
-- ---------------------------------------------------------------------------

-- Invariant R1, second half: live requirements (baselineId IS NULL) must collide on
-- (spaceId, upperKey). The @@unique above covers the non-NULL case only, because
-- PostgreSQL treats NULLs as distinct in a unique index.
CREATE UNIQUE INDEX "Requirement_live_space_upperKey_key"
  ON "Requirement" ("spaceId", "upperKey")
  WHERE "baselineId" IS NULL;

-- Invariant R2: rows belonging to a frozen baseline are immutable. Refreeze deletes and
-- re-inserts inside one transaction (spec 05 §4), so DELETE stays legal; UPDATE does not.
CREATE OR REPLACE FUNCTION reqforge_reject_baselined_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Requirement % belongs to baseline % and is immutable (invariant R2)',
    OLD."key", OLD."baselineId"
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Requirement_baselined_is_immutable"
  BEFORE UPDATE ON "Requirement"
  FOR EACH ROW
  WHEN (OLD."baselineId" IS NOT NULL)
  EXECUTE FUNCTION reqforge_reject_baselined_update();

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SpacePermission" AS ENUM ('VIEW', 'EDIT', 'EXPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "RestrictionMode" AS ENUM ('NONE', 'EDIT_RESTRICTED', 'VIEW_EDIT_RESTRICTED');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MOVED', 'DELETED');

-- CreateEnum
CREATE TYPE "RequirementLayout" AS ENUM ('TABLE_ROW', 'TABLE_COLUMN', 'PARAGRAPH', 'HEADING');

-- CreateEnum
CREATE TYPE "PropertyKind" AS ENUM ('INLINE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DataType" AS ENUM ('STRING', 'FLOAT', 'INTEGER', 'BOOLEAN', 'DROPDOWN');

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
    "isInstanceAdmin" BOOLEAN NOT NULL DEFAULT false,
    "sidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSpaceState" (
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "favourite" BOOLEAN NOT NULL DEFAULT false,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "UserSpaceState_pkey" PRIMARY KEY ("userId","spaceId")
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
    "useGlobalKeySettings" BOOLEAN NOT NULL DEFAULT true,
    "linksAcrossSpaces" BOOLEAN NOT NULL DEFAULT true,
    "preventReusingDeletedKeys" BOOLEAN NOT NULL DEFAULT false,
    "lockKeys" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "InstanceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "globalLimit" INTEGER NOT NULL DEFAULT 12000,
    "renameGroups" TEXT[],
    "baselineDeletionGroups" TEXT[],
    "exportForAllViewers" BOOLEAN NOT NULL DEFAULT true,
    "linksAcrossSpaces" BOOLEAN NOT NULL DEFAULT true,
    "preventReusingDeletedKeys" BOOLEAN NOT NULL DEFAULT false,
    "globalKeys" BOOLEAN NOT NULL DEFAULT false,
    "lockKeys" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "classification" TEXT,
    "restrictionMode" "RestrictionMode" NOT NULL DEFAULT 'NONE',
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
    "layout" "RequirementLayout" NOT NULL DEFAULT 'TABLE_ROW',
    "headingLevel" INTEGER,
    "sectionPath" TEXT[],
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
    "dropdownValues" TEXT[],
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
CREATE TABLE "KeySuggestion" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '001',
    "suffix" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "KeySuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementType" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "keySuggestionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#4a5568',

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
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "UserSpaceState_userId_lastViewedAt_idx" ON "UserSpaceState"("userId", "lastViewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_hash_key" ON "ApiToken"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "Space_key_key" ON "Space"("key");

-- CreateIndex
CREATE INDEX "Membership_spaceId_idx" ON "Membership"("spaceId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_groupId_idx" ON "Membership"("groupId");

-- CreateIndex
CREATE INDEX "QueryHistory_userId_spaceId_at_idx" ON "QueryHistory"("userId", "spaceId", "at");

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
CREATE UNIQUE INDEX "KeySuggestion_spaceId_prefix_suffix_key" ON "KeySuggestion"("spaceId", "prefix", "suffix");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementType_keySuggestionId_key" ON "RequirementType"("keySuggestionId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementType_spaceId_name_key" ON "RequirementType"("spaceId", "name");

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
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSpaceState" ADD CONSTRAINT "UserSpaceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSpaceState" ADD CONSTRAINT "UserSpaceState_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "KeySuggestion" ADD CONSTRAINT "KeySuggestion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementType" ADD CONSTRAINT "RequirementType_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementType" ADD CONSTRAINT "RequirementType_keySuggestionId_fkey" FOREIGN KEY ("keySuggestionId") REFERENCES "KeySuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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


-- ---------------------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express. Spec: docs/specs/01-domain-model.md.
-- Later slices add the rest (R2's immutability trigger arrives with baselines, Slice 13).
-- ---------------------------------------------------------------------------------------

-- Space.key: [A-Z][A-Z0-9]{1,15} (spec 01, Space).
ALTER TABLE "Space"
  ADD CONSTRAINT "Space_key_format" CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,15}$');

-- User.email is stored lower-cased; sign-in lower-cases its input (RD-050). Without the CHECK a
-- mixed-case row could shadow the account the unique index is meant to protect.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email"));

-- Membership: a row grants permissions to exactly one subject, and a subject has at most one
-- row per space. NULLs are distinct in a plain UNIQUE, hence the partial indexes.
ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_exactly_one_subject" CHECK (("userId" IS NULL) <> ("groupId" IS NULL));
CREATE UNIQUE INDEX "Membership_spaceId_userId_key"
  ON "Membership" ("spaceId", "userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "Membership_spaceId_groupId_key"
  ON "Membership" ("spaceId", "groupId") WHERE "groupId" IS NOT NULL;

-- Invariant R1: a live requirement (baselineId IS NULL) is unique per (space, upperKey).
-- The full unique index above covers baselined rows; NULLs would otherwise never collide.
CREATE UNIQUE INDEX "Requirement_live_spaceId_upperKey_key"
  ON "Requirement" ("spaceId", "upperKey") WHERE "baselineId" IS NULL;

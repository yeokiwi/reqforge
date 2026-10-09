-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_parentId_fkey";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "deletedRootId" TEXT;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "title" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "DocumentDraft" (
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "baseVersionNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentDraft_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateTable
CREATE TABLE "DocumentWatch" (
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentWatch_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateTable
CREATE TABLE "DocumentFavourite" (
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFavourite_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateTable
CREATE TABLE "DocumentPresence" (
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentPresence_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentWatch_userId_idx" ON "DocumentWatch"("userId");

-- CreateIndex
CREATE INDEX "DocumentFavourite_userId_idx" ON "DocumentFavourite"("userId");

-- CreateIndex
CREATE INDEX "DocumentPresence_documentId_lastSeenAt_idx" ON "DocumentPresence"("documentId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Attachment_documentId_deletedAt_idx" ON "Attachment"("documentId", "deletedAt");

-- CreateIndex
CREATE INDEX "Attachment_sha256_idx" ON "Attachment"("sha256");

-- CreateIndex
CREATE INDEX "Document_spaceId_deletedAt_idx" ON "Document"("spaceId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDraft" ADD CONSTRAINT "DocumentDraft_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDraft" ADD CONSTRAINT "DocumentDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWatch" ADD CONSTRAINT "DocumentWatch_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWatch" ADD CONSTRAINT "DocumentWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFavourite" ADD CONSTRAINT "DocumentFavourite_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFavourite" ADD CONSTRAINT "DocumentFavourite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPresence" ADD CONSTRAINT "DocumentPresence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPresence" ADD CONSTRAINT "DocumentPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express. Spec: docs/specs/01-domain-model.md
-- (Document, DocumentVersion), 09-decision-log.md RD-055 – RD-064.
--
-- Violations surface as check_violation (23514) with a message naming the rule; the
-- repository layer matches on that text to raise typed errors.
-- ---------------------------------------------------------------------------------------

-- ---- Document ----------------------------------------------------------------------

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_title_length" CHECK (char_length(btrim("title")) BETWEEN 1 AND 255),
  ADD CONSTRAINT "Document_ordinal_nonnegative" CHECK ("ordinal" >= 0),
  ADD CONSTRAINT "Document_deleted_consistent" CHECK (("deletedAt" IS NULL) = ("deletedRootId" IS NULL));

-- RD-056: a title is unique per space among live documents, case-insensitively.
CREATE UNIQUE INDEX "Document_live_spaceId_title_key"
  ON "Document" ("spaceId", lower("title")) WHERE "deletedAt" IS NULL;

-- A parent must be in the same space, and the tree must stay a tree.
CREATE FUNCTION "document_tree_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_space TEXT;
  cursor_id    TEXT;
  depth        INT := 0;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."parentId" = NEW."id" THEN
    RAISE EXCEPTION 'document_tree_guard: a document cannot be its own parent' USING ERRCODE = '23514';
  END IF;

  SELECT "spaceId" INTO parent_space FROM "Document" WHERE "id" = NEW."parentId";
  IF parent_space IS DISTINCT FROM NEW."spaceId" THEN
    RAISE EXCEPTION 'document_tree_guard: the parent must be in the same space' USING ERRCODE = '23514';
  END IF;

  cursor_id := NEW."parentId";
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW."id" THEN
      RAISE EXCEPTION 'document_tree_guard: a document cannot be moved under its own descendant' USING ERRCODE = '23514';
    END IF;
    depth := depth + 1;
    IF depth > 1000 THEN
      RAISE EXCEPTION 'document_tree_guard: the document tree is implausibly deep' USING ERRCODE = '23514';
    END IF;
    SELECT "parentId" INTO cursor_id FROM "Document" WHERE "id" = cursor_id;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER "Document_tree_guard"
  BEFORE INSERT OR UPDATE OF "parentId", "spaceId" ON "Document"
  FOR EACH ROW EXECUTE FUNCTION "document_tree_guard"();

-- The current version must be one of this document's own versions.
CREATE FUNCTION "document_current_version_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."currentVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DocumentVersion" WHERE "id" = NEW."currentVersionId" AND "documentId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'document_current_version_guard: the current version must belong to the document' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Document_current_version_guard"
  BEFORE INSERT OR UPDATE OF "currentVersionId" ON "Document"
  FOR EACH ROW EXECUTE FUNCTION "document_current_version_guard"();

-- ---- DocumentVersion: immutable, and undeletable while pinned (invariant D1) ----------

ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "DocumentVersion_title_length" CHECK (char_length(btrim("title")) BETWEEN 1 AND 255),
  ADD CONSTRAINT "DocumentVersion_message_length" CHECK ("message" IS NULL OR char_length("message") <= 500);

CREATE FUNCTION "document_version_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only "pinned" may change: a baseline freeze pins, deleting the baseline unpins.
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."documentId" IS DISTINCT FROM OLD."documentId"
       OR NEW."number"     IS DISTINCT FROM OLD."number"
       OR NEW."title"      IS DISTINCT FROM OLD."title"
       OR NEW."content"    IS DISTINCT FROM OLD."content"
       OR NEW."authorId"   IS DISTINCT FROM OLD."authorId"
       OR NEW."message"    IS DISTINCT FROM OLD."message"
       OR NEW."createdAt"  IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'DocumentVersion % is immutable: only "pinned" may change', OLD."id" USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF OLD."pinned" THEN
    RAISE EXCEPTION 'DocumentVersion % is pinned by a baseline and cannot be deleted', OLD."id" USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "DocumentVersion_guard"
  BEFORE UPDATE OR DELETE ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION "document_version_guard"();

-- ---- DocumentDraft ---------------------------------------------------------------------

ALTER TABLE "DocumentDraft"
  ADD CONSTRAINT "DocumentDraft_base_positive" CHECK ("baseVersionNumber" > 0),
  ADD CONSTRAINT "DocumentDraft_title_length" CHECK (char_length("title") BETWEEN 0 AND 255);

-- ---- Attachment: bounded, content-addressed, bytes immutable (RD-058) ------------------

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_size_matches" CHECK ("size" = octet_length("data") AND "size" > 0 AND "size" <= 10485760),
  ADD CONSTRAINT "Attachment_filename_length" CHECK (char_length("filename") BETWEEN 1 AND 255),
  ADD CONSTRAINT "Attachment_content_type_length" CHECK (char_length("contentType") BETWEEN 3 AND 255),
  ADD CONSTRAINT "Attachment_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION "attachment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only "deletedAt" may change. Past versions keep pointing at the same bytes.
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."documentId"   IS DISTINCT FROM OLD."documentId"
     OR NEW."filename"     IS DISTINCT FROM OLD."filename"
     OR NEW."contentType"  IS DISTINCT FROM OLD."contentType"
     OR NEW."size"         IS DISTINCT FROM OLD."size"
     OR NEW."sha256"       IS DISTINCT FROM OLD."sha256"
     OR NEW."data"         IS DISTINCT FROM OLD."data"
     OR NEW."uploadedById" IS DISTINCT FROM OLD."uploadedById"
     OR NEW."createdAt"    IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Attachment % is immutable: only "deletedAt" may change', OLD."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Attachment_guard"
  BEFORE UPDATE ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION "attachment_guard"();

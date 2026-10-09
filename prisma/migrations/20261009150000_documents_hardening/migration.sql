-- Hardening of 20261009120000_documents (slice 1, document-repositories). Each rule closes an
-- attack that src/server/repositories/__tests__/documents-invariants.integration.test.ts showed
-- the previous migration let through. Forward-only; nothing is dropped that anything writes.

-- 1. RD-056: a title is unique per space among live pages, case-insensitively — whatever the
--    cluster's locale. lower() follows the database's LC_CTYPE, and under the C locale it folds
--    ASCII only, so "Äpfel" and "äpfel" could both be live. The ICU root collation folds every
--    script, identically on every installation.
DROP INDEX "Document_live_spaceId_title_key";
CREATE UNIQUE INDEX "Document_live_spaceId_title_key"
  ON "Document" ("spaceId", lower("title" COLLATE "und-x-icu")) WHERE "deletedAt" IS NULL;

-- 2. 01 Document: "A parent is in the same space". The guard checked a row against its parent
--    but not against its children, so changing the space of a page that has children left them
--    under a parent in another space. Cross-space moves are not built (RD-056); when they are,
--    they detach, move and re-attach.
CREATE OR REPLACE FUNCTION "document_tree_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_space TEXT;
  cursor_id    TEXT;
  depth        INT := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."spaceId" IS DISTINCT FROM OLD."spaceId" AND EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = OLD."spaceId" AND "parentId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'document_tree_guard: a document with children cannot change space' USING ERRCODE = '23514';
  END IF;

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

-- 3. RD-058: attachments are content-addressed. The format CHECK accepted any 64 hex digits,
--    so a row could claim another file's hash — and baseline freeze copies images by hash
--    (RD-012). NOT VALID: enforced for every new row, without failing this migration on a
--    development database that already holds a hand-made row.
ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_sha256_matches" CHECK ("sha256" = encode(sha256("data"), 'hex')) NOT VALID;

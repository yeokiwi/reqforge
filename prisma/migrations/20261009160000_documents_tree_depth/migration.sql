-- Bounds the page tree's depth as a whole (07 §4, RD-070).
--
-- document_tree_guard counted only the new parent's ancestors, so a 1,000-deep chain could be
-- moved under the leaf of another and the tree grew without limit. Anything that walks the
-- tree recursively (a tree renderer, JSON.stringify of a nested forest) fails at a few
-- thousand levels. A move now also counts the height of the subtree being moved: the deepest
-- resulting page may sit at most 1,000 levels below a root.
--
-- The message is the one the repository layer already maps to a typed error
-- (src/server/repositories/db-errors.ts), so a refusal reaches the caller as 422 VALIDATION.

CREATE OR REPLACE FUNCTION "document_tree_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_space   TEXT;
  cursor_id      TEXT;
  depth          INT := 0;
  subtree_height INT := 0;
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

  -- Walk up: refuses a cycle, and counts NEW's ancestors.
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

  -- Walk down: only a move can attach a subtree, and a new row has no children yet.
  IF TG_OP = 'UPDATE' AND NEW."parentId" IS DISTINCT FROM OLD."parentId" THEN
    WITH RECURSIVE sub("id", "level") AS (
      SELECT c."id", 1 FROM "Document" c WHERE c."parentId" = NEW."id"
      UNION ALL
      SELECT d."id", sub."level" + 1 FROM "Document" d JOIN sub ON d."parentId" = sub."id" WHERE sub."level" < 2000
    )
    SELECT COALESCE(MAX("level"), 0) INTO subtree_height FROM sub;

    IF depth + subtree_height > 1000 THEN
      RAISE EXCEPTION 'document_tree_guard: the document tree is implausibly deep' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

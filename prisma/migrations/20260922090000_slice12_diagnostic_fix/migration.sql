-- Slice 12 — the quick fix travels with its diagnostic.
-- spec: 06-requirement-types.md §4; RD-042. Diagnostics are persisted and re-read when a
-- document is opened, so the fix must persist too or the Fix button would only ever
-- appear immediately after a save.
ALTER TABLE "IndexDiagnostic" ADD COLUMN "fix" JSONB;

-- Slice 18 — performance and limits (spec 07 §5, RD-073).
--
-- A property predicate inside a traversal (`to -> @Category = 'Safety'`) is checked once
-- per edge, against the edge's target. With only ("requirementId", kind) the probe read all
-- of the target's properties and filtered them; this makes it one index lookup. It is also
-- the shape of every per-requirement property lookup the matrix and reports make.
CREATE INDEX "Property_requirementId_searchName_value_idx" ON "Property" ("requirementId", "searchName", "value");

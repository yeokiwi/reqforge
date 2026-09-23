import type { PrismaClient } from '@prisma/client';
import { setRestriction } from '@/server/repositories/restrictions';

/**
 * The fixture dataset at scale. spec: 07-permissions-and-limits.md §5 — budgets "measured
 * on the fixture dataset in CI"; RD-073.
 *
 * 50,000 live requirements over five spaces of 10,000, each inside the 12,000 per-space
 * limit, which is the scale research §6.7 states RY's cost at. Shaped to RY's documented
 * expectations: ~10 properties per requirement (research §6.7 says 10–50) and ~3
 * dependencies (3–20), in documents of 100 requirements.
 *
 * Written in set-based SQL (`generate_series`), because row-at-a-time inserts of 500,000
 * properties would take longer than the measurements. Built once and reused: the spaces
 * carry a version marker in their name, and a matching set is left alone. `PERF_FRESH=1`
 * rebuilds regardless. Nothing else in the suite touches `PF*` spaces — every other
 * fixture uses a unique tag.
 */

export const FIXTURE_VERSION = 'perf-fixture v1';
export const SPACES = 5;
export const PER_SPACE = 10_000;
export const PER_DOCUMENT = 100;
export const DOCUMENTS = PER_SPACE / PER_DOCUMENT;
export const PERF_USER_EMAIL = 'perf@reqforge.perf';

export type ScaleFixture = {
  userId: string;
  spaces: Array<{ id: string; key: string }>;
  approvalDefinitionId: string;
  /** Did this call build the data, or find it? Reported, because it changes the run time. */
  built: boolean;
};

export const spaceKeyOf = (index: number): string => `PF${index + 1}`;
export const requirementKeyOf = (spaceKey: string, n: number): string => `${spaceKey}-${String(n).padStart(5, '0')}`;

export async function ensureScaleFixture(prisma: PrismaClient): Promise<ScaleFixture> {
  const user =
    (await prisma.user.findUnique({ where: { email: PERF_USER_EMAIL } })) ??
    (await prisma.user.create({ data: { email: PERF_USER_EMAIL, name: 'Perf', passwordHash: 'scrypt$x$y' } }));
  const approvalDefinitionId = await approvalDefinition(prisma);

  const keys = Array.from({ length: SPACES }, (_, index) => spaceKeyOf(index));
  const existing = await prisma.space.findMany({ where: { key: { in: keys } }, select: { id: true, key: true, name: true } });
  const current =
    process.env.PERF_FRESH !== '1' &&
    existing.length === SPACES &&
    existing.every((space) => space.name.startsWith(FIXTURE_VERSION));

  if (current) {
    return { userId: user.id, spaces: sortByKey(existing), approvalDefinitionId, built: false };
  }

  for (const space of existing) await dropSpace(prisma, space.id);

  const spaces: Array<{ id: string; key: string }> = [];
  for (const [index, key] of keys.entries()) {
    spaces.push(await buildSpace(prisma, { key, index, userId: user.id, approvalDefinitionId }));
  }
  await prisma.$executeRawUnsafe('ANALYZE');
  return { userId: user.id, spaces, approvalDefinitionId, built: true };
}

function sortByKey<T extends { key: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key));
}

async function approvalDefinition(prisma: PrismaClient): Promise<string> {
  const found = await prisma.externalPropertyDefinition.findUnique({ where: { name: 'Approval' } });
  if (found) return found.id;
  try {
    return (await prisma.externalPropertyDefinition.create({ data: { name: 'Approval', dataType: 'ENUM', enumValues: ['Pending', 'Signed off'] } })).id;
  } catch {
    return (await prisma.externalPropertyDefinition.findUniqueOrThrow({ where: { name: 'Approval' } })).id;
  }
}

async function buildSpace(
  prisma: PrismaClient,
  input: { key: string; index: number; userId: string; approvalDefinitionId: string },
): Promise<{ id: string; key: string }> {
  const { key } = input;
  const space = await prisma.space.create({
    data: { key, name: `${FIXTURE_VERSION} (${input.index + 1}/${SPACES})` },
  });
  await prisma.membership.create({
    data: { spaceId: space.id, userId: input.userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
  });

  // Two types: every fixture key matches the first, whose one rule makes validation do
  // real work on every save; the second is what the indexing budget writes.
  const functional = await prisma.requirementType.create({
    data: { spaceId: space.id, name: 'Functional', keyPattern: `${key}-#####`, nextSequence: PER_SPACE + 1 },
  });
  await prisma.requirementTypeRule.create({ data: { typeId: functional.id, kind: 'REQUIRED_PROPERTY', name: 'Priority' } });
  const probe = await prisma.requirementType.create({ data: { spaceId: space.id, name: 'Index probe', keyPattern: `${key}X-###` } });
  await prisma.requirementTypeRule.create({ data: { typeId: probe.id, kind: 'REQUIRED_PROPERTY', name: 'Priority' } });

  const prefix = key.toLowerCase();
  const run = (text: string, ...params: unknown[]) => prisma.$executeRawUnsafe(text, ...params);

  // Documents, one version each, `DOCUMENTS` of them.
  await run(
    `INSERT INTO "Document" (id, "spaceId", title, ordinal, "restrictionMode")
     SELECT '${prefix}-d-' || d, $1, 'Specification ' || d, d, 'INHERIT'
     FROM generate_series(1, ${DOCUMENTS}) AS d`,
    space.id,
  );
  await run(
    `INSERT INTO "DocumentVersion" (id, "documentId", number, content, "authorId")
     SELECT '${prefix}-v-' || d, '${prefix}-d-' || d, 1,
            jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
              jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', 'Specification ' || d))))),
            $1
     FROM generate_series(1, ${DOCUMENTS}) AS d`,
    input.userId,
  );
  await run(`UPDATE "Document" SET "currentVersionId" = '${prefix}-v-' || ordinal WHERE "spaceId" = $1`, space.id);

  // Requirements: document d holds n in ((d-1)*100, d*100].
  await run(
    `INSERT INTO "Requirement" (id, "spaceId", key, "upperKey", status, title, "bodyHtml", "bodySearch", "anchorPath", uid,
                                "originVersionId", "typeId", "createdById", "updatedAt")
     SELECT '${prefix}-r-' || n, $1, k, k, 'ACTIVE',
            'The system shall satisfy obligation ' || n,
            '<p>The system shall satisfy obligation ' || n || ' within ' || (n % 97) || ' ms.</p>',
            'The system shall satisfy obligation ' || n || ' within ' || (n % 97) || ' ms ' || md5(n::text),
            '0.' || ((n - 1) % ${PER_DOCUMENT}), 'uid-${prefix}-' || n,
            '${prefix}-v-' || ((n - 1) / ${PER_DOCUMENT} + 1), $2, $3, now()
     FROM (SELECT n, '${key}-' || lpad(n::text, 5, '0') AS k FROM generate_series(1, ${PER_SPACE}) AS n) AS s`,
    space.id,
    functional.id,
    input.userId,
  );
  await run(
    `INSERT INTO "DocumentLink" (id, "requirementId", "versionId", origin, "anchorPath")
     SELECT '${prefix}-l-' || n, '${prefix}-r-' || n, '${prefix}-v-' || ((n - 1) / ${PER_DOCUMENT} + 1), true, '0.' || ((n - 1) % ${PER_DOCUMENT})
     FROM generate_series(1, ${PER_SPACE}) AS n`,
  );

  // Ten inline properties each. `Batch` splits the space exactly in half, which is how the
  // coverage and freeze budgets select their 5,000.
  await run(
    `INSERT INTO "Property" (id, "requirementId", kind, name, "searchName", value, "valueOrdinal", "valueIndex")
     SELECT '${prefix}-p-' || n || '-' || p, '${prefix}-r-' || n, 'INLINE', name, lower(name), value, p, 0
     FROM generate_series(1, ${PER_SPACE}) AS n
     CROSS JOIN LATERAL (VALUES
       (0, 'Category',     (ARRAY['Safety','Performance','Usability','Security'])[n % 4 + 1]),
       (1, 'Priority',     (ARRAY['High','Medium','Low'])[n % 3 + 1]),
       (2, 'Batch',        CASE WHEN n <= ${PER_SPACE / 2} THEN 'A' ELSE 'B' END),
       (3, 'Owner',        'team-' || (n % 12)),
       (4, 'Component',    'component-' || (n % 40)),
       (5, 'Release',      'R' || (n % 6 + 1)),
       (6, 'Risk',         (ARRAY['Low','Medium','High','Critical'])[n % 4 + 1]),
       (7, 'Verification', (ARRAY['Test','Inspection','Analysis','Demonstration'])[n % 4 + 1]),
       (8, 'Source',       'stakeholder-' || (n % 25)),
       (9, 'Rationale',    'Derived from need ' || (n % 500))
     ) AS props(p, name, value)`,
  );
  await run(
    `INSERT INTO "Property" (id, "requirementId", kind, name, "searchName", value, "valueOrdinal", "valueIndex", "definitionId")
     SELECT '${prefix}-x-' || n, '${prefix}-r-' || n, 'EXTERNAL', 'Approval', 'approval',
            CASE WHEN n % 100 = 0 THEN 'Signed off' ELSE 'Pending' END, 0, 0, $1
     FROM generate_series(50, ${PER_SPACE}, 50) AS n`,
    input.approvalDefinitionId,
  );

  // About three edges each: a refinement tree, verification 100 back, derivation 3 back,
  // and satisfaction of the next requirement for every third.
  await run(
    `INSERT INTO "Dependency" (relationship, "parentId", "childId")
     SELECT 'refines', '${prefix}-r-' || (n / 2), '${prefix}-r-' || n FROM generate_series(2, ${PER_SPACE}) AS n
     UNION ALL
     SELECT 'verifies', '${prefix}-r-' || (n - 100), '${prefix}-r-' || n FROM generate_series(101, ${PER_SPACE}) AS n
     UNION ALL
     SELECT 'derives', '${prefix}-r-' || (n - 3), '${prefix}-r-' || n FROM generate_series(4, ${PER_SPACE}) AS n WHERE n % 3 = 0
     UNION ALL
     SELECT 'satisfies', '${prefix}-r-' || (n + 1), '${prefix}-r-' || n FROM generate_series(1, ${PER_SPACE} - 1) AS n WHERE n % 3 = 1`,
  );

  // Two restricted documents per space, through the real writer so the inherited gates are
  // built as in use: rule X3's predicate has gates to evaluate, as it would in production.
  for (const d of [DOCUMENTS - 1, DOCUMENTS]) {
    await prisma.$transaction((tx) =>
      setRestriction(tx, { documentId: `${prefix}-d-${d}`, mode: 'EXPLICIT', grants: [{ userId: input.userId, canView: true, canEdit: true }] }),
    );
  }

  return { id: space.id, key };
}

/**
 * Drops a fixture space, oldest dependents first. Versions a freeze pinned are unpinned
 * before deletion: the pin guards a real baseline, and the baselines go first.
 */
export async function dropSpace(prisma: PrismaClient, spaceId: string): Promise<void> {
  const run = (text: string) => prisma.$executeRawUnsafe(text, spaceId);
  const inSpace = `SELECT id FROM "Requirement" WHERE "spaceId" = $1`;
  const docs = `SELECT id FROM "Document" WHERE "spaceId" = $1`;
  await run(`DELETE FROM "Dependency" WHERE "childId" IN (${inSpace}) OR "parentId" IN (${inSpace})`);
  await run(`DELETE FROM "UnresolvedDependency" WHERE "childId" IN (${inSpace})`);
  await run(`DELETE FROM "DocumentLink" WHERE "requirementId" IN (${inSpace})`);
  await run(`DELETE FROM "Property" WHERE "requirementId" IN (${inSpace})`);
  await run(`DELETE FROM "RequirementLabel" WHERE "requirementId" IN (${inSpace})`);
  await run(`DELETE FROM "RequirementValidation" WHERE "requirementId" IN (${inSpace})`);
  await run(`DELETE FROM "RequirementHistory" WHERE "requirementId" IN (${inSpace})`);
  await run(`DELETE FROM "RequirementKeyAlias" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "Requirement" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "BaselineDanglingDependency" WHERE "baselineId" IN (SELECT id FROM "Baseline" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "BaselineRevision" WHERE "baselineId" IN (SELECT id FROM "Baseline" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "BaselineGateGrant" WHERE "baselineId" IN (SELECT id FROM "Baseline" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "BaselineViewGate" WHERE "baselineId" IN (SELECT id FROM "Baseline" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "Baseline" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "IndexDiagnostic" WHERE "documentId" IN (${docs})`);
  await run(`DELETE FROM "DocumentViewGate" WHERE "documentId" IN (${docs}) OR "gateDocumentId" IN (${docs})`);
  await run(`DELETE FROM "DocumentRestriction" WHERE "documentId" IN (${docs})`);
  await run(`UPDATE "Document" SET "currentVersionId" = NULL, "parentId" = NULL WHERE "spaceId" = $1`);
  await run(`UPDATE "DocumentVersion" SET pinned = false WHERE "documentId" IN (${docs})`);
  await run(`DELETE FROM "DocumentVersion" WHERE "documentId" IN (${docs})`);
  await run(`DELETE FROM "Document" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "RequirementTypeRule" WHERE "typeId" IN (SELECT id FROM "RequirementType" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "TemplateColumn" WHERE "typeId" IN (SELECT id FROM "RequirementType" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "RequirementType" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "Job" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "AuditEvent" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "WebhookDelivery" WHERE "webhookId" IN (SELECT id FROM "Webhook" WHERE "spaceId" = $1)`);
  await run(`DELETE FROM "WebhookEvent" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "Webhook" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "SavedMatrix" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "SavedSearch" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "CoverageTarget" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "Membership" WHERE "spaceId" = $1`);
  await run(`DELETE FROM "Space" WHERE id = $1`);
}

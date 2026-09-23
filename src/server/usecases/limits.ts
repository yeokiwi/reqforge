import { NotFoundError } from '@/domain/errors';
import { LIMIT_IDS, LIMITS, parseLimitOverrides, resolveLimits, type LimitId } from '@/domain/limits';
import { requireInstanceAdmin } from '@/server/authz';
import { installationLimits } from '@/server/limits';
import { recordAuditEvent } from '@/server/repositories/audit';
import { findSpaceByKey, listAllSpaces, setSpaceLimits } from '@/server/repositories/spaces';

export type LimitRow = {
  id: LimitId;
  label: string;
  kind: 'hard' | 'warning';
  override: 'any' | 'lower-only' | 'fixed';
  source: string;
  specDefault: number;
  installation: number;
};

/**
 * The limits screen: every limit of spec 07 §4 with its default, the installation's value,
 * and each space's overrides. Instance administrators only (RD-071): a space administrator
 * raising their own space's limits would defeat the point of having them.
 */
export async function limitsOverviewUseCase() {
  await requireInstanceAdmin('manage limits');
  const effective = resolveLimits(installationLimits());
  const rows: LimitRow[] = LIMIT_IDS.map((id) => ({
    id,
    label: LIMITS[id].label,
    kind: LIMITS[id].kind,
    override: LIMITS[id].override,
    source: LIMITS[id].source,
    specDefault: LIMITS[id].default,
    installation: effective[id],
  }));
  const spaces = (await listAllSpaces()).map((space) => ({
    key: space.key,
    name: space.name,
    overrides: parseLimitOverrides(space.limits, 'The space override'),
  }));
  return { rows, spaces };
}

/**
 * Replaces a space's overrides. An empty object clears them. Checked against the override
 * classes before anything is written, and audited (spec 07 §6).
 */
export async function setSpaceLimitsUseCase(spaceKey: string, raw: unknown): Promise<void> {
  const user = await requireInstanceAdmin('manage limits');
  const space = await findSpaceByKey(spaceKey);
  if (!space) throw new NotFoundError(`No space with key "${spaceKey}".`);

  const overrides = parseLimitOverrides(raw, 'The space override');
  resolveLimits(installationLimits(), overrides);
  const before = parseLimitOverrides(space.limits, 'The space override');

  await setSpaceLimits(space.id, overrides);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Space',
    objectId: space.id,
    operation: 'limits.update',
    parameters: { before, after: overrides },
  });
}

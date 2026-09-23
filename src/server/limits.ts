import { ValidationError } from '@/domain/errors';
import { parseLimitOverrides, resolveLimits, type LimitOverrides, type Limits } from '@/domain/limits';
import { findSpaceById } from '@/server/repositories/spaces';

/**
 * Where limits come from at run time. spec: 07-permissions-and-limits.md §4 — "Configured
 * per installation with per-space overrides." RD-071.
 *
 * - Installation: the `REQFORGE_LIMITS` environment variable, a JSON object of limit ids to
 *   numbers, e.g. `{"requirementsPerSpace": 20000}`.
 * - Space: `Space.limits`, written only by an instance administrator (`/admin/limits`).
 */
let installation: { raw: string | undefined; parsed: LimitOverrides } | null = null;

export function installationLimits(): LimitOverrides {
  const raw = process.env.REQFORGE_LIMITS;
  // Re-parsed only when the variable changes, which in practice means once per process.
  if (installation && installation.raw === raw) return installation.parsed;
  let json: unknown = null;
  if (raw !== undefined && raw.trim() !== '') {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ValidationError('REQFORGE_LIMITS is not valid JSON.');
    }
  }
  const parsed = parseLimitOverrides(json, 'REQFORGE_LIMITS');
  resolveLimits(parsed); // Refuse a bad installation value here, not on some later request.
  installation = { raw, parsed };
  return parsed;
}

/** The effective limits of a space already in hand (every `requireSpace` has it). */
export function limitsOf(space: { limits: unknown }): Limits {
  return resolveLimits(installationLimits(), parseLimitOverrides(space.limits, 'The space override'));
}

/** For code that holds only an id — a job handler, a repository. One read. */
export async function limitsForSpaceId(spaceId: string): Promise<Limits> {
  const space = await findSpaceById(spaceId);
  return space ? limitsOf(space) : resolveLimits(installationLimits());
}

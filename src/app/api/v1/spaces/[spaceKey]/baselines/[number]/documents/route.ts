import { routesAt } from '@/server/api/registry';

// spec 08 — the handlers are defined, validated and documented in `src/server/api`.
export const { GET } = routesAt('/spaces/{spaceKey}/baselines/{number}/documents');

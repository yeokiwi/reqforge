import { routesAt } from '@/server/api/registry';

// spec 08 — the handlers are defined, validated and documented in `src/server/api`.
export const { GET, POST } = routesAt('/spaces/{spaceKey}/documents');

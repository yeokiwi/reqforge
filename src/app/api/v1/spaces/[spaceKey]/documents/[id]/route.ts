import { routesAt } from '@/server/api/registry';

// spec 08 — the handlers are defined, validated and documented in `src/server/api`.
export const { GET, PUT } = routesAt('/spaces/{spaceKey}/documents/{id}');

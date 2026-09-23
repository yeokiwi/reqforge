import { ActionForm } from '@/app/_components/action-form';
import { Panel } from '@/app/_components/chrome';
import { PermissionRequired } from '@/app/_components/permission-required';
import { requireSpace } from '@/server/authz';
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '@/server/authz/permissions';
import { listLevelsUseCase } from '@/server/usecases/classification';
import { listPermissionsUseCase } from '@/server/usecases/permissions';
import { setPermissionsAction, setSpaceLabelAction } from './actions';

/**
 * Space permissions and the space's classification label.
 * spec: 07-permissions-and-limits.md §2.1, §2.3, §6; RD-060, RD-061.
 */
export default async function PermissionsPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, can } = await requireSpace(spaceKey);
  if (!can('ADMIN')) return <PermissionRequired spaceKey={spaceKey} permission="ADMIN" what="Managing permissions" />;

  const [memberships, levels] = await Promise.all([listPermissionsUseCase(spaceKey), listLevelsUseCase()]);
  const grant = setPermissionsAction.bind(null, spaceKey);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Permissions</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Who may do what in {space.name}. Any permission implies VIEW, and the space always keeps at least one
          administrator. Every change is written to the audit log.
        </p>
      </div>

      <Panel>
        <table className="w-full text-sm" data-testid="permissions-table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
              <th className="pb-2">Who</th>
              {ALL_PERMISSIONS.map((permission) => (
                <th key={permission} className="w-20 pb-2" title={PERMISSION_LABELS[permission]}>
                  {permission}
                </th>
              ))}
              <th className="w-24 pb-2" />
            </tr>
          </thead>
          <tbody>
            {memberships.map((membership) => {
              const subject = membership.userId
                ? { name: 'email', value: membership.detail }
                : { name: 'group', value: membership.name };
              return (
                <tr key={membership.id} className="border-t border-[var(--rf-line)]" data-testid={`member-${membership.name}`}>
                  <td className="py-1.5">
                    <div>{membership.name}</div>
                    <div className="text-xs text-[var(--rf-muted)]">{membership.detail}</div>
                  </td>
                  <td colSpan={ALL_PERMISSIONS.length + 1} className="py-1.5">
                    <ActionForm action={grant} submitLabel="Save" className="flex items-center gap-6">
                      <input type="hidden" name={subject.name} value={subject.value} />
                      {ALL_PERMISSIONS.map((permission) => (
                        <input
                          key={permission}
                          type="checkbox"
                          name="permissions"
                          value={permission}
                          aria-label={`${membership.name} ${permission}`}
                          defaultChecked={membership.permissions.includes(permission)}
                          className="w-14"
                        />
                      ))}
                    </ActionForm>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Grant</h2>
        <ActionForm action={grant} submitLabel="Grant" testId="grant-form">
          <input name="email" placeholder="person@example.org" aria-label="Email" className="w-56 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
          <span className="text-xs text-[var(--rf-muted)]">or</span>
          <input name="group" placeholder="Group name" aria-label="Group" className="w-40 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
          {ALL_PERMISSIONS.map((permission) => (
            <label key={permission} className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="permissions" value={permission} defaultChecked={permission === 'VIEW'} />
              {permission}
            </label>
          ))}
        </ActionForm>
      </Panel>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Classification</h2>
        <ActionForm action={setSpaceLabelAction.bind(null, spaceKey)} submitLabel="Save label">
          <select
            name="levelId"
            defaultValue={space.classificationId ?? ''}
            aria-label="Space classification"
            className="rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
          >
            <option value="">None</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
        </ActionForm>
        <p className="mt-1 text-xs text-[var(--rf-muted)]">
          The floor for every document and requirement in the space (spec 07 §2.3). Instance administrators set the
          list and its order.
        </p>
      </Panel>
    </main>
  );
}

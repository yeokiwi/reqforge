import { ActionForm } from '@/app/_components/action-form';
import { Panel, TopBar } from '@/app/_components/chrome';
import { instanceAdminOrRefusal } from '@/app/_components/instance-admin';
import { listGroupsUseCase } from '@/server/usecases/groups';
import { addMemberAction, createGroupAction, deleteGroupAction, removeMemberAction } from './actions';

/**
 * Groups, instance-wide. spec 07 §2 (subjects are users and groups); RD-061. A group can
 * hold space permissions and appear on a document's restriction list, so changing its
 * members changes what they may see — every change is audited.
 */
export default async function GroupsPage() {
  const gate = await instanceAdminOrRefusal('manage groups');
  if ('refusal' in gate) return gate.refusal;
  const groups = await listGroupsUseCase();

  return (
    <>
      <TopBar userName={gate.user.name} />
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Groups</h1>
          <p className="text-sm text-[var(--rf-muted)]">
            Shared by every space. Grant a group permissions on a space&rsquo;s Permissions screen, or name it on a
            document&rsquo;s restriction list.
          </p>
        </div>
        <Panel>
          <ActionForm action={createGroupAction} submitLabel="Create group" testId="create-group">
            <input name="name" placeholder="Group name" aria-label="Group name" className="w-64 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
          </ActionForm>
        </Panel>
        {groups.map((group) => (
          <Panel key={group.id}>
            <div className="mb-2 flex items-center gap-3" data-testid={`group-${group.name}`}>
              <h2 className="flex-1 font-medium">{group.name}</h2>
              <ActionForm action={deleteGroupAction} submitLabel="Delete group" danger>
                <input type="hidden" name="groupId" value={group.id} />
              </ActionForm>
            </div>
            <ul className="mb-2 flex flex-col gap-1 text-sm">
              {group.members.map((member) => (
                <li key={member.id} className="flex items-center gap-3">
                  <span className="flex-1">
                    {member.name} <span className="text-xs text-[var(--rf-muted)]">{member.email}</span>
                  </span>
                  <ActionForm action={removeMemberAction} submitLabel="Remove" danger>
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="userId" value={member.id} />
                  </ActionForm>
                </li>
              ))}
              {group.members.length === 0 ? <li className="text-xs text-[var(--rf-muted)]">No members.</li> : null}
            </ul>
            <ActionForm action={addMemberAction} submitLabel="Add member">
              <input type="hidden" name="groupId" value={group.id} />
              <input name="email" placeholder="person@example.org" aria-label={`Add to ${group.name}`} className="w-64 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
            </ActionForm>
          </Panel>
        ))}
      </main>
    </>
  );
}

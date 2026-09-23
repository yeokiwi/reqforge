'use client';

import { useMemo, useState } from 'react';
import { ActionForm, type FormState } from '@/app/_components/action-form';

type Grant = { userId: string | null; groupId: string | null; name: string; canView: boolean; canEdit: boolean };
type Subject = { id: string; label: string; kind: 'user' | 'group' };

/**
 * The restriction editor. spec 07 §2.2 — an explicit allow-list of users and groups for
 * view and for edit. Edit implies view, so ticking edit ticks view; the server applies
 * the same rule and refuses a list that would lock the editor out (RD-057).
 */
export function RestrictionEditor({
  action,
  initialMode,
  initialGrants,
  users,
  groups,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  initialMode: 'INHERIT' | 'EXPLICIT';
  initialGrants: Grant[];
  users: Array<{ id: string; name: string; email: string }>;
  groups: Array<{ id: string; name: string }>;
}) {
  const [mode, setMode] = useState(initialMode);
  const [grants, setGrants] = useState<Grant[]>(initialGrants);
  const [pick, setPick] = useState('');

  const subjects: Subject[] = useMemo(
    () => [
      ...users.map((user) => ({ id: `u:${user.id}`, label: `${user.name} <${user.email}>`, kind: 'user' as const })),
      ...groups.map((group) => ({ id: `g:${group.id}`, label: `${group.name} (group)`, kind: 'group' as const })),
    ],
    [users, groups],
  );

  const taken = new Set(grants.map((grant) => (grant.userId ? `u:${grant.userId}` : `g:${grant.groupId}`)));

  const add = () => {
    const subject = subjects.find((candidate) => candidate.id === pick);
    if (!subject) return;
    const id = subject.id.slice(2);
    setGrants((current) => [
      ...current,
      {
        userId: subject.kind === 'user' ? id : null,
        groupId: subject.kind === 'group' ? id : null,
        name: subject.label,
        canView: true,
        canEdit: false,
      },
    ]);
    setPick('');
  };

  const update = (index: number, change: Partial<Grant>) =>
    setGrants((current) =>
      current.map((grant, position) => {
        if (position !== index) return grant;
        const next = { ...grant, ...change };
        // Edit implies view (spec 07 §2.2): you cannot edit what you cannot see.
        if (change.canEdit) next.canView = true;
        if (change.canView === false) next.canEdit = false;
        return next;
      }),
    );

  return (
    <ActionForm action={action} submitLabel="Save restrictions" className="flex flex-col gap-3" testId="restriction-form">
      <input type="hidden" name="mode" value={mode} />
      <input
        type="hidden"
        name="grants"
        value={JSON.stringify(grants.map(({ userId, groupId, canView, canEdit }) => ({ userId, groupId, canView, canEdit })))}
      />

      <fieldset className="flex flex-col gap-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'INHERIT'} onChange={() => setMode('INHERIT')} />
          No restriction of its own — anyone who can see the space and the documents above it
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'EXPLICIT'} onChange={() => setMode('EXPLICIT')} data-testid="mode-explicit" />
          Only these people and groups
        </label>
      </fieldset>

      {mode === 'EXPLICIT' ? (
        <>
          <table className="w-full text-sm" data-testid="restriction-grants">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
                <th className="pb-1">Who</th>
                <th className="w-16 pb-1">View</th>
                <th className="w-16 pb-1">Edit</th>
                <th className="w-16 pb-1" />
              </tr>
            </thead>
            <tbody>
              {grants.map((grant, index) => (
                <tr key={grant.userId ?? grant.groupId ?? index} className="border-t border-[var(--rf-line)]">
                  <td className="py-1">{grant.name}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${grant.name} can view`}
                      checked={grant.canView}
                      onChange={(event) => update(index, { canView: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${grant.name} can edit`}
                      checked={grant.canEdit}
                      onChange={(event) => update(index, { canEdit: event.target.checked })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-xs text-red-600"
                      onClick={() => setGrants((current) => current.filter((_, position) => position !== index))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            <select
              value={pick}
              onChange={(event) => setPick(event.target.value)}
              aria-label="Add a person or group"
              className="rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
            >
              <option value="">Add a person or group…</option>
              {subjects
                .filter((subject) => !taken.has(subject.id))
                .map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.label}
                  </option>
                ))}
            </select>
            <button type="button" onClick={add} className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs">
              Add
            </button>
          </div>
          <p className="text-xs text-[var(--rf-muted)]">
            Viewing is inherited: a document below this one is hidden from anyone not on this list too. Editing is
            not. Leave nobody with edit ticked and every viewer who has EDIT in the space may edit.
          </p>
        </>
      ) : null}
    </ActionForm>
  );
}

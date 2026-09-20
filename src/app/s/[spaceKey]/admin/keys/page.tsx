import { Panel } from '@/app/_components/chrome';
import { parsePattern, suggestNextKey } from '@/domain/keys/pattern';
import { requireSpace } from '@/server/authz';
import { listAllKeys, listRequirementTypes } from '@/server/repositories/requirement-types';
import { ResetSequenceForm } from './reset-form';

export default async function KeysAdminPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, can } = await requireSpace(spaceKey);
  const [types, keys] = await Promise.all([listRequirementTypes(space.id), listAllKeys(space.id)]);

  const rows = types.map((type) => {
    const parsed = parsePattern(type.keyPattern);
    const next = parsed.ok
      ? suggestNextKey({ pattern: parsed.pattern, nextSequence: type.nextSequence, existingKeys: keys }).key
      : '—';
    return { type, next, problem: parsed.ok ? null : parsed.message };
  });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Keys</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Key patterns and their sequences. A sequence advances when a key is used and never rewinds when one is
          deleted (spec 03 §4.2).
        </p>
      </div>

      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
              <th className="pb-2">Pattern</th>
              <th className="pb-2">Name</th>
              <th className="pb-2">Next key</th>
              <th className="pb-2">Locked</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ type, next, problem }) => (
              <tr key={type.id} className="border-t border-[var(--rf-line)]">
                <td className="py-2 font-mono text-xs">{type.keyPattern}</td>
                <td className="py-2">{type.name ?? <span className="text-[var(--rf-muted)]">key suggestion only</span>}</td>
                <td className="py-2 font-mono text-xs" data-testid={`next-key-${type.keyPattern}`}>
                  {problem ? <span className="text-red-600">{problem}</span> : next}
                </td>
                <td className="py-2 text-xs">{type.locked ? 'yes' : 'no'}</td>
                <td className="py-2">
                  {can('EDIT') ? (
                    <ResetSequenceForm
                      spaceKey={spaceKey}
                      typeId={type.id}
                      disabled={type.preventReusingDeletedKeys}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-[var(--rf-muted)]">
                  No key patterns configured.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </main>
  );
}

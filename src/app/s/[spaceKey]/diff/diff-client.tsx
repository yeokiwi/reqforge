'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  ALL_CLASSES,
  DEFAULT_COMPARE,
  DEFAULT_IGNORE,
  dependencyLines,
  isDefaultFieldSet,
  propertyLines,
  setDiff,
  wordDiff,
  type ComparableRow,
  type CompareSet,
  type DiffClass,
  type DiffRow,
  type IgnoreSet,
} from '@/domain/diff';
import { QueryUnderline } from '../search/query-underline';
import {
  diffJobStatusAction,
  exportDiffAction,
  runDiffAction,
  type DiffJobView,
  type DiffResponse,
} from './actions';

const field = 'rounded border border-[var(--rf-line)] px-2 py-1 text-sm';

const CLASS_STYLES: Record<DiffClass, string> = {
  added: 'bg-emerald-50 text-emerald-700',
  removed: 'bg-red-50 text-red-700',
  modified: 'bg-amber-50 text-amber-800',
  unchanged: 'bg-[var(--rf-bg)] text-[var(--rf-muted)]',
};

/**
 * The diff screen.
 * spec: 05-baselines-and-diff.md §5 — two queries, because "selecting two baselines
 * merely pre-fills them" (research §5.5). Baseline pages link in here pre-filled.
 */
export function DiffClient({
  spaceKey,
  canExport,
  initialLeft,
  initialRight,
}: {
  spaceKey: string;
  canExport: boolean;
  initialLeft: string;
  initialRight: string;
}) {
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState(initialRight);
  const [compare, setCompare] = useState<CompareSet>(DEFAULT_COMPARE);
  const [ignore, setIgnore] = useState<IgnoreSet>(DEFAULT_IGNORE);
  const [filter, setFilter] = useState<DiffClass[]>(['added', 'removed', 'modified']);
  const [response, setResponse] = useState<DiffResponse | null>(null);
  const [submitted, setSubmitted] = useState({ left: initialLeft, right: initialRight });
  const [job, setJob] = useState<DiffJobView | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setSubmitted({ left, right });
    startTransition(async () => {
      setResponse(await runDiffAction(spaceKey, { left, right, compare, ignore, filter }));
    });
  };

  // A diff arrived pre-filled from a baseline: run it without making the reader press Run.
  useEffect(() => {
    if (initialLeft.length > 0 && initialRight.length > 0) {
      startTransition(async () => {
        setResponse(
          await runDiffAction(spaceKey, {
            left: initialLeft,
            right: initialRight,
            compare: DEFAULT_COMPARE,
            ignore: DEFAULT_IGNORE,
            filter: ['added', 'removed', 'modified'],
          }),
        );
      });
    }
  }, [initialLeft, initialRight, spaceKey]);

  const startExport = () => {
    startTransition(async () => {
      const started = await exportDiffAction(spaceKey, { left, right, compare, ignore, filter });
      if ('failed' in started) return;
      setJob(started);

      for (let attempt = 0; attempt < 40 && started.state !== 'DONE'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const status = await diffJobStatusAction(spaceKey, started.id);
        if ('failed' in status) return;
        setJob(status);
        if (status.state === 'DONE' || status.state === 'FAILED' || status.state === 'CANCELLED') break;
      }
    });
  };

  const success = response && response.ok ? response : null;
  // A refusal (too large for the interactive path) is not a query error, so the two are
  // told apart by which shape came back rather than by a flag.
  const failure = response && !response.ok && 'errors' in response ? response : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={left}
            onChange={(event) => setLeft(event.target.value)}
            aria-label="Left query"
            placeholder="baseline = 1"
            className={`${field} flex-1 min-w-56 font-mono`}
          />
          <span className="text-xs text-[var(--rf-muted)]">compared with</span>
          <input
            value={right}
            onChange={(event) => setRight(event.target.value)}
            aria-label="Right query"
            placeholder="key ~ 'FN-%'"
            className={`${field} flex-1 min-w-56 font-mono`}
          />
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded bg-[var(--rf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--rf-muted)]">
          <span className="font-semibold uppercase tracking-wide">Compare</span>
          {(Object.keys(DEFAULT_COMPARE) as Array<keyof CompareSet>).map((name) => (
            <label key={name} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={compare[name]}
                aria-label={`Compare ${name}`}
                onChange={(event) => setCompare({ ...compare, [name]: event.target.checked })}
              />
              {name}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--rf-muted)]">
          <span className="font-semibold uppercase tracking-wide">Ignore</span>
          {(Object.keys(DEFAULT_IGNORE) as Array<keyof IgnoreSet>).map((name) => (
            <label key={name} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={ignore[name]}
                aria-label={`Ignore ${name}`}
                onChange={(event) => setIgnore({ ...ignore, [name]: event.target.checked })}
              />
              {name}
            </label>
          ))}

          <span className="font-semibold uppercase tracking-wide">Show</span>
          {ALL_CLASSES.map((name) => (
            <label key={name} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={filter.includes(name)}
                aria-label={`Show ${name}`}
                onChange={(event) =>
                  setFilter(event.target.checked ? [...filter, name] : filter.filter((entry) => entry !== name))
                }
              />
              {name}
            </label>
          ))}

          {canExport ? (
            <button type="button" onClick={startExport} className="rounded bg-[var(--rf-bg)] px-2 py-1">
              Export to xlsx
            </button>
          ) : null}
        </div>

        {isDefaultFieldSet(compare, ignore) ? (
          <p className="text-xs text-[var(--rf-muted)]" data-testid="default-set-note">
            This is the field set <code>isModified()</code> uses, so the search predicate and this comparison
            agree exactly (<code>RD-013</code>).
          </p>
        ) : null}
      </div>

      {job ? (
        <p className="text-xs text-[var(--rf-muted)]" data-testid="diff-job">
          Export {job.state.toLowerCase()} — {job.progress}% {job.message ?? ''}
          {job.downloadHref ? (
            <>
              {' '}
              <a href={job.downloadHref} className="text-[var(--rf-accent)]">
                Download
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {response && 'refused' in response ? (
        <p role="alert" data-testid="diff-refused" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {response.refused}
        </p>
      ) : null}

      {failure ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="diff-errors">
          {failure.errors.map((diagnostic, index) => (
            <QueryUnderline
              key={index}
              query={failure.side === 'right' ? submitted.right : submitted.left}
              diagnostic={diagnostic}
            />
          ))}
        </div>
      ) : null}

      {success ? (
        <>
          <p className="flex flex-wrap gap-3 text-xs" data-testid="diff-summary">
            {ALL_CLASSES.map((name) => (
              <span key={name} className={`rounded px-2 py-0.5 ${CLASS_STYLES[name]}`}>
                {success.outcome.summary[name]} {name}
              </span>
            ))}
          </p>

          <table className="w-full text-sm" data-testid="diff-table">
            <tbody>
              {success.outcome.rows.map((row) => (
                <DiffRowView key={row.key} row={row} />
              ))}
              {success.outcome.rows.length === 0 ? (
                <tr>
                  <td className="py-3 text-[var(--rf-muted)]">Nothing matches that filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {success.outcome.total > success.outcome.rows.length ? (
            <p className="text-xs text-[var(--rf-muted)]">
              Showing {success.outcome.rows.length} of {success.outcome.total}. Export for the rest.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One row, with the word-level and set-level detail of spec 05 §5.2 step 5. */
function DiffRowView({ row }: { row: DiffRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-t border-[var(--rf-line)] align-top">
        <td className="w-32 py-1.5">
          <button type="button" onClick={() => setOpen(!open)} className="rf-req">
            {row.key}
          </button>
        </td>
        <td className="w-28 py-1.5">
          <span className={`rounded px-2 py-0.5 text-xs ${CLASS_STYLES[row.kind]}`} data-testid={`class-${row.key}`}>
            {row.kind}
          </span>
        </td>
        <td className="py-1.5 text-xs text-[var(--rf-muted)]">{row.changed.join(', ')}</td>
      </tr>
      {open ? (
        <tr className="border-t border-[var(--rf-line)] bg-[var(--rf-bg)]">
          <td colSpan={3} className="px-3 py-2">
            <Detail row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Detail({ row }: { row: DiffRow }) {
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid={`detail-${row.key}`}>
      {row.changed.includes('title') ? (
        <Words label="Title" before={row.left?.title ?? ''} after={row.right?.title ?? ''} />
      ) : null}
      {row.changed.includes('body') ? (
        <Words label="Body" before={row.left?.bodySearch ?? ''} after={row.right?.bodySearch ?? ''} />
      ) : null}
      {row.changed.includes('inlineProperties') ? (
        <Sets label="Properties" before={propertyLines(row.left?.inlineProperties ?? [])} after={propertyLines(row.right?.inlineProperties ?? [])} />
      ) : null}
      {row.changed.includes('externalProperties') ? (
        <Sets label="External properties" before={propertyLines(row.left?.externalProperties ?? [])} after={propertyLines(row.right?.externalProperties ?? [])} />
      ) : null}
      {row.changed.includes('dependencies') ? (
        <Sets label="Dependencies" before={dependencyLines(row.left?.dependencies ?? [])} after={dependencyLines(row.right?.dependencies ?? [])} />
      ) : null}
      {row.changed.length === 0 ? <Side row={row.right ?? row.left} /> : null}
    </div>
  );
}

function Words({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">{label}</p>
      <p className="rf-prose">
        {wordDiff(before, after).map((segment, index) => (
          <span
            key={index}
            className={
              segment.kind === 'removed'
                ? 'bg-red-100 text-red-800 line-through'
                : segment.kind === 'added'
                  ? 'bg-emerald-100 text-emerald-800'
                  : ''
            }
          >
            {segment.text}
          </span>
        ))}
      </p>
    </div>
  );
}

function Sets({ label, before, after }: { label: string; before: string[]; after: string[] }) {
  const change = setDiff(before, after);
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">{label}</p>
      <ul className="flex flex-col gap-0.5 font-mono text-xs">
        {change.removed.map((entry) => (
          <li key={`-${entry}`} className="text-red-700">
            − {entry}
          </li>
        ))}
        {change.added.map((entry) => (
          <li key={`+${entry}`} className="text-emerald-700">
            + {entry}
          </li>
        ))}
        {change.kept.map((entry) => (
          <li key={`=${entry}`} className="text-[var(--rf-muted)]">
            &nbsp;&nbsp;{entry}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Side({ row }: { row: ComparableRow | undefined }) {
  if (!row) return null;
  return <p className="text-sm">{row.title}</p>;
}

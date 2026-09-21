'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requirementSummaryAction, type RequirementSummary } from './actions';

type PopupState = { key: string; x: number; y: number; summary: RequirementSummary | null; error: string | null };

/**
 * Hover popup for requirement markers and links.
 * spec: 03-authoring-and-indexing.md §6 — "excerpt, properties (external ones marked *),
 * ... and navigation across all occurrences".
 */
export function RequirementPopup({ spaceKey, children }: { spaceKey: string; children: React.ReactNode }) {
  const [state, setState] = useState<PopupState | null>(null);
  const cache = useRef(new Map<string, RequirementSummary | { error: string }>());
  const container = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (key: string, x: number, y: number) => {
      setState({ key, x, y, summary: null, error: null });
      const cached = cache.current.get(key) ?? (await requirementSummaryAction(spaceKey, key));
      cache.current.set(key, cached);
      setState((current) =>
        current?.key === key
          ? 'error' in cached
            ? { ...current, error: cached.error }
            : { ...current, summary: cached }
          : current,
      );
    },
    [spaceKey],
  );

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const over = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-key]');
      if (!target) return;
      const key = target.dataset.key;
      if (!key) return;
      const box = target.getBoundingClientRect();
      void load(key, box.left + window.scrollX, box.bottom + window.scrollY + 6);
    };
    const out = (event: MouseEvent) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (related?.closest('[data-requirement-popup]')) return;
      if ((event.target as HTMLElement | null)?.closest('[data-key]')) setState(null);
    };

    node.addEventListener('mouseover', over);
    node.addEventListener('mouseout', out);
    return () => {
      node.removeEventListener('mouseover', over);
      node.removeEventListener('mouseout', out);
    };
  }, [load]);

  return (
    <div ref={container} className="relative">
      {children}
      {state ? (
        <div
          data-requirement-popup
          data-testid="requirement-popup"
          style={{ position: 'absolute', left: state.x - (container.current?.getBoundingClientRect().left ?? 0) - window.scrollX, top: state.y - (container.current?.getBoundingClientRect().top ?? 0) - window.scrollY }}
          className="z-50 w-96 rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-3 shadow-lg"
        >
          {state.error ? (
            <p className="text-sm text-[var(--rf-muted)]">{state.error}</p>
          ) : state.summary ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="rf-req">{state.summary.key}</span>
                <span className="text-sm font-medium">{state.summary.title}</span>
              </div>
              {state.summary.documentTitle ? (
                <p className="mt-1 text-xs text-[var(--rf-muted)]">Defined in {state.summary.documentTitle}</p>
              ) : null}
              {state.summary.properties.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {state.summary.properties.map((property, index) => (
                    <li key={`${property.name}-${index}`} className="rounded bg-[var(--rf-bg)] px-2 py-0.5 text-xs">
                      <span className="text-[var(--rf-muted)]">
                        {property.name}
                        {property.external ? '*' : ''}:
                      </span>{' '}
                      {property.value}
                    </li>
                  ))}
                </ul>
              ) : null}
              {state.summary.dependencies.length > 0 ? (
                <dl className="mt-2 flex flex-col gap-1 text-xs" data-testid="popup-dependencies">
                  {state.summary.dependencies.map((group) => (
                    <div key={group.label} className="flex gap-2">
                      <dt className="shrink-0 text-[var(--rf-muted)]">{group.label}:</dt>
                      <dd className="flex flex-wrap gap-1">
                        {group.keys.map((entry) => (
                          <span
                            key={entry.key}
                            className={entry.unresolved ? 'rf-req-link text-red-600' : 'rf-req'}
                          >
                            {entry.key}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <a href={state.summary.href} className="mt-2 inline-block text-xs text-[var(--rf-accent)]">
                Open requirement →
              </a>
            </>
          ) : (
            <p className="text-sm text-[var(--rf-muted)]">Loading {state.key}…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

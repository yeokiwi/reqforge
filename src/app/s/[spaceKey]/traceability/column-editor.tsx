'use client';

import { useState } from 'react';
import { columnLabel, type MatrixColumn } from '@/domain/traceability/matrix';

/** The cog menu of research §4.2: a property, a dependency selector, or a plain field. */
export function ColumnEditor({
  columns,
  onChange,
}: {
  columns: MatrixColumn[];
  onChange: (columns: MatrixColumn[]) => void;
}) {
  const [kind, setKind] = useState<MatrixColumn['kind']>('property');
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<'to' | 'from'>('to');
  const [relationship, setRelationship] = useState('');
  const [depth, setDepth] = useState<1 | 2 | 3 | 4>(1);
  const [render, setRender] = useState<'key' | 'key+title' | 'count'>('key');

  const add = () => {
    let column: MatrixColumn | null = null;

    if (kind === 'property' || kind === 'external') {
      if (name.trim().length === 0) return;
      column = kind === 'property' ? { kind, name: name.trim() } : { kind, name: name.trim(), editable: false };
    } else if (kind === 'dependency') {
      column = {
        kind,
        direction,
        ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
        depth,
        render,
      };
    } else {
      column = { kind } as MatrixColumn;
    }

    onChange([...columns, column]);
    setName('');
    setRelationship('');
  };

  const move = (index: number, by: number) => {
    const next = [...columns];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1" data-testid="matrix-columns">
        {columns.map((column, index) => (
          <li
            key={`${column.kind}-${index}`}
            className="flex items-center gap-1 rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
          >
            <span>{columnLabel(column)}</span>
            <button type="button" aria-label={`Move ${columnLabel(column)} left`} onClick={() => move(index, -1)}>
              ←
            </button>
            <button type="button" aria-label={`Move ${columnLabel(column)} right`} onClick={() => move(index, 1)}>
              →
            </button>
            <button
              type="button"
              aria-label={`Remove ${columnLabel(column)}`}
              className="text-red-600"
              onClick={() => onChange(columns.filter((_, position) => position !== index))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label="Column kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as MatrixColumn['kind'])}
          className="rounded border border-[var(--rf-line)] px-2 py-1"
        >
          <option value="key">Key</option>
          <option value="title">Title</option>
          <option value="status">Status</option>
          <option value="document">Document</option>
          <option value="property">Property</option>
          <option value="external">External property</option>
          <option value="dependency">Dependency</option>
          <option value="ruleStatus">Rule status</option>
        </select>

        {kind === 'property' || kind === 'external' ? (
          <input
            aria-label="Property name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Category"
            className="w-36 rounded border border-[var(--rf-line)] px-2 py-1"
          />
        ) : null}

        {kind === 'dependency' ? (
          <>
            <select
              aria-label="Direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value as 'to' | 'from')}
              className="rounded border border-[var(--rf-line)] px-2 py-1"
            >
              <option value="to">Depends on</option>
              <option value="from">Depended on by</option>
            </select>
            <input
              aria-label="Relationship"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
              placeholder="any relationship"
              className="w-32 rounded border border-[var(--rf-line)] px-2 py-1"
            />
            <select
              aria-label="Depth"
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value) as 1 | 2 | 3 | 4)}
              className="rounded border border-[var(--rf-line)] px-2 py-1"
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  depth {value}
                </option>
              ))}
            </select>
            <select
              aria-label="Render"
              value={render}
              onChange={(event) => setRender(event.target.value as 'key' | 'key+title' | 'count')}
              className="rounded border border-[var(--rf-line)] px-2 py-1"
            >
              <option value="key">keys</option>
              <option value="key+title">keys and titles</option>
              <option value="count">count</option>
            </select>
          </>
        ) : null}

        <button type="button" onClick={add} className="rounded bg-[var(--rf-bg)] px-2 py-1">
          Add column
        </button>
      </div>
    </div>
  );
}

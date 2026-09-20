'use server';

import { revalidatePath } from 'next/cache';
import { isAppError } from '@/domain/errors';
import type { RqlDiagnostic } from '@/domain/ryql';
import {
  deleteSavedSearchUseCase,
  saveSearchUseCase,
  searchUseCase,
  type SearchFailure,
} from '@/server/usecases/search';

export type SearchResponse =
  | {
      ok: true;
      rows: Array<{ key: string; title: string; status: string; id: string }>;
      total: number;
      warnings: RqlDiagnostic[];
      reading: string;
      injected: string[];
    }
  | SearchFailure;

export async function runSearchAction(
  spaceKey: string,
  query: string,
  options: { crossSpace?: boolean; limit?: number; offset?: number } = {},
): Promise<SearchResponse> {
  const result = await searchUseCase({ spaceKey, query, ...options });
  if (!result.ok) return result;

  return {
    ok: true,
    rows: result.rows.map((row) => ({ id: row.id, key: row.key, title: row.title, status: row.status })),
    total: result.total,
    warnings: result.warnings,
    reading: result.reading,
    injected: result.injected,
  };
}

/** "Select all matching this query", not just the visible page. */
export async function selectAllMatchingAction(
  spaceKey: string,
  query: string,
  options: { crossSpace?: boolean } = {},
): Promise<{ keys: string[] } | { error: string }> {
  const result = await searchUseCase({ spaceKey, query, ...options, limit: 600, offset: 0 });
  if (!result.ok) return { error: result.errors[0]?.message ?? 'That query is not valid.' };
  return { keys: result.rows.map((row) => row.key) };
}

export type SaveState = { message: string | null; error: string | null };

export async function saveSearchAction(
  spaceKey: string,
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  try {
    const saved = await saveSearchUseCase({
      spaceKey,
      name: formData.get('name'),
      query: formData.get('query'),
      visibility: String(formData.get('visibility') ?? 'space'),
    });
    revalidatePath(`/s/${spaceKey}/search`);
    return { message: `Saved "${saved.name}".`, error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

export async function deleteSavedSearchAction(spaceKey: string, formData: FormData): Promise<void> {
  await deleteSavedSearchUseCase(spaceKey, String(formData.get('id') ?? ''));
  revalidatePath(`/s/${spaceKey}/search`);
}

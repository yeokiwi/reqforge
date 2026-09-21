'use server';

import { isAppError } from '@/domain/errors';
import { findRequirementsUseCase, type RequirementCandidate } from '@/server/usecases/requirement-picker';

/** Backs the editor's "+ Link" typeahead (spec 03 §6). */
export async function findRequirementsAction(
  spaceKey: string,
  term: string,
): Promise<RequirementCandidate[] | { error: string }> {
  try {
    return await findRequirementsUseCase(spaceKey, term);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

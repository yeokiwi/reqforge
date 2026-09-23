import { isAppError } from '@/domain/errors';
import type { FormState } from './action-form';

/** Runs a use case for a form action, turning a typed refusal into the form's error line. */
export async function runAction(work: () => Promise<string>): Promise<FormState> {
  try {
    return { message: await work(), error: null };
  } catch (error) {
    if (isAppError(error)) return { message: null, error: error.message };
    throw error;
  }
}

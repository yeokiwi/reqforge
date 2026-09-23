'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import {
  createLevelUseCase,
  deleteLevelUseCase,
  renameLevelUseCase,
  reorderLevelsUseCase,
} from '@/server/usecases/classification';

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export async function createLevelAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const level = await createLevelUseCase(text(formData, 'name'));
    revalidatePath('/admin/classifications');
    return `Added ${level.name} as the most restrictive label.`;
  });
}

export async function renameLevelAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await renameLevelUseCase(text(formData, 'id'), text(formData, 'name'));
    revalidatePath('/admin/classifications');
    return 'Renamed.';
  });
}

export async function deleteLevelAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await deleteLevelUseCase(text(formData, 'id'));
    revalidatePath('/admin/classifications');
    return 'Deleted.';
  });
}

/** Moves one label a step up or down the order; the order is what "highest" means. */
export async function moveLevelAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const order = text(formData, 'order').split(',').filter((id) => id.length > 0);
    const id = text(formData, 'id');
    const index = order.indexOf(id);
    const target = index + (text(formData, 'direction') === 'up' ? 1 : -1);
    if (index < 0 || target < 0 || target >= order.length) return 'Already at the end.';
    [order[index], order[target]] = [order[target]!, order[index]!];
    await reorderLevelsUseCase(order);
    revalidatePath('/admin/classifications');
    return 'Moved.';
  });
}

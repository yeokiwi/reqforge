'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/app/_components/action-form';
import { runAction } from '@/app/_components/run-action';
import {
  addGroupMemberUseCase,
  createGroupUseCase,
  deleteGroupUseCase,
  removeGroupMemberUseCase,
} from '@/server/usecases/groups';

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export async function createGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    const group = await createGroupUseCase(text(formData, 'name'));
    revalidatePath('/admin/groups');
    return `Created ${group.name}.`;
  });
}

export async function deleteGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await deleteGroupUseCase(text(formData, 'groupId'));
    revalidatePath('/admin/groups');
    return 'Deleted.';
  });
}

export async function addMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await addGroupMemberUseCase(text(formData, 'groupId'), text(formData, 'email'));
    revalidatePath('/admin/groups');
    return 'Added.';
  });
}

export async function removeMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await removeGroupMemberUseCase(text(formData, 'groupId'), text(formData, 'userId'));
    revalidatePath('/admin/groups');
    return 'Removed.';
  });
}

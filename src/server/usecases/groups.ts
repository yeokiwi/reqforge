import { NotFoundError, ValidationError } from '@/domain/errors';
import { requireInstanceAdmin } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  findGroup,
  listGroups,
  removeGroupMember,
} from '@/server/repositories/groups';
import { findUserByEmail } from '@/server/repositories/memberships';

/**
 * Groups are instance-wide, like the people in them, so instance administrators manage
 * them (RD-061). Membership of a group changes what every space and every restricted
 * document admits, so every change is audited (spec 07 §6).
 */

const WHAT = 'manage groups';

async function audit(actorId: string, groupId: string, operation: string, parameters: Record<string, string>) {
  await recordAuditEvent({ actorId, spaceId: null, objectType: 'Group', objectId: groupId, operation, parameters });
}

export async function listGroupsUseCase() {
  await requireInstanceAdmin(WHAT);
  return listGroups();
}

export async function createGroupUseCase(rawName: unknown) {
  const user = await requireInstanceAdmin(WHAT);
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 1 || name.length > 80) throw new ValidationError('A group name is 1–80 characters.');
  const group = await createGroup(name);
  await audit(user.id, group.id, 'create', { name });
  return group;
}

export async function deleteGroupUseCase(groupId: string) {
  const user = await requireInstanceAdmin(WHAT);
  const group = await findGroup(groupId);
  if (!group) throw new NotFoundError('That group no longer exists.');
  await deleteGroup(groupId);
  await audit(user.id, groupId, 'delete', { name: group.name });
}

export async function addGroupMemberUseCase(groupId: string, email: unknown) {
  const user = await requireInstanceAdmin(WHAT);
  const group = await findGroup(groupId);
  if (!group) throw new NotFoundError('That group no longer exists.');
  const member = typeof email === 'string' ? await findUserByEmail(email) : null;
  if (!member) throw new NotFoundError('No user has that email address.');
  await addGroupMember(groupId, member.id);
  await audit(user.id, groupId, 'member-add', { group: group.name, member: member.email });
}

export async function removeGroupMemberUseCase(groupId: string, userId: string) {
  const user = await requireInstanceAdmin(WHAT);
  const group = await findGroup(groupId);
  if (!group) throw new NotFoundError('That group no longer exists.');
  await removeGroupMember(groupId, userId);
  await audit(user.id, groupId, 'member-remove', { group: group.name, member: userId });
}

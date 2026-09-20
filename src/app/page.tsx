import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';

export default async function HomePage() {
  const user = await currentUser();
  redirect(user ? '/spaces' : '/login');
}

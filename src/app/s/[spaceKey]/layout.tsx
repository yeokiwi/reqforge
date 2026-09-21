import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopBar } from '@/app/_components/chrome';
import { AuthenticationError, NotFoundError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { notFound } from 'next/navigation';

export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ spaceKey: string }>;
}) {
  const { spaceKey } = await params;

  let context;
  try {
    context = await requireSpace(spaceKey);
  } catch (error) {
    if (error instanceof AuthenticationError) redirect('/login');
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const nav = [
    { href: `/s/${spaceKey}`, label: 'Overview' },
    { href: `/s/${spaceKey}/documents`, label: 'Documents' },
    { href: `/s/${spaceKey}/search`, label: 'Search' },
    { href: `/s/${spaceKey}/traceability`, label: 'Traceability' },
    { href: `/s/${spaceKey}/dependencies`, label: 'Dependencies' },
    { href: `/s/${spaceKey}/coverage`, label: 'Coverage' },
    { href: `/s/${spaceKey}/links`, label: 'Broken links' },
    { href: `/s/${spaceKey}/admin/keys`, label: 'Keys' },
  ];

  // Instance-wide, so it is not part of the space nav proper (RD-036).
  const instanceNav = context.user.isAdmin ? [{ href: '/admin/properties', label: 'External properties' }] : [];

  return (
    <>
      <TopBar userName={context.user.name}>
        <nav className="flex items-center gap-4 text-sm">
          <span className="rounded bg-[var(--rf-bg)] px-2 py-0.5 font-mono text-xs">{context.space.key}</span>
          {[...nav, ...instanceNav].map((item) => (
            <Link key={item.href} href={item.href} className="text-[var(--rf-muted)] hover:text-[var(--rf-ink)]">
              {item.label}
            </Link>
          ))}
        </nav>
      </TopBar>
      {children}
    </>
  );
}

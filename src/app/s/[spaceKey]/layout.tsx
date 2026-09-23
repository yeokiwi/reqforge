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
    { href: `/s/${spaceKey}/baselines`, label: 'Baselines' },
    { href: `/s/${spaceKey}/diff`, label: 'Diff' },
    { href: `/s/${spaceKey}/admin/types`, label: 'Types' },
    { href: `/s/${spaceKey}/admin/keys`, label: 'Keys' },
    // "Change log", not "History": a document has its own version history, and two links
    // called History on one page is a genuine ambiguity, not just a test collision.
    { href: `/s/${spaceKey}/admin/history`, label: 'Change log' },
    // spec 07 §2.1, §6 — the space administrator's screens, shown only to them (RD-058,
    // RD-061, RD-062).
    ...(context.can('ADMIN')
      ? [
          { href: `/s/${spaceKey}/admin/permissions`, label: 'Permissions' },
          { href: `/s/${spaceKey}/admin/restrictions`, label: 'Restricted' },
          { href: `/s/${spaceKey}/admin/audit`, label: 'Audit log' },
          { href: `/s/${spaceKey}/admin/webhooks`, label: 'Webhooks' },
        ]
      : []),
  ];

  // Instance-wide, so it is not part of the space nav proper (RD-036, RD-060, RD-061).
  const instanceNav = context.user.isAdmin
    ? [
        { href: '/admin/properties', label: 'External properties' },
        { href: '/admin/groups', label: 'Groups' },
        { href: '/admin/classifications', label: 'Labels' },
      ]
    : [];

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

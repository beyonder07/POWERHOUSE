'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandLogo, ThemeToggle, useThemeState } from './chrome';
import { clearSession } from '../lib/auth';

type RoleType = 'client' | 'trainer' | 'owner';

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
};

const roleMeta: Record<RoleType, { eyebrow: string; title: string; description: string; accentClass: string; items: NavItem[] }> = {
  client: {
    eyebrow: 'Client App',
    title: 'Your fitness app',
    description: 'Simple, personal, and focused on your own progress.',
    accentClass: 'client-theme',
    items: [
      { href: '/client', label: 'Overview', shortLabel: 'Home' },
      { href: '/client/profile', label: 'Profile', shortLabel: 'Profile' },
      { href: '/client/attendance', label: 'Attendance', shortLabel: 'Visits' },
      { href: '/client/payments', label: 'Payments', shortLabel: 'Pay' },
      { href: '/client/membership', label: 'Membership', shortLabel: 'Plan' },
      { href: '/client/workout', label: 'Workout', shortLabel: 'Workout' }
    ]
  },
  trainer: {
    eyebrow: 'Trainer Workspace',
    title: 'Operational trainer app',
    description: 'Fast access to your members, workout flows, attendance, and requests.',
    accentClass: 'trainer-theme',
    items: [
      { href: '/trainer', label: 'Overview', shortLabel: 'Home' },
      { href: '/trainer/profile', label: 'Profile', shortLabel: 'Profile' },
      { href: '/trainer/members', label: 'Assigned Members', shortLabel: 'Members' },
      { href: '/trainer/workouts', label: 'Workout Plans', shortLabel: 'Plans' },
      { href: '/trainer/attendance', label: 'Attendance', shortLabel: 'Visits' },
      { href: '/trainer/salary', label: 'Salary', shortLabel: 'Salary' },
      { href: '/trainer/requests', label: 'Requests', shortLabel: 'Reqs' }
    ]
  },
  owner: {
    eyebrow: 'Owner Control',
    title: 'PowerHouse command center',
    description: 'Analytics, approvals, finances, staff, and full operational control.',
    accentClass: 'owner-theme',
    items: [
      { href: '/owner', label: 'Overview', shortLabel: 'Home' },
      { href: '/owner/analytics', label: 'Analytics', shortLabel: 'Trends' },
      { href: '/owner/members', label: 'Members', shortLabel: 'Members' },
      { href: '/owner/trainers', label: 'Trainers', shortLabel: 'Trainers' },
      { href: '/owner/payments', label: 'Payments', shortLabel: 'Money' },
      { href: '/owner/attendance', label: 'Attendance', shortLabel: 'Visits' },
      { href: '/owner/requests', label: 'Requests', shortLabel: 'Reqs' }
    ]
  }
};

function isItemActive(pathname: string, href: string) {
  if (href === pathname) {
    return true;
  }

  return href !== '/' && pathname.startsWith(`${href}/`);
}

export function RoleAppShell({ role, children }: { role: RoleType; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useThemeState();
  const meta = roleMeta[role];
  const activeItem = meta.items.find((item) => isItemActive(pathname, item.href)) || meta.items[0];
  const handleLogout = () => {
    clearSession();
    router.replace('/');
  };

  return (
    <div className={`app-shell ${meta.accentClass}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <BrandLogo />
          <div>
            <p className="eyebrow">{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p className="subcopy">{meta.description}</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label={`${role} navigation`}>
          {meta.items.map((item) => {
            const active = isItemActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`nav-link ${active ? 'active' : ''}`}>
                <span className="nav-link-label">{item.label}</span>
                <span className="nav-link-pill">{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button type="button" className="ghost-button" onClick={handleLogout}>Logout</button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="header-brand">
            <BrandLogo />
            <div>
              <p className="eyebrow">{meta.eyebrow}</p>
              <h2>{activeItem.label}</h2>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-role-chip">{role.toUpperCase()}</div>
          </div>
        </header>

        <div className="page-scroll-area">{children}</div>
      </div>

      <div className="mobile-footer-shell">
        <div className="mobile-action-row">
          <ThemeToggle theme={theme} onToggle={toggleTheme} compact />
          <button type="button" className="ghost-button compact-header-button" onClick={handleLogout}>Logout</button>
        </div>
        <nav className="mobile-nav" aria-label={`${role} mobile navigation`}>
          <div className="mobile-nav-scroll">
            {meta.items.map((item) => {
              const active = isItemActive(pathname, item.href);
              return (
                <Link key={item.href} href={item.href} className={`mobile-nav-link ${active ? 'active' : ''}`}>
                  <span className="mobile-dot" aria-hidden="true" />
                  <span>{item.shortLabel}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

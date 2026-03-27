import { RoleAppShell } from '../../components/role-shell';

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <RoleAppShell role="owner">{children}</RoleAppShell>;
}

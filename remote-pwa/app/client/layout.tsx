import { RoleAppShell } from '../../components/role-shell';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <RoleAppShell role="client">{children}</RoleAppShell>;
}

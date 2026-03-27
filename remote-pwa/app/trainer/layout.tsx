import { RoleAppShell } from '../../components/role-shell';

export default function TrainerLayout({ children }: { children: React.ReactNode }) {
  return <RoleAppShell role="trainer">{children}</RoleAppShell>;
}

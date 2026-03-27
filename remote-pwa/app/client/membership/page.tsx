'use client';

import { LoadingState, Notice, PageIntro, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { formatDate } from '../../../lib/formatters';
import type { ViewerRole } from '../../../lib/auth';

const CLIENT_ROLES: ViewerRole[] = ['client'];

type ClientMembershipPayload = {
  membership: { planType: string; startDate: string; expiryDate: string; status: string; daysRemaining: number } | null;
};

export default function ClientMembershipPage() {
  const { data, loading, error } = useAuthedPageData<ClientMembershipPayload>('/api/data/client/membership', CLIENT_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading membership details" text="Preparing your current plan and renewal snapshot." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Membership" title="Your plan" description="Everything you need about your active membership in one calm view." />
      <SurfaceCard title={data.membership?.planType || 'No active plan'}>
        {data.membership ? (
          <div className="detail-list membership-detail-list">
            <div><span>Status</span><StatusPill label={data.membership.status} tone={data.membership.status === 'active' ? 'success' : 'warning'} /></div>
            <div><span>Start date</span><strong>{formatDate(data.membership.startDate)}</strong></div>
            <div><span>Expiry date</span><strong>{formatDate(data.membership.expiryDate)}</strong></div>
            <div className="highlight-detail"><span>Days remaining</span><strong>{data.membership.daysRemaining}</strong></div>
          </div>
        ) : (
          <p className="subcopy">No membership data is synced for this account yet.</p>
        )}
      </SurfaceCard>
    </main>
  );
}

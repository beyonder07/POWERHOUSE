'use client';

import { LoadingState, MetricGrid, Notice, PageIntro, StatusPill, SurfaceCard } from '../../components/app-ui';
import { useAuthedPageData } from '../../lib/app-client';
import { currency, formatDate, formatDateTime } from '../../lib/formatters';
import type { ViewerRole } from '../../lib/auth';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerOverview = {
  analytics: { revenueToday: number; revenueMonth: number; totalMembers: number; activeMembers: number; trainerCount: number } | null;
  sync: { generatedAt: string | null; pendingRequests: number };
  expiringMembers: Array<{ id: number; name: string; expiryDate: string; status: string }>;
  recentPayments: Array<{ id: number; memberName?: string; amount: number; date: string; paymentMode: string }>;
  pendingApprovals: Array<{ _id: string; type: string; createdAt: string; createdByRole: string }>;
};

export default function OwnerOverviewPage() {
  const { data, loading, error } = useAuthedPageData<OwnerOverview>('/api/data/owner/overview', OWNER_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading owner control center" text="Gathering snapshot metrics, pending approvals, and time-sensitive alerts." />;
  }

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro
        eyebrow="Owner Overview"
        title="PowerHouse command center"
        description="A high-level overview of revenue, active members, approvals, and sync health."
        actions={<StatusPill label={data.sync.generatedAt ? `Synced ${formatDateTime(data.sync.generatedAt)}` : 'Awaiting sync'} tone={data.sync.generatedAt ? 'success' : 'warning'} />}
      />

      <MetricGrid
        items={[
          { label: 'Revenue Today', value: currency(data.analytics?.revenueToday || 0), tone: 'success' },
          { label: 'Revenue Month', value: currency(data.analytics?.revenueMonth || 0) },
          { label: 'Total Members', value: String(data.analytics?.totalMembers || 0) },
          { label: 'Active Members', value: String(data.analytics?.activeMembers || 0) },
          { label: 'Trainers', value: String(data.analytics?.trainerCount || 0) },
          { label: 'Pending Requests', value: String(data.sync.pendingRequests), tone: 'warning' }
        ]}
      />

      <section className="content-grid three-col">
        <SurfaceCard eyebrow="Attention" title="Expiring members">
          <div className="timeline-list dense">
            {data.expiringMembers.map((member) => (
              <div key={member.id} className="timeline-item">
                <strong>{member.name}</strong>
                <span>{formatDate(member.expiryDate)}</span>
                <StatusPill label={member.status || 'unknown'} tone={member.status === 'active' ? 'success' : 'warning'} />
              </div>
            ))}
            {data.expiringMembers.length === 0 ? <p className="subcopy">No urgent membership expiries right now.</p> : null}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Cashflow" title="Recent payments">
          <div className="timeline-list dense">
            {data.recentPayments.map((payment) => (
              <div key={payment.id} className="timeline-item">
                <strong>{currency(payment.amount)}</strong>
                <span>{payment.paymentMode}</span>
                <span>{formatDate(payment.date)}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Approvals" title="Pending workflow">
          <div className="timeline-list dense">
            {data.pendingApprovals.map((request) => (
              <div key={request._id} className="timeline-item">
                <strong>{request.type}</strong>
                <span>{request.createdByRole}</span>
                <span>{formatDateTime(request.createdAt)}</span>
              </div>
            ))}
            {data.pendingApprovals.length === 0 ? <p className="subcopy">Nothing is waiting for approval.</p> : null}
          </div>
        </SurfaceCard>
      </section>
    </main>
  );
}

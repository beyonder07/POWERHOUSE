'use client';

import { LoadingState, MetricGrid, Notice, PageIntro, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { currency } from '../../../lib/formatters';
import type { ViewerRole } from '../../../lib/auth';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerAnalyticsPayload = {
  analytics: { revenueToday: number; revenueMonth: number; totalMembers: number; activeMembers: number; trainerCount: number } | null;
  revenueTrend: Array<{ label: string; value: number }>;
  memberTrend: Array<{ label: string; value: number }>;
};

export default function OwnerAnalyticsPage() {
  const { data, loading, error } = useAuthedPageData<OwnerAnalyticsPayload>('/api/data/owner/analytics', OWNER_ROLES);
  const maxRevenue = Math.max(...(data?.revenueTrend || []).map((item) => item.value), 1);
  const maxMembers = Math.max(...(data?.memberTrend || []).map((item) => item.value), 1);

  if (loading || !data) {
    return <LoadingState title="Loading analytics" text="Building revenue and member growth trends for the owner view." />;
  }

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Analytics" title="Business trends" description="Revenue and growth are split out here so the owner dashboard stays focused and uncluttered." />
      <MetricGrid items={[
        { label: 'Revenue Today', value: currency(data.analytics?.revenueToday || 0), tone: 'success' },
        { label: 'Revenue Month', value: currency(data.analytics?.revenueMonth || 0) },
        { label: 'Active Members', value: String(data.analytics?.activeMembers || 0) }
      ]} />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="Revenue" title="Last 6 months">
          <div className="chart-list">
            {data.revenueTrend.map((item) => (
              <div key={item.label} className="chart-row">
                <span>{item.label}</span>
                <div className="chart-bar"><i style={{ width: `${(item.value / maxRevenue) * 100}%` }} /></div>
                <strong>{currency(item.value)}</strong>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Member growth" title="Join trend">
          <div className="chart-list">
            {data.memberTrend.map((item) => (
              <div key={item.label} className="chart-row">
                <span>{item.label}</span>
                <div className="chart-bar"><i style={{ width: `${(item.value / maxMembers) * 100}%` }} /></div>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>
    </main>
  );
}

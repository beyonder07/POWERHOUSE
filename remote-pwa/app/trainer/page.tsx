'use client';

import { LoadingState, MetricGrid, Notice, PageIntro, StatusPill, SurfaceCard } from '../../components/app-ui';
import { useAuthedPageData } from '../../lib/app-client';
import { currency } from '../../lib/formatters';
import type { ViewerRole } from '../../lib/auth';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerOverview = {
  profile: { name: string };
  metrics: { assignedMembers: number; pendingRequests: number; todayMemberCheckIns: number; monthAttendance: number };
  salarySnapshot: { month: string; amount: number; status: 'paid' | 'pending' };
  todayCheckIns: Array<{ id: number; memberName: string; date: string; status: string; checkInTime: string }>;
};

export default function TrainerOverviewPage() {
  const { data, loading, error } = useAuthedPageData<TrainerOverview>('/api/data/trainer/overview', TRAINER_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading trainer workspace" text="Preparing your daily workload and salary snapshot." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro
        eyebrow="Trainer Overview"
        title={`Welcome, ${data.profile.name}`}
        description="A restricted workspace centered on assigned members, requests, and your own attendance."
        actions={<StatusPill label={data.salarySnapshot.status} tone={data.salarySnapshot.status === 'paid' ? 'success' : 'warning'} />}
      />

      <MetricGrid
        items={[
          { label: 'Assigned Members', value: String(data.metrics.assignedMembers) },
          { label: 'Pending Requests', value: String(data.metrics.pendingRequests), tone: 'warning' },
          { label: 'Today Check-ins', value: String(data.metrics.todayMemberCheckIns), tone: 'success' },
          { label: 'This Month Salary', value: currency(data.salarySnapshot.amount) }
        ]}
      />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="Today" title="Recent member activity">
          <div className="timeline-list">
            {data.todayCheckIns.map((item) => (
              <div key={item.id} className="timeline-item">
                <strong>{item.memberName}</strong>
                <span>{item.status}</span>
                <span>{item.checkInTime || item.date}</span>
              </div>
            ))}
            {data.todayCheckIns.length === 0 ? <p className="subcopy">No assigned-member activity recorded today.</p> : null}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Salary" title="Current snapshot">
          <div className="detail-list compact">
            <div><span>Month</span><strong>{data.salarySnapshot.month}</strong></div>
            <div><span>Amount</span><strong>{currency(data.salarySnapshot.amount)}</strong></div>
            <div><span>Status</span><strong>{data.salarySnapshot.status}</strong></div>
          </div>
        </SurfaceCard>
      </section>
    </main>
  );
}

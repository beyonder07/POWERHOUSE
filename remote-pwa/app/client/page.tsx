'use client';

import Link from 'next/link';
import { LoadingState, MetricGrid, Notice, PageIntro, SurfaceCard, StatusPill } from '../../components/app-ui';
import { useAuthedPageData } from '../../lib/app-client';
import { currency, formatDate } from '../../lib/formatters';
import type { ViewerRole } from '../../lib/auth';

const CLIENT_ROLES: ViewerRole[] = ['client'];

type ClientOverview = {
  profile: { name: string };
  membership: { planType: string; expiryDate: string; daysRemaining: number; status: string } | null;
  attendanceSummary: { month: string; presentCount: number; totalRecorded: number };
  latestPayment: { amount: number; date: string; paymentMode: string; status: string } | null;
  workoutPlan: { name?: string; exercises?: string[] } | null;
  assignedTrainer: { name: string } | null;
};

export default function ClientOverviewPage() {
  const { data, loading, error } = useAuthedPageData<ClientOverview>('/api/data/client/overview', CLIENT_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading your personal hub" text="Preparing your membership, visits, and workout snapshots." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro
        eyebrow="Client Overview"
        title={`Welcome back, ${data.profile.name}`}
        description="A simple snapshot of your membership, attendance, workout plan, and last payment."
        actions={<StatusPill label={data.membership?.status || 'inactive'} tone={data.membership?.status === 'active' ? 'success' : 'warning'} />}
      />

      <MetricGrid
        items={[
          { label: 'Days Remaining', value: String(data.membership?.daysRemaining ?? 0), tone: data.membership?.daysRemaining && data.membership.daysRemaining <= 7 ? 'warning' : 'default' },
          { label: 'Visits This Month', value: String(data.attendanceSummary.presentCount), tone: 'success' },
          { label: 'Last Payment', value: data.latestPayment ? currency(data.latestPayment.amount) : '-' }
        ]}
      />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="Membership" title="Current plan">
          <div className="detail-list compact">
            <div><span>Plan</span><strong>{data.membership?.planType || 'Not assigned'}</strong></div>
            <div><span>Expiry</span><strong>{formatDate(data.membership?.expiryDate)}</strong></div>
            <div><span>Trainer</span><strong>{data.assignedTrainer?.name || 'Not assigned'}</strong></div>
          </div>
          <Link href="/client/membership" className="text-link">Open membership details</Link>
        </SurfaceCard>

        <SurfaceCard eyebrow="Workout" title="Today�s focus">
          <div className="workout-preview">
            <strong>{data.workoutPlan?.name || 'No plan assigned yet'}</strong>
            <ul className="simple-list">
              {(data.workoutPlan?.exercises || []).slice(0, 4).map((exercise) => <li key={exercise}>{exercise}</li>)}
              {!(data.workoutPlan?.exercises || []).length ? <li>Check back after your trainer assigns your routine.</li> : null}
            </ul>
          </div>
          <Link href="/client/workout" className="text-link">View workout plan</Link>
        </SurfaceCard>

        <SurfaceCard eyebrow="Payments" title="Latest payment">
          <div className="detail-list compact">
            <div><span>Amount</span><strong>{data.latestPayment ? currency(data.latestPayment.amount) : '-'}</strong></div>
            <div><span>Mode</span><strong>{data.latestPayment?.paymentMode || '-'}</strong></div>
            <div><span>Date</span><strong>{formatDate(data.latestPayment?.date)}</strong></div>
          </div>
          <Link href="/client/payments" className="text-link">Open payment history</Link>
        </SurfaceCard>

        <SurfaceCard eyebrow="Attendance" title="This month">
          <div className="detail-list compact">
            <div><span>Month</span><strong>{data.attendanceSummary.month}</strong></div>
            <div><span>Present</span><strong>{data.attendanceSummary.presentCount}</strong></div>
            <div><span>Recorded Days</span><strong>{data.attendanceSummary.totalRecorded}</strong></div>
          </div>
          <Link href="/client/attendance" className="text-link">Open attendance calendar</Link>
        </SurfaceCard>
      </section>
    </main>
  );
}

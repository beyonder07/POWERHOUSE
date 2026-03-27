'use client';

import { LoadingState, MetricGrid, Notice, PageIntro, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { currency } from '../../../lib/formatters';
import type { ViewerRole } from '../../../lib/auth';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerSalaryPayload = {
  currentMonth: string;
  currentAmount: number;
  items: Array<{ month: string; amount: number; status: 'paid' | 'pending' }>;
};

export default function TrainerSalaryPage() {
  const { data, loading, error } = useAuthedPageData<TrainerSalaryPayload>('/api/data/trainer/salary', TRAINER_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading salary log" text="Preparing your payout history and current month summary." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Salary" title="Salary log" description="A clear monthly history of your calculated pay, with status kept simple." />
      <MetricGrid items={[{ label: 'Current Month', value: data.currentMonth }, { label: 'Current Amount', value: currency(data.currentAmount), tone: 'success' }]} />
      <SurfaceCard title="Monthly payouts">
        <div className="timeline-list">
          {data.items.map((item) => (
            <div key={`${item.month}-${item.status}`} className="timeline-item">
              <strong>{item.month}</strong>
              <span>{currency(item.amount)}</span>
              <StatusPill label={item.status} tone={item.status === 'paid' ? 'success' : 'warning'} />
            </div>
          ))}
        </div>
      </SurfaceCard>
    </main>
  );
}

'use client';

import { LoadingState, MetricGrid, Notice, PageIntro, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { currency, formatDate } from '../../../lib/formatters';
import type { ViewerRole } from '../../../lib/auth';

const CLIENT_ROLES: ViewerRole[] = ['client'];

type ClientPaymentsPayload = {
  items: Array<{ id: number; amount: number; lateFee?: number; paymentMode: string; date: string; status: string }>;
  totalPaid: number;
};

export default function ClientPaymentsPage() {
  const { data, loading, error } = useAuthedPageData<ClientPaymentsPayload>('/api/data/client/payments', CLIENT_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading payment history" text="Collecting your payment records and totals." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Payments" title="Your payment history" description="A clean history of what you have paid, when you paid, and which mode was used." />
      <MetricGrid items={[{ label: 'Payments Recorded', value: String(data.items.length) }, { label: 'Total Paid', value: currency(data.totalPaid), tone: 'success' }]} />

      <SurfaceCard title="All payments">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Amount</th><th>Mode</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.date)}</td>
                  <td>{currency(item.amount)}</td>
                  <td>{item.paymentMode || '-'}</td>
                  <td><StatusPill label={item.status || 'paid'} tone={item.status === 'paid' ? 'success' : 'warning'} /></td>
                </tr>
              ))}
              {data.items.length === 0 ? <tr><td colSpan={4} className="empty-cell">No payments synced yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </main>
  );
}

'use client';

import { GridToolbar, LoadingState, MetricGrid, Notice, PageIntro, PaginationControls, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { currency, formatDate } from '../../../lib/formatters';
import { useGridQuery } from '../../../lib/grid';
import type { ViewerRole } from '../../../lib/auth';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerPaymentsPayload = {
  items: Array<{ id: number; memberName: string; amount: number; paymentMode: string; date: string; status: string }>;
  totalsByMode: Array<{ mode: string; total: number }>;
  totalCollected: number;
};

export default function OwnerPaymentsPage() {
  const { data, loading, error } = useAuthedPageData<OwnerPaymentsPayload>('/api/data/owner/payments', OWNER_ROLES);
  const items = data?.items || [];
  const grid = useGridQuery({
    items,
    pageSize: 10,
    predicate: (item, query) => [
      item.memberName,
      item.paymentMode,
      item.status,
      item.date,
      String(item.amount)
    ].some((value) => String(value || '').toLowerCase().includes(query))
  });

  if (loading || !data) {
    return <LoadingState title="Loading payments" text="Bringing in cashflow totals and full payment logs." />;
  }

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Payments" title="Financial system" description="Revenue data is isolated here so the owner can review finance without cluttering other views." />
      <MetricGrid items={[{ label: 'Total Collected', value: currency(data.totalCollected), tone: 'success' }, { label: 'Transactions', value: String(data.items.length) }]} />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="By mode" title="Collection split">
          <div className="timeline-list dense">
            {data.totalsByMode.map((item) => (
              <div key={item.mode} className="timeline-item">
                <strong>{item.mode}</strong>
                <span>{currency(item.total)}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Payment log">
          <GridToolbar
            query={grid.query}
            onQueryChange={grid.setQuery}
            placeholder="Search by member, mode, amount, date, or status"
            filteredCount={grid.filteredCount}
            totalCount={grid.totalItems}
            page={grid.page}
            totalPages={grid.totalPages}
            pageSize={10}
            label="payments"
          />
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Member</th><th>Amount</th><th>Mode</th><th>Status</th></tr>
              </thead>
              <tbody>
                {grid.pageItems.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.date)}</td>
                    <td>{item.memberName || '-'}</td>
                    <td>{currency(item.amount)}</td>
                    <td>{item.paymentMode || '-'}</td>
                    <td><StatusPill label={item.status || 'paid'} tone={item.status === 'paid' ? 'success' : 'warning'} /></td>
                  </tr>
                ))}
                {grid.pageItems.length === 0 ? <tr><td colSpan={5} className="empty-cell">No payments match this search.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <PaginationControls page={grid.page} totalPages={grid.totalPages} onPageChange={grid.setPage} />
        </SurfaceCard>
      </section>
    </main>
  );
}

'use client';

import { Avatar, EmptyState, GridToolbar, LoadingState, Notice, PageIntro, PaginationControls, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { currency } from '../../../lib/formatters';
import { useGridQuery } from '../../../lib/grid';
import type { ViewerRole } from '../../../lib/auth';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerTrainersPayload = {
  items: Array<{
    id: number;
    name: string;
    phone: string;
    email: string;
    governmentId: string;
    governmentIdVerified: boolean;
    profilePhotoUrl: string;
    baseSalary: number;
    status: string;
    salaryLog: Array<{ month: string; amount: number; status: string }>;
    attendance: Array<{ id: number }>;
  }>;
};

export default function OwnerTrainersPage() {
  const { data, loading, error } = useAuthedPageData<OwnerTrainersPayload>('/api/data/owner/trainers', OWNER_ROLES);
  const items = data?.items || [];
  const grid = useGridQuery({
    items,
    pageSize: 6,
    predicate: (trainer, query) => [
      trainer.name,
      trainer.phone,
      trainer.email,
      trainer.governmentId,
      trainer.status,
      String(trainer.baseSalary)
    ].some((value) => String(value || '').toLowerCase().includes(query))
  });

  if (loading || !data) {
    return <LoadingState title="Loading trainers" text="Preparing trainer records, salary logs, and staff activity." />;
  }

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Trainers" title="Trainer management" description="Owner-only view of trainer identity, salary base, and attendance performance." />
      <GridToolbar
        query={grid.query}
        onQueryChange={grid.setQuery}
        placeholder="Search by name, phone, email, status, or salary"
        filteredCount={grid.filteredCount}
        totalCount={grid.totalItems}
        page={grid.page}
        totalPages={grid.totalPages}
        pageSize={6}
        label="trainers"
      />
      <section className="card-grid owner-card-grid">
        {grid.pageItems.map((trainer) => (
          <SurfaceCard key={trainer.id} title={trainer.name} className="owner-record-card">
            <div className="profile-hero-card compact-profile-card">
              <Avatar name={trainer.name} src={trainer.profilePhotoUrl} compact />
              <div>
                <StatusPill label={trainer.status || 'unknown'} tone={trainer.status === 'active' ? 'success' : 'warning'} />
                <p className="subcopy">Base salary {currency(trainer.baseSalary)}</p>
              </div>
            </div>
            <div className="detail-list compact">
              <div><span>Phone</span><strong>{trainer.phone || '-'}</strong></div>
              <div><span>Email</span><strong>{trainer.email || '-'}</strong></div>
              <div><span>Government ID</span><strong>{trainer.governmentId || '-'}</strong></div>
              <div><span>Verified</span><strong>{trainer.governmentIdVerified ? 'Yes' : 'No'}</strong></div>
              <div><span>Attendance rows</span><strong>{trainer.attendance.length}</strong></div>
              <div><span>Latest payout</span><strong>{currency(trainer.salaryLog[0]?.amount || 0)}</strong></div>
            </div>
          </SurfaceCard>
        ))}
        {grid.pageItems.length === 0 ? <EmptyState title="No trainers found" text="Try a different search term to find a trainer record." /> : null}
      </section>
      <PaginationControls page={grid.page} totalPages={grid.totalPages} onPageChange={grid.setPage} />
    </main>
  );
}

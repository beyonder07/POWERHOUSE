'use client';

import { useState } from 'react';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { useAuthedPageData } from '../../../lib/app-client';
import { GridToolbar, LoadingState, Notice, PageIntro, PaginationControls, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { formatDateTime } from '../../../lib/formatters';
import { useGridQuery } from '../../../lib/grid';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerRequestsPayload = {
  items: Array<{ _id: string; type: string; status: string; createdAt: string; createdByRole: string; data: Record<string, unknown>; reviewNote?: string }>;
  pendingCount: number;
};

export default function OwnerRequestsPage() {
  const { data, loading, error, session, logout, reload } = useAuthedPageData<OwnerRequestsPayload>('/api/data/owner/requests', OWNER_ROLES);
  const [status, setStatus] = useState<string | null>(null);
  const items = data?.items || [];
  const grid = useGridQuery({
    items,
    pageSize: 10,
    predicate: (item, query) => [
      item.type,
      item.status,
      item.createdByRole,
      item.createdAt,
      JSON.stringify(item.data || {}),
      item.reviewNote || ''
    ].some((value) => String(value || '').toLowerCase().includes(query))
  });

  if (loading || !data) {
    return <LoadingState title="Loading approval requests" text="Preparing enrollment, workout, and attendance approval items." />;
  }

  const review = async (id: string, nextStatus: 'approved' | 'rejected') => {
    const response = await fetch(`${API_URL}/api/requests/${id}/review`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: nextStatus })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to review request' }));
    if (!response.ok) {
      setStatus(String(json.error || 'Failed to review request'));
      return;
    }

    setStatus(`Request ${nextStatus}.`);
    void reload();
  };

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status.includes('Request') ? 'success' : 'error'} text={status} /> : null}
      <PageIntro eyebrow="Requests" title="Approval queue" description="Nothing executes here without owner approval. This page is the full workflow control point." actions={<StatusPill label={`${data.pendingCount} pending`} tone={data.pendingCount > 0 ? 'warning' : 'success'} />} />

      <SurfaceCard title="All requests">
        <GridToolbar
          query={grid.query}
          onQueryChange={grid.setQuery}
          placeholder="Search by type, role, status, note, or payload"
          filteredCount={grid.filteredCount}
          totalCount={grid.totalItems}
          page={grid.page}
          totalPages={grid.totalPages}
          pageSize={10}
          label="requests"
        />
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Created</th><th>Type</th><th>Role</th><th>Status</th><th>Payload</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {grid.pageItems.map((item) => (
                <tr key={item._id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.type}</td>
                  <td>{item.createdByRole}</td>
                  <td><StatusPill label={item.status} tone={item.status === 'approved' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'} /></td>
                  <td className="details-cell">{JSON.stringify(item.data)}</td>
                  <td className="inline-actions">
                    <button type="button" onClick={() => review(item._id, 'approved')}>Approve</button>
                    <button type="button" className="ghost-button danger-button" onClick={() => review(item._id, 'rejected')}>Reject</button>
                  </td>
                </tr>
              ))}
              {grid.pageItems.length === 0 ? <tr><td colSpan={6} className="empty-cell">No requests match this search.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <PaginationControls page={grid.page} totalPages={grid.totalPages} onPageChange={grid.setPage} />
      </SurfaceCard>
    </main>
  );
}

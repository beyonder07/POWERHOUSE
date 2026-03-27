'use client';

import { useEffect, useState } from 'react';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { authedJson, useAuthedPageData } from '../../../lib/app-client';
import { GridToolbar, LoadingState, Notice, PageIntro, PaginationControls, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { formatDateTime } from '../../../lib/formatters';
import { useGridQuery } from '../../../lib/grid';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerAttendancePayload = {
  items: Array<{ id: number; memberId: number; memberName: string; date: string; checkInTime: string; status: string }>;
  memberOptions: Array<{ id: number; name: string }>;
};

type AttendanceHistoryPayload = {
  records: Array<{ _id: string; member_id: number; date: string; status: 'present' | 'absent' }>;
  audits: Array<{ _id: string; action: string; changed_at: string }>;
};

export default function OwnerAttendancePage() {
  const { data, loading, error, session, logout, setSession } = useAuthedPageData<OwnerAttendancePayload>('/api/data/owner/attendance', OWNER_ROLES);
  const [history, setHistory] = useState<AttendanceHistoryPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: '', date: new Date().toISOString().slice(0, 10), status: 'present' as 'present' | 'absent' });
  const canModify = session.role === 'owner';
  const displayRecords = canModify
    ? (history?.records || [])
    : data?.items.map((item) => ({
        _id: String(item.id),
        member_id: Number(item.memberId),
        date: item.date,
        status: (item.status === 'present' ? 'present' : 'absent') as 'present' | 'absent'
      })) || [];
  const grid = useGridQuery({
    items: displayRecords,
    pageSize: 10,
    predicate: (item, query) => {
      const memberName = data?.memberOptions.find((member) => member.id === Number(item.member_id))?.name || '';
      return [
        memberName,
        item.date,
        item.status,
        String(item.member_id)
      ].some((value) => String(value || '').toLowerCase().includes(query));
    }
  });

  useEffect(() => {
    if (!session.accessToken || !canModify) {
      return;
    }

    const loadHistory = async () => {
      const result = await authedJson<AttendanceHistoryPayload>('/api/attendance/owner/history', session);
      if (!result.ok || !result.session || !result.data) {
        if (result.unauthorized) {
          logout();
        }
        return;
      }

      setSession(result.session);
      setHistory(result.data);
    };

    void loadHistory();
  }, [canModify, logout, session.accessToken, session.refreshToken, setSession]);

  if (loading || !data) {
    return <LoadingState title="Loading attendance controls" text="Preparing member attendance controls and audit history." />;
  }

  const createRecord = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${API_URL}/api/attendance/owner/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ member_id: Number(form.memberId || 0), date: form.date, status: form.status })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to create attendance record' }));
    if (response.ok) {
      setHistory((prev) => prev ? { ...prev, records: [json, ...prev.records] } : { records: [json], audits: [] });
    }
    setStatus(response.ok ? 'Attendance record created.' : String(json.error || 'Failed to create attendance record'));
  };

  const updateRecord = async (id: string, nextStatus: 'present' | 'absent') => {
    const response = await fetch(`${API_URL}/api/attendance/owner/update`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, status: nextStatus })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to update attendance' }));
    if (!response.ok) {
      setStatus(String(json.error || 'Failed to update attendance'));
      return;
    }

    setHistory((prev) => prev ? { ...prev, records: prev.records.map((record) => record._id === id ? json : record) } : prev);
    setStatus('Attendance updated.');
  };

  const deleteRecord = async (id: string) => {
    const response = await fetch(`${API_URL}/api/attendance/owner/delete`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to delete attendance' }));
    if (!response.ok) {
      setStatus(String(json.error || 'Failed to delete attendance'));
      return;
    }

    setHistory((prev) => prev ? { ...prev, records: prev.records.filter((record) => record._id !== json.deletedId) } : prev);
    setStatus('Attendance deleted.');
  };

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status.includes('created') || status.includes('updated') || status.includes('deleted') ? 'success' : 'error'} text={status} /> : null}
      <PageIntro eyebrow="Attendance" title="Attendance control" description="This is the owner-only control page for attendance creation, correction, and audit review." />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="Create" title="Add attendance record">
          {canModify ? (
            <form className="stack-form" onSubmit={createRecord}>
              <label>
                Member
                <select value={form.memberId} onChange={(event) => setForm((prev) => ({ ...prev, memberId: event.target.value }))}>
                  <option value="">Select member</option>
                  {data.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                Date
                <input type="date" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
              </label>
              <label>
                Status
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as 'present' | 'absent' }))}>
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                </select>
              </label>
              <button type="submit">Create record</button>
            </form>
          ) : (
            <p className="subcopy">Attendance changes are reserved for the owner account. Admin users can review the records but cannot modify them.</p>
          )}
        </SurfaceCard>

        <SurfaceCard eyebrow="Audit" title="Recent change history">
          <div className="timeline-list dense">
            {canModify ? (
              (history?.audits || []).map((item) => (
                <div key={item._id} className="timeline-item">
                  <strong>{item.action}</strong>
                  <span>{formatDateTime(item.changed_at)}</span>
                </div>
              ))
            ) : (
              <p className="subcopy">Audit logs are available only to the owner account.</p>
            )}
          </div>
        </SurfaceCard>
      </section>

      <SurfaceCard title="Attendance records">
        <GridToolbar
          query={grid.query}
          onQueryChange={grid.setQuery}
          placeholder="Search by member, date, status, or member ID"
          filteredCount={grid.filteredCount}
          totalCount={grid.totalItems}
          page={grid.page}
          totalPages={grid.totalPages}
          pageSize={10}
          label="attendance records"
        />
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Member</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {grid.pageItems.map((item) => (
                <tr key={item._id}>
                  <td>{item.date}</td>
                  <td>{data.memberOptions.find((member) => member.id === Number(item.member_id))?.name || item.member_id}</td>
                  <td><StatusPill label={item.status} tone={item.status === 'present' ? 'success' : 'warning'} /></td>
                  <td className="inline-actions">
                    {canModify ? (
                      <>
                        <button type="button" onClick={() => updateRecord(item._id, item.status === 'present' ? 'absent' : 'present')}>Toggle</button>
                        <button type="button" className="ghost-button danger-button" onClick={() => deleteRecord(item._id)}>Delete</button>
                      </>
                    ) : (
                      <span className="subcopy">View only</span>
                    )}
                  </td>
                </tr>
              ))}
              {grid.pageItems.length === 0 ? <tr><td colSpan={4} className="empty-cell">No attendance records match this search.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <PaginationControls page={grid.page} totalPages={grid.totalPages} onPageChange={grid.setPage} />
      </SurfaceCard>
    </main>
  );
}

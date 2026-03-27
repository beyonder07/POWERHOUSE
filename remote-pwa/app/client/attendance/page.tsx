'use client';

import { useMemo } from 'react';
import { LoadingState, Notice, PageIntro, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { buildCalendar, formatDateTime } from '../../../lib/formatters';
import type { ViewerRole } from '../../../lib/auth';

const CLIENT_ROLES: ViewerRole[] = ['client'];

type ClientAttendancePayload = {
  calendar: { month: string; entries: Array<{ date: string; status: 'present' | 'absent' }> };
  recent: Array<{ id: number; date: string; checkInTime: string; status: string }>;
};

export default function ClientAttendancePage() {
  const { data, loading, error } = useAuthedPageData<ClientAttendancePayload>('/api/data/client/attendance', CLIENT_ROLES);
  const cells = useMemo(() => data ? buildCalendar(data.calendar.month, data.calendar.entries) : [], [data]);

  if (loading || !data) {
    return <LoadingState title="Loading attendance calendar" text="Preparing your visit timeline for this month." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Attendance" title="Monthly attendance" description="Green days mean you were present. Empty days simply have no recorded visit." />

      <section className="content-grid two-col">
        <SurfaceCard title={data.calendar.month}>
          <div className="calendar-headings">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="calendar-grid">
            {cells.map((cell) => (
              <div key={cell.key} className={`calendar-cell ${cell.status} ${cell.outsideMonth ? 'outside' : ''}`}>
                {cell.label}
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Recent visits" title="Attendance log">
          <div className="timeline-list">
            {data.recent.map((item) => (
              <div key={item.id} className="timeline-item">
                <strong>{item.status}</strong>
                <span>{item.date}</span>
                <span>{formatDateTime(item.checkInTime)}</span>
              </div>
            ))}
            {data.recent.length === 0 ? <p className="subcopy">No attendance records synced yet.</p> : null}
          </div>
        </SurfaceCard>
      </section>
    </main>
  );
}

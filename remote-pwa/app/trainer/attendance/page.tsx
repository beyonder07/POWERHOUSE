'use client';

import { useState } from 'react';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { useAuthedPageData } from '../../../lib/app-client';
import { LoadingState, Notice, PageIntro, SurfaceCard } from '../../../components/app-ui';
import { formatDateTime } from '../../../lib/formatters';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerAttendancePayload = {
  memberAttendance: Array<{ id: number; date: string; memberName: string; status: string; checkInTime: string }>;
  trainerAttendance: Array<{ id: number; date: string; checkInTime: string }>;
};

export default function TrainerAttendancePage() {
  const { data, loading, error, session, logout } = useAuthedPageData<TrainerAttendancePayload>('/api/data/trainer/attendance', TRAINER_ROLES);
  const [status, setStatus] = useState<string | null>(null);

  if (loading || !data) {
    return <LoadingState title="Loading attendance screens" text="Fetching read-only member attendance and your own log." />;
  }

  const markOwnAttendance = async () => {
    const response = await fetch(`${API_URL}/api/requests`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'trainer-attendance', data: { date: new Date().toISOString().slice(0, 10) } })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to create attendance request' }));
    setStatus(response.ok ? 'Attendance request submitted for approval.' : String(json.error || 'Failed to create attendance request'));
  };

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status.includes('submitted') ? 'success' : 'error'} text={status} /> : null}
      <PageIntro eyebrow="Attendance" title="Read-only member attendance" description="You can review assigned-member attendance here, and submit your own attendance request for approval." actions={<button type="button" onClick={markOwnAttendance}>Mark My Attendance</button>} />

      <section className="content-grid two-col">
        <SurfaceCard title="Assigned member attendance">
          <div className="timeline-list dense">
            {data.memberAttendance.map((item) => (
              <div key={item.id} className="timeline-item">
                <strong>{item.memberName}</strong>
                <span>{item.status}</span>
                <span>{item.date}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Self log" title="Your attendance history">
          <div className="timeline-list dense">
            {data.trainerAttendance.map((item) => (
              <div key={item.id} className="timeline-item">
                <strong>{item.date}</strong>
                <span>{formatDateTime(item.checkInTime)}</span>
              </div>
            ))}
            {data.trainerAttendance.length === 0 ? <p className="subcopy">No trainer attendance has been approved yet.</p> : null}
          </div>
        </SurfaceCard>
      </section>
    </main>
  );
}

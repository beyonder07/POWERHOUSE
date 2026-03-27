'use client';

import { useState } from 'react';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { useAuthedPageData } from '../../../lib/app-client';
import { LoadingState, Notice, PageIntro, SurfaceCard } from '../../../components/app-ui';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerWorkoutsPayload = {
  items: Array<{ memberId: number; memberName: string; workoutPlan: { name?: string; exercises?: string[] } | null }>;
  memberOptions: Array<{ id: number; name: string }>;
};

export default function TrainerWorkoutsPage() {
  const { data, loading, error, session, logout, reload } = useAuthedPageData<TrainerWorkoutsPayload>('/api/data/trainer/workouts', TRAINER_ROLES);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: '', planName: '', exercises: '' });

  if (loading || !data) {
    return <LoadingState title="Loading workout assignments" text="Getting your active plan requests and member list ready." />;
  }

  const submitWorkoutRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    const response = await fetch(`${API_URL}/api/requests`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'workout-plan',
        data: {
          memberId: Number(form.memberId || 0),
          workoutPlan: {
            name: form.planName,
            exercises: form.exercises.split('\n').map((item) => item.trim()).filter(Boolean)
          }
        }
      })
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to submit workout request' }));
    if (!response.ok) {
      setStatus(String(json.error || 'Failed to submit workout request'));
      return;
    }

    setStatus('Workout assignment request submitted.');
    setForm({ memberId: '', planName: '', exercises: '' });
    void reload();
  };

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status.includes('submitted') ? 'success' : 'error'} text={status} /> : null}
      <PageIntro eyebrow="Workout Plans" title="Assign routines by request" description="Trainers can propose workout plans for assigned members. The owner remains in control through approval." />

      <section className="content-grid two-col">
        <SurfaceCard title="Current member plans">
          <div className="timeline-list">
            {data.items.map((item) => (
              <div key={item.memberId} className="timeline-item">
                <strong>{item.memberName}</strong>
                <span>{item.workoutPlan?.name || 'No plan assigned'}</span>
                <span>{(item.workoutPlan?.exercises || []).slice(0, 2).join(', ') || 'No exercises listed'}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Request" title="Submit workout change">
          <form className="stack-form" onSubmit={submitWorkoutRequest}>
            <label>
              Member
              <select value={form.memberId} onChange={(event) => setForm((prev) => ({ ...prev, memberId: event.target.value }))}>
                <option value="">Select member</option>
                {data.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Plan name
              <input value={form.planName} onChange={(event) => setForm((prev) => ({ ...prev, planName: event.target.value }))} />
            </label>
            <label>
              Exercises
              <textarea value={form.exercises} onChange={(event) => setForm((prev) => ({ ...prev, exercises: event.target.value }))} placeholder="One exercise per line" />
            </label>
            <button type="submit">Send for approval</button>
          </form>
        </SurfaceCard>
      </section>
    </main>
  );
}

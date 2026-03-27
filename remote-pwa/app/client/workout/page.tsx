'use client';

import { Avatar, LoadingState, Notice, PageIntro, SurfaceCard } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import type { ViewerRole } from '../../../lib/auth';

const CLIENT_ROLES: ViewerRole[] = ['client'];

type ClientWorkoutPayload = {
  workoutPlan: { name?: string; exercises?: string[] } | null;
  assignedTrainer: { id: number; name: string; profilePhotoUrl: string } | null;
};

export default function ClientWorkoutPage() {
  const { data, loading, error } = useAuthedPageData<ClientWorkoutPayload>('/api/data/client/workout', CLIENT_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading workout plan" text="Bringing in your assigned routine and trainer details." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Workout" title={data.workoutPlan?.name || 'Your assigned workout'} description="A focused, mobile-friendly plan you can open while you train." />

      <section className="content-grid two-col">
        <SurfaceCard title="Workout routine">
          <ul className="check-list">
            {(data.workoutPlan?.exercises || []).map((exercise) => (
              <li key={exercise}>{exercise}</li>
            ))}
            {!(data.workoutPlan?.exercises || []).length ? <li>No exercises assigned yet.</li> : null}
          </ul>
        </SurfaceCard>

        <SurfaceCard eyebrow="Assigned trainer" title={data.assignedTrainer?.name || 'No trainer assigned'}>
          {data.assignedTrainer ? (
            <div className="profile-hero-card compact-profile-card">
              <Avatar name={data.assignedTrainer.name} src={data.assignedTrainer.profilePhotoUrl} compact />
              <div>
                <strong>{data.assignedTrainer.name}</strong>
                <p className="subcopy">Your guidance contact inside PowerHouse.</p>
              </div>
            </div>
          ) : (
            <p className="subcopy">A trainer will appear here once one is assigned to your profile.</p>
          )}
        </SurfaceCard>
      </section>
    </main>
  );
}

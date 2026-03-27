'use client';

import { Avatar, EmptyState, LoadingState, Notice, PageIntro, SurfaceCard, StatusPill } from '../../../components/app-ui';
import { useAuthedPageData } from '../../../lib/app-client';
import { formatDate } from '../../../lib/formatters';
import type { ViewerRole } from '../../../lib/auth';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerMembersPayload = {
  items: Array<{ id: number; name: string; profilePhotoUrl: string; membershipStatus: string; expiryDate: string }>;
};

export default function TrainerMembersPage() {
  const { data, loading, error } = useAuthedPageData<TrainerMembersPayload>('/api/data/trainer/members', TRAINER_ROLES);

  if (loading || !data) {
    return <LoadingState title="Loading assigned members" text="Preparing your member list with privacy-safe details." />;
  }

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      <PageIntro eyebrow="Assigned Members" title="Your member list" description="Only the essentials are visible here: name, profile photo, and membership status." />
      <section className="card-grid">
        {data.items.map((member) => (
          <SurfaceCard key={member.id} title={member.name} className="member-card">
            <div className="profile-hero-card compact-profile-card">
              <Avatar name={member.name} src={member.profilePhotoUrl} compact />
              <div>
                <StatusPill label={member.membershipStatus || 'unknown'} tone={member.membershipStatus === 'active' ? 'success' : 'warning'} />
                <p className="subcopy">Expiry: {formatDate(member.expiryDate)}</p>
              </div>
            </div>
          </SurfaceCard>
        ))}
        {data.items.length === 0 ? <EmptyState title="No assigned members yet" text="Once members are assigned to you, they will appear here with privacy-safe cards." /> : null}
      </section>
    </main>
  );
}

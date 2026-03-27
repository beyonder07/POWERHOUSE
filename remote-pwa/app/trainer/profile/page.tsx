'use client';

import { useEffect, useState } from 'react';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { authedJson, useAuthedPageData } from '../../../lib/app-client';
import { Avatar, LoadingState, Notice, PageIntro, SurfaceCard, StatusPill } from '../../../components/app-ui';
import { PhotoUpload } from '../../../components/photo-upload';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerProfilePayload = {
  profile: {
    name: string;
    phone: string;
    email: string;
    governmentId: string;
    governmentIdVerified: boolean;
    profilePhotoUrl: string;
  };
};

export default function TrainerProfilePage() {
  const { data, loading, error, session, setSession, logout, setData } = useAuthedPageData<TrainerProfilePayload>('/api/data/trainer/profile', TRAINER_ROLES);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: '', phone: '', profilePhotoUrl: '' });

  useEffect(() => {
    if (!data) {
      return;
    }

    setForm({
      displayName: data.profile.name || '',
      phone: data.profile.phone || '',
      profilePhotoUrl: data.profile.profilePhotoUrl || ''
    });
  }, [data]);

  if (loading || !data) {
    return <LoadingState title="Loading trainer profile" text="Preparing your profile and identity details." />;
  }

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);

    if (photoError) {
      setStatus(photoError);
      setSaving(false);
      return;
    }

    const response = await fetch(`${API_URL}/api/data/trainer/profile`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(form)
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const json = await response.json().catch(() => ({ error: 'Failed to save profile' }));
    if (!response.ok) {
      setStatus(String(json.error || 'Failed to save profile'));
      setSaving(false);
      return;
    }

    const refresh = await authedJson<TrainerProfilePayload>('/api/data/trainer/profile', session);
    if (!refresh.ok || !refresh.session || !refresh.data) {
      if (refresh.unauthorized) {
        logout();
        return;
      }
      setStatus(refresh.error || 'Profile saved, but refresh failed');
      setSaving(false);
      return;
    }

    setSession(refresh.session);
    setData(refresh.data);
    setStatus('Profile updated.');
    setSaving(false);
  };

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status === 'Profile updated.' ? 'success' : 'error'} text={status} /> : null}
      <PageIntro
        eyebrow="Trainer Profile"
        title="Your staff profile"
        description="Only personal details are editable here. Your linked identity stays protected."
        actions={<StatusPill label={data.profile.governmentIdVerified ? 'Verified' : 'Pending'} tone={data.profile.governmentIdVerified ? 'success' : 'warning'} />}
      />

      <section className="content-grid feature-grid">
        <SurfaceCard title="Profile card">
          <div className="profile-hero-card">
            <Avatar name={data.profile.name} src={form.profilePhotoUrl || data.profile.profilePhotoUrl} />
            <div>
              <strong>{data.profile.name}</strong>
              <p className="subcopy">{data.profile.email}</p>
              <p className="subcopy">{data.profile.phone || 'No phone on file'}</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard eyebrow="Editable" title="Update profile">
          <form className="stack-form" onSubmit={handleSave}>
            <label>
              Name
              <input value={form.displayName} onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))} />
            </label>
            <label>
              Phone
              <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
            </label>
            <label>
              Email
              <input value={data.profile.email} disabled />
            </label>
            <label>
              Government ID
              <input value={data.profile.governmentId || 'Not available'} disabled />
            </label>
            <PhotoUpload
              label="Profile photo"
              value={form.profilePhotoUrl}
              onChange={(next) => setForm((prev) => ({ ...prev, profilePhotoUrl: next }))}
              onError={setPhotoError}
              helperText="Use the camera or choose a photo from your device."
            />
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button>
          </form>
        </SurfaceCard>
      </section>
    </main>
  );
}

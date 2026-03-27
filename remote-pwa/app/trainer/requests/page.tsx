'use client';

import { useMemo, useState } from 'react';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { useAuthedPageData } from '../../../lib/app-client';
import { LoadingState, Notice, PageIntro, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { PhotoUpload } from '../../../components/photo-upload';
import { formatDateTime } from '../../../lib/formatters';

const TRAINER_ROLES: ViewerRole[] = ['trainer'];

type TrainerRequestsPayload = {
  items: Array<{ _id: string; type: string; status: string; createdAt: string; reviewNote?: string }>;
};

type MemberRequestFormState = {
  fullName: string;
  phone: string;
  email: string;
  governmentId: string;
  profilePhotoUrl: string;
  planPreference: string;
  notes: string;
};

const initialForm: MemberRequestFormState = {
  fullName: '',
  phone: '',
  email: '',
  governmentId: '',
  profilePhotoUrl: '',
  planPreference: '',
  notes: ''
};

export default function TrainerRequestsPage() {
  const { data, loading, error, session, logout, reload } = useAuthedPageData<TrainerRequestsPayload>('/api/data/trainer/requests', TRAINER_ROLES);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [form, setForm] = useState<MemberRequestFormState>(initialForm);

  const disableSubmit = useMemo(() => {
    return submitting || !form.fullName.trim() || !form.phone.trim() || !form.email.trim() || !form.governmentId.trim() || !form.profilePhotoUrl;
  }, [form, submitting]);

  if (loading || !data) {
    return <LoadingState title="Loading trainer requests" text="Preparing your approval queue and request form." />;
  }

  const updateField = (field: keyof MemberRequestFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const submitMemberRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (photoError) {
      setStatus(photoError);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/requests`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'member',
          data: {
            fullName: form.fullName,
            phone: form.phone,
            email: form.email,
            governmentId: form.governmentId,
            profilePhotoUrl: form.profilePhotoUrl,
            planPreference: form.planPreference,
            notes: form.notes
          }
        })
      });

      if (response.status === 401) {
        logout();
        return;
      }

      const json = await response.json().catch(() => ({ error: 'Failed to submit request' }));
      if (!response.ok) {
        setStatus(String(json.error || 'Failed to submit request'));
        return;
      }

      setStatus('Member request submitted for owner approval.');
      setForm(initialForm);
      setPhotoError(null);
      void reload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-stack">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status.includes('submitted') ? 'success' : 'error'} text={status} /> : null}
      <PageIntro eyebrow="Requests" title="Approval workflow" description="Trainers can prepare a full new-member request here. The owner reviews it before any account is created." />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="New member request" title="Send a member request">
          <form className="stack-form" onSubmit={submitMemberRequest}>
            <div className="form-section-grid">
              <label>
                Member name
                <input value={form.fullName} onChange={(event) => updateField('fullName', event.target.value)} placeholder="Enter member name" />
              </label>
              <label>
                Phone number
                <input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="Enter phone number" inputMode="tel" />
              </label>
              <label>
                Email
                <input value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="Enter email" type="email" />
              </label>
              <label>
                Government ID
                <input value={form.governmentId} onChange={(event) => updateField('governmentId', event.target.value)} placeholder="Enter government ID" />
              </label>
            </div>

            <label>
              Plan preference
              <input value={form.planPreference} onChange={(event) => updateField('planPreference', event.target.value)} placeholder="Optional suggested plan" />
            </label>

            <PhotoUpload
              label="Profile photo"
              value={form.profilePhotoUrl}
              onChange={(next) => updateField('profilePhotoUrl', next)}
              onError={setPhotoError}
              helperText="Capture or upload a clear member photo for the owner review."
            />

            <label>
              Notes for owner
              <textarea value={form.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="Any helpful context for approval" />
            </label>

            <button type="submit" disabled={disableSubmit}>{submitting ? 'Submitting request...' : 'Submit request'}</button>
          </form>
        </SurfaceCard>

        <SurfaceCard title="Recent request history">
          <div className="timeline-list">
            {data.items.map((item) => (
              <div key={item._id} className="timeline-item">
                <strong>{item.type}</strong>
                <span>{formatDateTime(item.createdAt)}</span>
                <StatusPill label={item.status} tone={item.status === 'approved' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'} />
                {item.reviewNote ? <span>{item.reviewNote}</span> : null}
              </div>
            ))}
            {data.items.length === 0 ? <p className="subcopy">No requests created yet.</p> : null}
          </div>
        </SurfaceCard>
      </section>
    </main>
  );
}

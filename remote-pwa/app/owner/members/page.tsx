'use client';

import { useMemo, useState } from 'react';
import { Avatar, EmptyState, GridToolbar, LoadingState, Notice, PageIntro, PaginationControls, StatusPill, SurfaceCard } from '../../../components/app-ui';
import { PhotoUpload } from '../../../components/photo-upload';
import { useAuthedPageData } from '../../../lib/app-client';
import { API_URL, type ViewerRole } from '../../../lib/auth';
import { currency, formatDate } from '../../../lib/formatters';
import { useGridQuery } from '../../../lib/grid';

const OWNER_ROLES: ViewerRole[] = ['owner', 'admin'];

type OwnerMembersPayload = {
  items: Array<{
    id: number;
    name: string;
    phone: string;
    email: string;
    governmentId: string;
    governmentIdVerified: boolean;
    profilePhotoUrl: string;
    planType: string;
    joinDate: string;
    expiryDate: string;
    status: string;
    payments: Array<{ id: number; amount: number }>;
    attendance: Array<{ id: number }>;
  }>;
};

type MemberFormState = {
  fullName: string;
  phone: string;
  email: string;
  governmentId: string;
  profilePhotoUrl: string;
  planPreference: string;
};

const initialForm: MemberFormState = {
  fullName: '',
  phone: '',
  email: '',
  governmentId: '',
  profilePhotoUrl: '',
  planPreference: ''
};

export default function OwnerMembersPage() {
  const { data, loading, error, session, logout, reload } = useAuthedPageData<OwnerMembersPayload>('/api/data/owner/members', OWNER_ROLES);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [form, setForm] = useState<MemberFormState>(initialForm);
  const items = data?.items || [];
  const grid = useGridQuery({
    items,
    pageSize: 6,
    predicate: (member, query) => [
      member.name,
      member.phone,
      member.email,
      member.governmentId,
      member.planType,
      member.status
    ].some((value) => String(value || '').toLowerCase().includes(query))
  });

  const disableSubmit = useMemo(() => {
    return submitting || !form.fullName.trim() || !form.phone.trim() || !form.email.trim() || !form.governmentId.trim() || !form.profilePhotoUrl;
  }, [form, submitting]);

  if (loading || !data) {
    return <LoadingState title="Loading members" text="Preparing full member records with payment and attendance history." />;
  }

  const updateField = (field: keyof MemberFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const submitDirectMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (photoError) {
      setStatus(photoError);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/requests/direct-member`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fullName: form.fullName,
          phone: form.phone,
          email: form.email,
          governmentId: form.governmentId,
          profilePhotoUrl: form.profilePhotoUrl,
          planPreference: form.planPreference
        })
      });

      if (response.status === 401) {
        logout();
        return;
      }

      const json = await response.json().catch(() => ({ error: 'Failed to create member' }));
      if (!response.ok) {
        setStatus(String(json.error || 'Failed to create member'));
        return;
      }

      setStatus(`Member created successfully. Member ID ${json.createdUser?.memberId || '-'}.`);
      setForm(initialForm);
      setPhotoError(null);
      void reload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-stack owner-page">
      {error ? <Notice tone="error" text={error} /> : null}
      {status ? <Notice tone={status.includes('successfully') ? 'success' : 'error'} text={status} /> : null}
      <PageIntro eyebrow="Members" title="Member management" description="Add members fast, then review the full records with payments and attendance below." />

      <section className="content-grid two-col">
        <SurfaceCard eyebrow="Quick add" title="Create a member directly">
          <form className="stack-form" onSubmit={submitDirectMember}>
            <div className="form-section-grid">
              <label>
                Full name
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
              <input value={form.planPreference} onChange={(event) => updateField('planPreference', event.target.value)} placeholder="Optional starter plan" />
            </label>

            <PhotoUpload
              label="Profile photo"
              value={form.profilePhotoUrl}
              onChange={(next) => updateField('profilePhotoUrl', next)}
              onError={setPhotoError}
              helperText="Capture or upload a clear profile photo before creating the member."
            />

            <button type="submit" disabled={disableSubmit}>{submitting ? 'Creating member...' : 'Add member now'}</button>
          </form>
        </SurfaceCard>

        <SurfaceCard eyebrow="Owner note" title="What happens after save">
          <div className="timeline-list dense">
            <div className="timeline-item">
              <strong>Account is created immediately</strong>
              <span>The member becomes visible in your owner records right away.</span>
            </div>
            <div className="timeline-item">
              <strong>Password stays secure</strong>
              <span>The member still uses Forgot Password later to set their own password safely.</span>
            </div>
            <div className="timeline-item">
              <strong>No duplicate signups</strong>
              <span>Phone number and email are checked before a new member is created.</span>
            </div>
          </div>
        </SurfaceCard>
      </section>

      <GridToolbar
        query={grid.query}
        onQueryChange={grid.setQuery}
        placeholder="Search by name, phone, email, plan, or ID"
        filteredCount={grid.filteredCount}
        totalCount={grid.totalItems}
        page={grid.page}
        totalPages={grid.totalPages}
        pageSize={6}
        label="members"
      />
      <section className="card-grid owner-card-grid">
        {grid.pageItems.map((member) => (
          <SurfaceCard key={member.id} title={member.name} className="owner-record-card">
            <div className="profile-hero-card compact-profile-card">
              <Avatar name={member.name} src={member.profilePhotoUrl} compact />
              <div>
                <StatusPill label={member.status || 'unknown'} tone={member.status === 'active' ? 'success' : 'warning'} />
                <p className="subcopy">{member.planType || 'No plan'}</p>
              </div>
            </div>
            <div className="detail-list compact">
              <div><span>Phone</span><strong>{member.phone || '-'}</strong></div>
              <div><span>Email</span><strong>{member.email || '-'}</strong></div>
              <div><span>Government ID</span><strong>{member.governmentId || '-'}</strong></div>
              <div><span>Verified</span><strong>{member.governmentIdVerified ? 'Yes' : 'No'}</strong></div>
              <div><span>Joined</span><strong>{formatDate(member.joinDate)}</strong></div>
              <div><span>Expiry</span><strong>{formatDate(member.expiryDate)}</strong></div>
              <div><span>Payments</span><strong>{currency(member.payments.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></div>
              <div><span>Attendance rows</span><strong>{member.attendance.length}</strong></div>
            </div>
          </SurfaceCard>
        ))}
        {grid.pageItems.length === 0 ? <EmptyState title="No members found" text="Try a different search term to find a member record." /> : null}
      </section>
      <PaginationControls page={grid.page} totalPages={grid.totalPages} onPageChange={grid.setPage} />
    </main>
  );
}

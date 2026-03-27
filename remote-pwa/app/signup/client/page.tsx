'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrandLogo, ThemeToggle, useThemeState } from '../../../components/chrome';
import { PhotoUpload } from '../../../components/photo-upload';
import { API_URL, PUBLIC_GYM_ID } from '../../../lib/auth';

export default function ClientSignupPage() {
  const { theme, toggleTheme } = useThemeState();
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    governmentId: '',
    profilePhotoUrl: '',
    planPreference: ''
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch(`${API_URL}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client',
          data: { ...form, gymId: PUBLIC_GYM_ID }
        })
      });

      const json = await response.json().catch(() => ({ error: 'Could not send request' }));
      if (!response.ok) {
        throw new Error(json.error || 'Could not send request');
      }

      setStatus('Request sent. Waiting for approval.');
      setForm({ fullName: '', phone: '', email: '', governmentId: '', profilePhotoUrl: '', planPreference: '' });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not send request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="pwa-shell auth-shell public-shell">
      <div className="ambient-orb ambient-left" />
      <div className="ambient-orb ambient-right" />
      <section className="login-hero public-hero">
        <div className="brand-cluster">
          <BrandLogo />
          <div>
            <p className="eyebrow">Client Request</p>
            <h1>Join PowerHouse Gym</h1>
            <p className="subcopy">Fill out this simple request form. The owner will review it before your account is created.</p>
          </div>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </section>

      <section className="public-form-wrap">
        <article className="panel public-panel">
          {error ? <p className="notice error">{error}</p> : null}
          {status ? <p className="notice success">{status}</p> : null}
          <form className="stack-form" onSubmit={submit}>
            <div className="form-section-grid">
              <label>
                Full Name
                <input value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} placeholder="Your full name" required />
              </label>
              <label>
                Phone Number
                <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="10-digit phone number" required />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="name@gmail.com" required />
              </label>
              <label>
                Government ID
                <input value={form.governmentId} onChange={(event) => setForm((prev) => ({ ...prev, governmentId: event.target.value }))} placeholder="ID number" required />
              </label>
              <label>
                Plan Preference
                <input value={form.planPreference} onChange={(event) => setForm((prev) => ({ ...prev, planPreference: event.target.value }))} placeholder="Optional" />
              </label>
            </div>

            <PhotoUpload label="Profile Photo" value={form.profilePhotoUrl} onChange={(next) => setForm((prev) => ({ ...prev, profilePhotoUrl: next }))} />

            <button type="submit" disabled={loading || !form.profilePhotoUrl}>{loading ? 'Sending Request...' : 'Submit Request'}</button>
          </form>
          <div className="auth-links align-left">
            <Link href="/login" className="ghost-button">Back to Login</Link>
            <Link href="/signup/trainer" className="ghost-button">I am a Trainer</Link>
          </div>
        </article>
      </section>
    </main>
  );
}

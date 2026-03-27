'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLogo, ThemeToggle, useThemeState } from '../../components/chrome';
import { API_URL, clearSession, getStoredSession, routeForRole, saveSession, type ViewerRole } from '../../lib/auth';

function roleSummary(role: ViewerRole) {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'staff':
      return 'A high-visibility control surface for analytics, approvals, and live gym operations.';
    case 'trainer':
      return 'A focused operational dashboard for members, workout requests, and floor activity.';
    case 'client':
      return 'A personal fitness companion with your own profile, membership, attendance, and payments.';
    default:
      return 'Role-specific dashboards that reveal only the data each person should actually see.';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useThemeState();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = getStoredSession();
    if (session.accessToken && session.role) {
      router.replace(routeForRole(session.role));
    }
  }, [router]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Login failed');
      }

      const nextAccessToken = String(json.accessToken || json.token || '');
      const nextRefreshToken = String(json.refreshToken || '');
      if (!nextAccessToken || !nextRefreshToken) {
        throw new Error('Login response missing token pair');
      }

      const session = saveSession(nextAccessToken, nextRefreshToken);
      setStatus('Login successful. Redirecting...');
      router.replace(routeForRole(session.role));
    } catch (err) {
      clearSession();
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="pwa-shell auth-shell">
      <div className="ambient-orb ambient-left" />
      <div className="ambient-orb ambient-right" />

      <section className="login-hero">
        <div className="brand-cluster">
          <BrandLogo />
          <div>
            <p className="eyebrow">PowerHouse Remote</p>
            <h1>Three roles. Three dashboards. Zero accidental exposure.</h1>
            <p className="subcopy">{roleSummary('')}</p>
          </div>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </section>

      <section className="auth-grid">
        <article className="panel auth-story">
          <p className="eyebrow">Access Design</p>
          <h2>Every role sees a different product.</h2>
          <div className="story-list">
            <div>
              <strong>Client</strong>
              <span>Personal profile, attendance, membership, and payment history only.</span>
            </div>
            <div>
              <strong>Trainer</strong>
              <span>Assigned member operations, self-attendance, and request workflows.</span>
            </div>
            <div>
              <strong>Owner</strong>
              <span>Analytics, full profile access, approvals, and operational oversight.</span>
            </div>
          </div>
        </article>

        <article className="panel auth-panel">
          <p className="eyebrow">Sign In</p>
          <h2>Open your PowerHouse dashboard</h2>
          <p className="subcopy">The system will route you to the correct dashboard automatically after login.</p>
          {error ? <p className="notice notice-error">{error}</p> : null}
          {status ? <p className="notice notice-success">{status}</p> : null}
          <form className="stack-form" onSubmit={handleLogin}>
            <label>
              Phone Number or Email
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Owner uses phone number" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="password123" />
            </label>
            <button type="submit" disabled={loading}>{loading ? 'Signing In...' : 'Enter Dashboard'}</button>
          </form>
          <div className="auth-links">
            <Link href="/forgot-password" className="text-link">Forgot Password</Link>
            <Link href="/signup/client" className="ghost-button">Client Request</Link>
            <Link href="/signup/trainer" className="ghost-button">Trainer Request</Link>
          </div>
          <p className="subcopy">Owner must sign in with phone number. Clients and trainers can sign in with phone or email after approval.</p>
        </article>
      </section>
    </main>
  );
}

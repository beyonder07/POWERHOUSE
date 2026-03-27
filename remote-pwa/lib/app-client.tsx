'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authedFetch, clearSession, getStoredSession, routeForRole, type ViewerRole } from './auth';

export type SessionState = {
  accessToken: string;
  refreshToken: string;
  role: ViewerRole;
};

export function useRoleSession(allowedRoles: ViewerRole[]) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ accessToken: '', refreshToken: '', role: '' });
  const [ready, setReady] = useState(false);
  const allowedRolesKey = allowedRoles.join('|');

  useEffect(() => {
    const stored = getStoredSession();
    if (!stored.accessToken) {
      clearSession();
      router.replace('/');
      return;
    }

    if (!allowedRoles.includes(stored.role)) {
      router.replace(routeForRole(stored.role));
      return;
    }

    setSession(stored);
    setReady(true);
  }, [allowedRolesKey, router]);

  const logout = useCallback(() => {
    clearSession();
    router.replace('/');
  }, [router]);

  return { session, setSession, ready, logout };
}

export function useAuthedPageData<T>(endpoint: string, allowedRoles: ViewerRole[]) {
  const router = useRouter();
  const { session, setSession, ready, logout } = useRoleSession(allowedRoles);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ready || !session.accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    const result = await authedFetch(`${API_URL}${endpoint}`, session.accessToken, session.refreshToken);
    if (!result.session) {
      clearSession();
      router.replace('/');
      return;
    }

    setSession(result.session);
    if (!result.response.ok) {
      const json = await result.response.json().catch(() => ({ error: 'Failed to load page data' }));
      setError(String(json.error || 'Failed to load page data'));
      setLoading(false);
      return;
    }

    const json = await result.response.json();
    setData(json as T);
    setLoading(false);
  }, [endpoint, ready, router, session.accessToken, session.refreshToken, setSession]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    void reload();
  }, [ready, reload]);

  return {
    session,
    setSession,
    ready,
    logout,
    data,
    setData,
    loading,
    error,
    setError,
    reload
  };
}

export async function authedJson<T>(path: string, session: SessionState) {
  const result = await authedFetch(`${API_URL}${path}`, session.accessToken, session.refreshToken);
  if (!result.session) {
    return { ok: false, unauthorized: true, data: null as T | null, error: 'Session expired', session: null };
  }

  const json = await result.response.json().catch(() => null);
  if (!result.response.ok) {
    return {
      ok: false,
      unauthorized: result.response.status === 401,
      data: null as T | null,
      error: String((json as { error?: string } | null)?.error || 'Request failed'),
      session: result.session
    };
  }

  return { ok: true, unauthorized: false, data: json as T, error: null, session: result.session };
}

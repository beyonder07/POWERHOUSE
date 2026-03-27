export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4500';
export const PUBLIC_GYM_ID = process.env.NEXT_PUBLIC_GYM_ID || 'TEST_GYM_01';

export type ViewerRole = 'admin' | 'staff' | 'owner' | 'trainer' | 'client' | '';

type TokenClaims = {
  role?: ViewerRole;
};

export function parseTokenClaims(token: string): TokenClaims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return JSON.parse(decoded) as TokenClaims;
  } catch {
    return null;
  }
}

export function routeForRole(role: ViewerRole) {
  switch (role) {
    case 'client':
      return '/client';
    case 'trainer':
      return '/trainer';
    case 'owner':
    case 'admin':
    case 'staff':
      return '/owner';
    default:
      return '/';
  }
}

export function getStoredSession() {
  const accessToken = window.localStorage.getItem('cloud_access_token') || window.localStorage.getItem('cloud_token') || '';
  const refreshToken = window.localStorage.getItem('cloud_refresh_token') || '';
  const role = (parseTokenClaims(accessToken || '')?.role || '') as ViewerRole;

  return {
    accessToken,
    refreshToken,
    role
  };
}

export function saveSession(accessToken: string, refreshToken: string) {
  const role = (parseTokenClaims(accessToken)?.role || '') as ViewerRole;
  window.localStorage.setItem('cloud_access_token', accessToken);
  window.localStorage.setItem('cloud_refresh_token', refreshToken);
  window.localStorage.setItem('cloud_token', accessToken);
  return {
    accessToken,
    refreshToken,
    role
  };
}

export function clearSession() {
  window.localStorage.removeItem('cloud_access_token');
  window.localStorage.removeItem('cloud_refresh_token');
  window.localStorage.removeItem('cloud_token');
}

export async function refreshSession(refreshToken: string) {
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    const json = await response.json();
    if (!response.ok) {
      return null;
    }

    const nextAccessToken = String(json.accessToken || json.token || '');
    const nextRefreshToken = String(json.refreshToken || '');
    if (!nextAccessToken || !nextRefreshToken) {
      return null;
    }

    return saveSession(nextAccessToken, nextRefreshToken);
  } catch {
    return null;
  }
}

export async function authedFetch(url: string, accessToken: string, refreshToken: string) {
  const run = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  const first = await run(accessToken);
  if (first.status !== 401) {
    return {
      response: first,
      session: { accessToken, refreshToken, role: (parseTokenClaims(accessToken)?.role || '') as ViewerRole }
    };
  }

  const refreshed = await refreshSession(refreshToken);
  if (!refreshed) {
    return {
      response: first,
      session: null
    };
  }

  return {
    response: await run(refreshed.accessToken),
    session: refreshed
  };
}

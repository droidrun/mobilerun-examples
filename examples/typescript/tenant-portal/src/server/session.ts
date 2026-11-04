import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE = 'portal_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // seconds

// STUB: the session behind the stub login in api-app.ts. Replace both with your login.
/** The session cookie: a signed user id and nothing else. */
export function createSessions(sessionSecret: string, secureCookies: boolean) {
  const cookieOptions = {
    httpOnly: true, sameSite: 'Lax', secure: secureCookies, path: '/', maxAge: COOKIE_MAX_AGE,
  } as const;
  return {
    start: (c: Context, userId: number) =>
      setSignedCookie(c, COOKIE, String(userId), sessionSecret, cookieOptions),
    end: (c: Context) => void deleteCookie(c, COOKIE, cookieOptions),
    /** The user id, or null for a missing, unsigned or tampered cookie. */
    async userId(c: Context) {
      const value = await getSignedCookie(c, sessionSecret, COOKIE);
      return value && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null;
    },
  };
}

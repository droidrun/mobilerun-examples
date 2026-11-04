import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE = 'portal_session';
const MAX_AGE = 60 * 60 * 24 * 7; // seconds

/**
 * The session cookie: a signed user id and nothing else. The stub is the `POST /api/login`
 * route in api-app.ts, where any email signs in. When you wire your identity provider, delete
 * that route and replace this module together with it; the rest only needs a user id.
 */
export function createSessions(secret: string, secure: boolean) {
  return {
    start: (context: Context, userId: number) =>
      setSignedCookie(context, COOKIE, String(userId), secret, {
        httpOnly: true,
        sameSite: 'Lax',
        secure,
        path: '/',
        maxAge: MAX_AGE,
      }),
    end: (context: Context) => void deleteCookie(context, COOKIE, { path: '/', secure }),
    /** The user id, or null for a missing, unsigned or tampered cookie. */
    async userId(context: Context) {
      const value = await getSignedCookie(context, secret, COOKIE);
      return value && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null;
    },
  };
}

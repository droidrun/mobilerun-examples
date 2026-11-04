import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE_NAME = 'portal_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

type SessionOptions = { secret: string; secure: boolean };

/**
 * Session cookie: the signed user id and nothing else.
 *
 * The stub is the `POST /api/login` route in api-app.ts, where any email signs
 * in as that user. When you wire a real identity provider, delete that route
 * and replace this module together with it. The rest of the server only needs
 * a user id.
 */
export async function startSession(
  context: Context,
  userId: number,
  { secret, secure }: SessionOptions,
): Promise<void> {
  await setSignedCookie(context, COOKIE_NAME, String(userId), secret, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

export function endSession(context: Context, secure: boolean): void {
  deleteCookie(context, COOKIE_NAME, { path: '/', secure });
}

/** Returns the user id, or null for a missing, unsigned, or tampered cookie. */
export async function readSessionUserId(
  context: Context,
  secret: string,
): Promise<number | null> {
  const value = await getSignedCookie(context, secret, COOKIE_NAME);
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) return null;
  return Number(value);
}

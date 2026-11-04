import type { MiddlewareHandler } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';

export type SessionEnv = { Variables: { userId: string } };

const COOKIE_NAME = 'assistant_session';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * STUB IDENTITY. The first visit gets a random user id in a signed, HttpOnly
 * cookie. That is enough to keep one browser's runs and credits apart from
 * another's, and nothing more. Replace this middleware with your own
 * authentication; the rest of the server only reads `c.get('userId')`.
 */
export function stubSession(
  secret: string,
  production: boolean,
): MiddlewareHandler<SessionEnv> {
  return async (context, next) => {
    const existing = await getSignedCookie(context, secret, COOKIE_NAME);
    let userId = typeof existing === 'string' && existing ? existing : null;
    if (!userId) {
      userId = crypto.randomUUID();
      await setSignedCookie(context, COOKIE_NAME, userId, secret, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: production,
        path: '/',
        maxAge: ONE_YEAR_SECONDS,
      });
    }
    context.set('userId', userId);
    await next();
  };
}

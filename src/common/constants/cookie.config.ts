import type { CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'accessToken';
export const REFRESH_TOKEN_COOKIE = 'refreshToken';

/** The refresh cookie is only sent to the auth routes that need it. */
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

export function authCookieOptions(
  isProduction: boolean,
  maxAge: number,
  path = '/',
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge,
    path,
  };
}

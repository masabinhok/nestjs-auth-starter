import type { User, UserRole } from '../generated/prisma/client.js';

/** The signed-in user as every route sees it (`@CurrentUser()`). */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** Read by `@Authenticate({ verifiedEmail: true })`. */
  emailVerified: boolean;
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: AuthUser;
    /** The sessions store joins the user, so cookie requests cost one query. */
    sessionExtra: { user: User };
  }
}

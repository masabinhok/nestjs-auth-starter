import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from '@nestjs/authentication';
import { toAuthUser, type AuthUser } from '../auth.types.js';

/** Browsers: the `__Host-sid` session cookie. The store joins the user. */
@Injectable()
export class SessionAuthProvider extends SessionCookieProvider<AuthUser> {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this, { order: 0 });
  }

  protected validate(session: SessionRecord): AuthUser | null {
    const user = session.extra?.user;
    // A deactivated user's sessions end on their next request.
    return user?.isActive ? toAuthUser(user) : null;
  }
}

import { Policy, type PolicyBefore } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth.types.js';

/**
 * Who may do what with user accounts. Admins pass every check (`before`);
 * everyone else only gets the abilities that return true for them.
 * Add abilities here and check them with `@Can(UserPolicy, 'ability')` on
 * routes, or `AuthorizationService.authorize()` inside services.
 */
@Policy()
export class UserPolicy implements PolicyBefore<AuthUser> {
  before(user: AuthUser | null): boolean | undefined {
    return user?.role === 'ADMIN' ? true : undefined;
  }

  /** List, view, update and deactivate any account. Admins only. */
  manage(_user: AuthUser | null): boolean {
    return false;
  }

  /** View one account: your own, or any for admins. */
  view(user: AuthUser | null, userId: string): boolean {
    return user?.id === userId;
  }
}

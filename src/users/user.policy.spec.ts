import type { AuthUser } from '../auth/auth.types.js';
import { UserPolicy } from './user.policy.js';

const user = (role: 'ADMIN' | 'USER', id = 'u1'): AuthUser => ({
  id,
  role,
  email: `${id}@example.com`,
  fullName: id,
  emailVerified: true,
});

describe('UserPolicy', () => {
  const policy = new UserPolicy();

  it('lets admins do anything', () => {
    expect(policy.before(user('ADMIN'))).toBe(true);
  });

  it('defers for everyone else, including guests', () => {
    expect(policy.before(user('USER'))).toBeUndefined();
    expect(policy.before(null)).toBeUndefined();
  });

  it('users may view only themselves and manage nobody', () => {
    expect(policy.view(user('USER', 'a'), 'a')).toBe(true);
    expect(policy.view(user('USER', 'a'), 'b')).toBe(false);
    expect(policy.view(null, 'a')).toBe(false);
    expect(policy.manage(user('USER'))).toBe(false);
  });
});

import { PasswordHasher } from '@nestjs/authentication';
import bcrypt from 'bcryptjs';
import { PasswordsService } from './passwords.service.js';

describe('PasswordsService', () => {
  const service = new PasswordsService(new PasswordHasher({ logN: 10 }));

  it('hashes with scrypt and verifies', async () => {
    const hash = await service.hash('a long password');
    expect(hash).toMatch(/^\$scrypt\$/);
    expect(await service.verify('a long password', hash)).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect((await service.verify('wrong', hash)).valid).toBe(false);
  });

  it('accepts v1 bcrypt hashes and asks for a rehash', async () => {
    const legacy = await bcrypt.hash('Legacy@123', 4);
    expect(await service.verify('Legacy@123', legacy)).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect(await service.verify('nope', legacy)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('asks for a rehash when the cost was raised', async () => {
    const cheap = await new PasswordHasher({ logN: 10 }).hash('pw');
    const strict = new PasswordsService(new PasswordHasher({ logN: 11 }));
    expect(await strict.verify('pw', cheap)).toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('checks a dummy hash for unknown users', async () => {
    expect(await service.verify('anything', null)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});

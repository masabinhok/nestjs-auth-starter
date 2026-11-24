import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from 'generated/prisma/client';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('strips secrets when sanitizing a user', () => {
    const user = {
      id: '1',
      email: 'a@b.co',
      fullName: 'A',
      passwordHash: 'hash',
      refreshToken: 'rt',
    } as unknown as User;
    const safe = service.sanitizeUser(user);
    expect(safe).not.toHaveProperty('passwordHash');
    expect(safe).not.toHaveProperty('refreshToken');
  });
});

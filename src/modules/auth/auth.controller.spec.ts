import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  it('delegates signup to the service', async () => {
    const authService = { signup: vi.fn().mockResolvedValue({ ok: true }) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    }).compile();
    const controller = moduleRef.get(AuthController);
    const dto = { email: 'a@b.co', password: 'p', fullName: 'A' };
    await expect(controller.signup(dto)).resolves.toEqual({ ok: true });
    expect(authService.signup).toHaveBeenCalledWith(dto);
  });
});

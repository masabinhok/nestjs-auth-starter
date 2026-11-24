import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  it('delegates signup to the service', async () => {
    const authService = { signup: jest.fn().mockResolvedValue({ ok: true }) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    const controller = moduleRef.get(AuthController);
    const dto = { email: 'a@b.co', password: 'p', fullName: 'A' };
    await expect(controller.signup(dto)).resolves.toEqual({ ok: true });
    expect(authService.signup).toHaveBeenCalledWith(dto);
  });
});

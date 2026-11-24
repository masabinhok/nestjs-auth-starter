import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  it('passes pagination defaults to the service', async () => {
    const usersService = { getAllUsers: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    await moduleRef.get(UsersController).getAllUsers({});
    expect(usersService.getAllUsers).toHaveBeenCalledWith(1, 10);
  });
});

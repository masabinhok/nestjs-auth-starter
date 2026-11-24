import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { toProblem } from './problem-details.filter.js';

describe('toProblem', () => {
  it('keeps the errorCode of HTTP exceptions', () => {
    const problem = toProblem(
      new UnauthorizedException('Nope', { errorCode: 'INVALID_CREDENTIALS' }),
    );
    expect(problem).toMatchObject({
      status: 401,
      title: 'Unauthorized',
      errorCode: 'INVALID_CREDENTIALS',
      detail: 'Nope',
    });
  });

  it('derives a code from the status otherwise', () => {
    expect(toProblem(new NotFoundException('User not found'))).toMatchObject({
      status: 404,
      errorCode: 'NOT_FOUND',
    });
  });

  it('turns grouped validation errors into `errors`', () => {
    const problem = toProblem(
      new BadRequestException({
        message: { email: ['email must be an email'] },
      }),
    );
    expect(problem).toMatchObject({
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      errors: { email: ['email must be an email'] },
    });
  });

  it('maps Prisma not-found and unique errors', () => {
    const err = (code: string) =>
      new Prisma.PrismaClientKnownRequestError('internal details', {
        code,
        clientVersion: 'x',
      });
    expect(toProblem(err('P2025')).status).toBe(404);
    expect(toProblem(err('P2002')).status).toBe(409);
  });

  it('never leaks internal error messages', () => {
    const problem = toProblem(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
    });
  });
});

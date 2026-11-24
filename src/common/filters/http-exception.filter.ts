import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface.js';
import { Logger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';

interface NormalizedError {
  status: number;
  message: string;
  code: string;
  details?: unknown;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const correlationId = request.correlationId;

    const error = this.normalize(exception);

    const log = {
      correlationId,
      statusCode: error.status,
      errorCode: error.code,
      path: request.url,
      method: request.method,
      err: exception instanceof Error ? exception : undefined,
    };
    if (error.status >= 500) {
      this.logger.error(log, `Unhandled error: ${String(exception)}`);
    } else {
      this.logger.warn(log, error.message);
    }

    const body: ApiResponse = {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        ...(error.details !== undefined && { details: error.details }),
      },
      meta: { correlationId },
    };

    response.status(error.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const code = STATUS_CODES[status] ?? `HTTP_${status}`;

      if (typeof res === 'string') {
        return { status, message: res, code };
      }

      const { message } = res as { message?: unknown };
      // ValidationPipe puts the list of field errors in `message`.
      if (Array.isArray(message)) {
        return {
          status,
          message: 'Validation failed',
          code: 'VALIDATION_FAILED',
          details: message,
        };
      }
      return {
        status,
        message: typeof message === 'string' ? message : exception.message,
        code,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return {
          status: 404,
          message: 'Resource not found',
          code: 'NOT_FOUND',
        };
      }
      if (exception.code === 'P2002') {
        return {
          status: 409,
          message: 'Resource already exists',
          code: 'CONFLICT',
        };
      }
    }

    // Never send internal error details to clients; they are logged above.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    };
  }
}

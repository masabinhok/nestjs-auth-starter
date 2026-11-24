import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

/** RFC 9457 problem details, plus `errorCode` for clients to branch on. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** Stable, machine-readable: `VALIDATION_FAILED`, `mfa_required`, … */
  errorCode: string;
  /** Validation errors by field path. */
  errors?: Record<string, string[]>;
  details?: unknown;
  instance?: string;
  requestId?: string;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const codeFor = (status: number) =>
  (TITLES[status] ?? `HTTP ${status}`)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');

export function toProblem(exception: unknown): ProblemDetails {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: TITLES[status] ?? `HTTP ${status}`,
      status,
      errorCode: codeFor(status),
    };
    if (typeof body === 'string') {
      return { ...problem, detail: body };
    }
    const { message, errorCode, details } = body as {
      message?: unknown;
      errorCode?: unknown;
      details?: unknown;
    };
    if (typeof errorCode === 'string') {
      problem.errorCode = errorCode;
    }
    if (details !== undefined) {
      problem.details = details;
    }
    // ValidationPipe with errorFormat 'grouped': { field: [messages] }.
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      return {
        ...problem,
        detail: 'Validation failed',
        errorCode: 'VALIDATION_FAILED',
        errors: message as Record<string, string[]>,
      };
    }
    if (Array.isArray(message)) {
      return {
        ...problem,
        detail: 'Validation failed',
        errorCode: 'VALIDATION_FAILED',
        errors: { _: message.map(String) },
      };
    }
    return {
      ...problem,
      detail: typeof message === 'string' ? message : exception.message,
    };
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2025') {
      return {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        errorCode: 'NOT_FOUND',
        detail: 'Resource not found',
      };
    }
    if (exception.code === 'P2002') {
      return {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        errorCode: 'CONFLICT',
        detail: 'Resource already exists',
      };
    }
  }

  // Never echo internal errors; they are logged with the request id.
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: 'INTERNAL_SERVER_ERROR',
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const request = host.switchToHttp().getRequest<Request & { id?: string }>();
    const response = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception);
    problem.instance = request.originalUrl;
    if (request.id) {
      problem.requestId = String(request.id);
    }

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, requestId: problem.requestId },
        'Unhandled error',
      );
    }

    if (response.headersSent) {
      return;
    }
    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  requestId?: string;
  timestamp: string;
  stack?: string;
}

/**
 * Filtro global de excepciones: normaliza toda respuesta de error a un contrato
 * estable, adjunta el requestId y oculta el stack en producción.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly isProd: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (isHttp) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        message = (r.message as string | string[]) ?? exception.message;
        error = (r.error as string) ?? exception.name;
      }
    } else if (exception instanceof Error) {
      error = exception.name;
      if (!this.isProd) message = exception.message;
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: req.originalUrl,
      requestId: (req.id as string) ?? (req.headers['x-request-id'] as string),
      timestamp: new Date().toISOString(),
    };

    if (!this.isProd && exception instanceof Error) {
      body.stack = exception.stack;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { err: exception, path: body.path, requestId: body.requestId },
        `Unhandled error on ${req.method} ${body.path}`,
      );
    } else {
      this.logger.warn(
        { path: body.path, statusCode: status, requestId: body.requestId },
        `${req.method} ${body.path} -> ${status}`,
      );
    }

    res.status(status).json(body);
  }
}

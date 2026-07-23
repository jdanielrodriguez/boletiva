import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMeta } from '../decorators/audit.decorator';
import { AuditService } from '../../modules/audit/audit.service';
import { clientIp } from '../utils/client-ip';

/** Claves de payload que NUNCA deben quedar en la bitácora. */
const SECRET_KEY = /pass(word)?|token|secret|credential|otp|\bcode\b|pin/i;

function redact(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
  }
  return out;
}

/**
 * Registra en la bitácora de no-repudio (hash-chain) cada endpoint decorado con
 * `@Audit(...)` cuando completa con ÉXITO. Cross-cutting: un solo punto en vez de
 * llamadas manuales dispersas. Captura IP/UA server-side. Best-effort: el fallo al
 * auditar jamás rompe la respuesta. Auditoría 4 · G4.1.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      body?: unknown;
      headers?: Record<string, string | string[] | undefined>;
      user?: { userId?: string };
    }>();

    return next.handle().pipe(
      tap({
        next: () => {
          const params = req.params ?? {};
          const id = meta.param ? params[meta.param] : Object.values(params)[0];
          const label = meta.resource ?? meta.action;
          const ua = req.headers?.['user-agent'];
          void this.audit
            .record({
              userId: req.user?.userId ?? null,
              action: meta.action,
              resource: id ? `${label}:${id}` : label,
              ip: clientIp(req as never),
              userAgent: (Array.isArray(ua) ? ua[0] : ua) ?? null,
              payload: redact(req.body),
            })
            .catch(() => undefined); // no-repudio best-effort: nunca tumbar el flujo.
        },
      }),
    );
  }
}

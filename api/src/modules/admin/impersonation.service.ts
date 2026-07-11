import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PromoterStatus, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ImpersonationResult {
  accessToken: string;
  expiresIn: number;
  impersonatedBy: string;
  user: { id: string; email: string; roles: Role[] };
}

/**
 * Impersonación de promotores (soporte técnico, v3.8). SEGURA por diseño:
 *  - Solo un ADMIN puede iniciarla, y SOLO sobre un promotor (nunca otro admin).
 *  - Emite un access token de VIDA CORTA (config `jwt.impersonationTtl`) que actúa
 *    como el promotor pero lleva el claim `impersonatedBy: <adminId>` +
 *    `impersonation: true` (el frontend muestra un banner "estás viendo como X").
 *  - NO expone credenciales del target, NO rota su refresh y NO crea una sesión
 *    persistente suya: al caducar el token, la impersonación termina sola.
 *  - Todo inicio/fin queda en la bitácora de auditoría (no-repudio) con IP/UA.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async start(adminId: string, targetId: string, meta: RequestMeta): Promise<ImpersonationResult> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, roles: true, promoterStatus: true },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (target.roles.includes(Role.admin)) {
      throw new BadRequestException('No se puede impersonar a otro administrador');
    }
    const isPromoter =
      target.roles.includes(Role.promoter) || target.promoterStatus === PromoterStatus.approved;
    if (!isPromoter) {
      throw new BadRequestException('Solo se puede impersonar a un promotor');
    }

    const ttl = this.config.getOrThrow<number>('jwt.impersonationTtl');
    const accessToken = this.jwt.sign(
      {
        sub: target.id,
        email: target.email,
        roles: target.roles,
        impersonation: true,
        impersonatedBy: adminId,
      },
      { secret: this.config.getOrThrow<string>('jwt.accessSecret'), expiresIn: ttl },
    );

    await this.audit.record({
      userId: adminId,
      action: 'admin.impersonate.start',
      resource: target.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return {
      accessToken,
      expiresIn: ttl,
      impersonatedBy: adminId,
      user: { id: target.id, email: target.email, roles: target.roles },
    };
  }

  /**
   * Fin de la impersonación. "Salir" en el frontend = descartar el token (el admin
   * conserva intacta su sesión normal; aquí NADA se destruye). Deja rastro en la
   * bitácora. Se llama con el token IMPERSONADO.
   */
  async stop(user: AuthUser, meta: RequestMeta): Promise<{ message: string }> {
    await this.audit.record({
      // El actor real es el admin que la inició (si el token lo lleva); si no, el propio usuario.
      userId: user.impersonatedBy ?? user.userId,
      action: 'admin.impersonate.stop',
      resource: user.userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { message: 'ok' };
  }
}

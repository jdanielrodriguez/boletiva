import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { MessageResponseDto } from '../../common/dto/response.dto';
import { AuditService } from './audit.service';
import { AuditPageDto, AuditVerifyDto, ConfirmAuditDto } from './dto/audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** IP real del cliente: prioriza X-Forwarded-For (Cloud Run/proxy) sobre req.ip. */
  private clientIp(req: Request): string | null {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
    return req.ip ?? null;
  }

  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Registra un click de confirmación (no-repudio). IP y user-agent se capturan server-side',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async confirm(
    @Body() dto: ConfirmAuditDto,
    @CurrentUser('userId') userId: string,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    // El cuerpo lo controla el cliente: cualquier usuario autenticado podría enviar un
    // `action` arbitrario y, sin espacio de nombres, forjar en la bitácora un evento que
    // parezca de GOBERNANZA server-side (p.ej. "admin.impersonate.start"). Prefijamos toda
    // confirmación de UI con `ui.confirm:` → queda inequívocamente marcada como intención
    // del cliente, no como un evento del servidor. La no-repudiación del click se conserva.
    await this.audit.record({
      userId,
      action: `ui.confirm:${dto.action}`,
      resource: dto.resource ?? null,
      ip: this.clientIp(req),
      userAgent: (req.headers['user-agent'] as string) ?? null,
      payload: dto.payload,
    });
    return { message: 'ok' };
  }

  @Get()
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Lista la bitácora de auditoría (admin, keyset)' })
  @ApiOkResponse({ type: AuditPageDto })
  list(@Query() query: PageQueryDto): Promise<AuditPageDto> {
    return this.audit.list(query);
  }

  @Get('verify')
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Verifica la integridad de la cadena de auditoría (admin)' })
  @ApiOkResponse({ type: AuditVerifyDto })
  verify(): Promise<AuditVerifyDto> {
    return this.audit.verifyChain();
  }
}

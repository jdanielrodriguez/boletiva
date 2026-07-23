import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChallengePurpose, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChallengesService } from '../auth/challenges.service';
import { PaymentGatewaysService } from './payment-gateways.service';
import {
  CreateGatewayDto,
  GatewayDeleteResponseDto,
  GatewayResponseDto,
  GatewayUnlockResponseDto,
  UpdateGatewayDto,
  UpdateGatewayStatusDto,
} from './dto/payment-gateways.dto';

@ApiTags('payment-gateways')
@ApiBearerAuth()
@UseInterceptors(AuditInterceptor)
@Controller('payment-gateways')
export class PaymentGatewaysController {
  constructor(
    private readonly gateways: PaymentGatewaysService,
    private readonly challenges: ChallengesService,
  ) {}

  @Post('unlock')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Envía un código OTP al correo del admin para autorizar agregar una pasarela',
  })
  @ApiOkResponse({ type: GatewayUnlockResponseDto })
  async unlock(@CurrentUser() admin: { userId: string; email: string }) {
    await this.challenges.issue(admin.userId, admin.email, ChallengePurpose.gateway_unlock);
    return { sent: true };
  }

  @Get()
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Lista todas las pasarelas (admin)' })
  @ApiOkResponse({ type: GatewayResponseDto, isArray: true })
  list() {
    return this.gateways.list();
  }

  @Get('active')
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Pasarelas activas (métodos disponibles; el promotor elige la de su evento)' })
  @ApiOkResponse({ type: GatewayResponseDto, isArray: true })
  active() {
    // Recortado: NO expone credentialsRef (referencia al secreto) al promotor.
    return this.gateways.listActivePublic();
  }

  @Post()
  @Roles(Role.admin)
  @AdminOnly()
  @Audit('admin.gateway.create', { resource: 'gateway' })
  @ApiOperation({ summary: 'Crea una pasarela (admin) — exige código OTP de desbloqueo' })
  @ApiCreatedResponse({ type: GatewayResponseDto })
  async create(@Body() dto: CreateGatewayDto, @CurrentUser('userId') adminId: string) {
    // Acción sensible: validar (y consumir) el OTP antes de crear. 400 si inválido/expirado.
    await this.challenges.consumeByCode(adminId, ChallengePurpose.gateway_unlock, dto.unlockCode);
    return this.gateways.create(dto); // create() mapea campos explícitamente e ignora unlockCode
  }

  @Patch(':id')
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Actualiza una pasarela (admin)' })
  @ApiOkResponse({ type: GatewayResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGatewayDto) {
    return this.gateways.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.admin)
  @AdminOnly()
  @Audit('admin.gateway.status.set', { resource: 'gateway', param: 'id' })
  @ApiOperation({ summary: 'Cambia el estado de una pasarela (admin)' })
  @ApiOkResponse({ type: GatewayResponseDto })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGatewayStatusDto) {
    return this.gateways.setStatus(id, dto.status);
  }

  @Post(':id/make-default')
  @Roles(Role.admin)
  @AdminOnly()
  @Audit('admin.gateway.make_default', { resource: 'gateway', param: 'id' })
  @ApiOperation({ summary: 'Designa la pasarela default de plataforma (admin)' })
  @ApiCreatedResponse({ type: GatewayResponseDto })
  makeDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateways.makeDefault(id);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @AdminOnly()
  @Audit('admin.gateway.delete', { resource: 'gateway', param: 'id' })
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina una pasarela y migra sus eventos a la default (admin)' })
  @ApiOkResponse({ type: GatewayDeleteResponseDto })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateways.remove(id);
  }
}

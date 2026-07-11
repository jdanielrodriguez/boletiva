import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PromoterStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PromotersService } from './promoters.service';
import {
  MyPromoterStatusResponseDto,
  PromoterDecisionDto,
  PromoterInternalNoteResponseDto,
  PromoterListItemDto,
  PromoterStatusEventDto,
  PromoterStatusResponseDto,
  RequireApprovalResponseDto,
  SetPromoterNoteDto,
  SetRequireApprovalDto,
} from './dto/promoters.dto';

@ApiTags('promoters')
@ApiBearerAuth()
@Controller('promoters')
export class PromotersController {
  constructor(private readonly promoters: PromotersService) {}

  @Post('apply')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'Solicita darse de alta como promotor (auto-aprueba en modo pruebas)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  apply(@CurrentUser('userId') userId: string) {
    return this.promoters.apply(userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Mi estado de promotor' })
  @ApiOkResponse({ type: MyPromoterStatusResponseDto })
  me(@CurrentUser('userId') userId: string) {
    return this.promoters.myStatus(userId);
  }

  @Get('settings')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Config de autorización de promotores (admin)' })
  @ApiOkResponse({ type: RequireApprovalResponseDto })
  async settings() {
    return { requireApproval: await this.promoters.requireApproval() };
  }

  @Patch('settings')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Activa/desactiva la exigencia de autorización — "Activar pruebas" (admin)' })
  @ApiOkResponse({ type: RequireApprovalResponseDto })
  setSettings(@Body() dto: SetRequireApprovalDto) {
    return this.promoters.setRequireApproval(dto.requireApproval);
  }

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista de solicitudes de promotor (admin), filtrable por estado' })
  @ApiOkResponse({ type: PromoterListItemDto, isArray: true })
  list(@Query('status') status?: string) {
    if (status && !(status in PromoterStatus)) {
      throw new BadRequestException('Estado de promotor inválido');
    }
    return this.promoters.list(status as PromoterStatus | undefined);
  }

  @Post(':id/approve')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprueba (o reactiva) un promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') adminId: string) {
    return this.promoters.approve(id, adminId);
  }

  @Post(':id/reject')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rechaza una solicitud de promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoterDecisionDto,
    @CurrentUser('userId') adminId: string,
  ) {
    return this.promoters.reject(id, dto.note, adminId);
  }

  @Post(':id/suspend')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspende a un promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoterDecisionDto,
    @CurrentUser('userId') adminId: string,
  ) {
    return this.promoters.suspend(id, dto.note, adminId);
  }

  @Get(':id/history')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Historial append-only de estados de un promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusEventDto, isArray: true })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.promoters.history(id);
  }

  @Patch(':id/note')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Fija/borra la nota interna del admin sobre un promotor (admin)' })
  @ApiOkResponse({ type: PromoterInternalNoteResponseDto })
  setNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPromoterNoteDto) {
    return this.promoters.setInternalNote(id, dto.note ?? null);
  }
}

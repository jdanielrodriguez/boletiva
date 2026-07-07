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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PromoterStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PromotersService } from './promoters.service';
import { PromoterDecisionDto, SetRequireApprovalDto } from './dto/promoters.dto';

@ApiTags('promoters')
@ApiBearerAuth()
@Controller('promoters')
export class PromotersController {
  constructor(private readonly promoters: PromotersService) {}

  @Post('apply')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'Solicita darse de alta como promotor (auto-aprueba en modo pruebas)' })
  apply(@CurrentUser('userId') userId: string) {
    return this.promoters.apply(userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Mi estado de promotor' })
  me(@CurrentUser('userId') userId: string) {
    return this.promoters.myStatus(userId);
  }

  @Get('settings')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Config de autorización de promotores (admin)' })
  async settings() {
    return { requireApproval: await this.promoters.requireApproval() };
  }

  @Patch('settings')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Activa/desactiva la exigencia de autorización — "Activar pruebas" (admin)' })
  setSettings(@Body() dto: SetRequireApprovalDto) {
    return this.promoters.setRequireApproval(dto.requireApproval);
  }

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista de solicitudes de promotor (admin), filtrable por estado' })
  list(@Query('status') status?: string) {
    if (status && !(status in PromoterStatus)) {
      throw new BadRequestException('Estado de promotor inválido');
    }
    return this.promoters.list(status as PromoterStatus | undefined);
  }

  @Post(':id/approve')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprueba un promotor (admin)' })
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.promoters.approve(id);
  }

  @Post(':id/reject')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rechaza una solicitud de promotor (admin)' })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PromoterDecisionDto) {
    return this.promoters.reject(id, dto.note);
  }

  @Post(':id/suspend')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspende a un promotor (admin)' })
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PromoterDecisionDto) {
    return this.promoters.suspend(id, dto.note);
  }
}

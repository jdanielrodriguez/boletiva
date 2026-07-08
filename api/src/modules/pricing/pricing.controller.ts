import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PricingService } from './pricing.service';
import {
  CreateFeeScheduleDto,
  FeeScheduleResponseDto,
  QuoteQueryDto,
  QuoteResponseDto,
} from './dto/pricing.dto';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('schedules')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista todas las versiones de comisiones (admin)' })
  @ApiOkResponse({ type: FeeScheduleResponseDto, isArray: true })
  listSchedules() {
    return this.pricing.listSchedules();
  }

  @Get('schedules/active')
  @ApiOperation({ summary: 'Tabla de comisiones vigente' })
  @ApiOkResponse({ type: FeeScheduleResponseDto })
  active() {
    return this.pricing.activeSchedule();
  }

  @Post('schedules')
  @HttpCode(201)
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Crea y activa una nueva versión de comisiones (admin)' })
  @ApiCreatedResponse({ type: FeeScheduleResponseDto })
  create(@Body() dto: CreateFeeScheduleDto, @CurrentUser('userId') userId: string) {
    return this.pricing.createSchedule(dto, userId);
  }

  @Get('quote')
  @ApiOperation({ summary: 'Cotización de un neto con las comisiones vigentes (preview)' })
  @ApiOkResponse({ type: QuoteResponseDto })
  async quote(@Query() query: QuoteQueryDto) {
    const { version } = await this.pricing.resolveFees();
    const quote = await this.pricing.quote(query.net);
    return { feeScheduleVersion: version, quote };
  }
}

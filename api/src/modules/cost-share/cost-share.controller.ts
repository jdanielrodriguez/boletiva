import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CostShareService } from './cost-share.service';
import {
  DefaultPctResponseDto,
  PromoterCostSharePctResponseDto,
  SetDefaultPctDto,
  SetPromoterPctDto,
} from './dto/cost-share.dto';

@ApiTags('cost-share')
@ApiBearerAuth()
@Controller('cost-share')
export class CostShareController {
  constructor(private readonly costShare: CostShareService) {}

  @Get('default')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Reparto de gastos extra por defecto (admin)' })
  @ApiOkResponse({ type: DefaultPctResponseDto })
  async getDefault() {
    return { defaultPct: await this.costShare.getDefaultPct() };
  }

  @Patch('default')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Fija el reparto por defecto (admin)' })
  @ApiOkResponse({ type: DefaultPctResponseDto })
  setDefault(@Body() dto: SetDefaultPctDto) {
    return this.costShare.setDefaultPct(dto.pct);
  }

  @Get('promoter/:id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Reparto de un promotor: override crudo + efectivo (admin)' })
  @ApiOkResponse({ type: PromoterCostSharePctResponseDto })
  getPromoter(@Param('id', ParseUUIDPipe) id: string) {
    return this.costShare.getPromoter(id);
  }

  @Patch('promoter/:id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Fija el reparto de un promotor (admin)' })
  @ApiOkResponse({ type: PromoterCostSharePctResponseDto })
  setPromoter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPromoterPctDto) {
    return this.costShare.setPromoterPct(id, dto.pct);
  }

  @Delete('promoter/:id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Quita el override del promotor (usa el default global)' })
  @ApiOkResponse({ type: PromoterCostSharePctResponseDto })
  clearPromoter(@Param('id', ParseUUIDPipe) id: string) {
    return this.costShare.setPromoterPct(id, null);
  }
}

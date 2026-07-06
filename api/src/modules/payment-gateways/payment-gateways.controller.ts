import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentGatewaysService } from './payment-gateways.service';
import {
  CreateGatewayDto,
  UpdateGatewayDto,
  UpdateGatewayStatusDto,
} from './dto/payment-gateways.dto';

@ApiTags('payment-gateways')
@ApiBearerAuth()
@Controller('payment-gateways')
export class PaymentGatewaysController {
  constructor(private readonly gateways: PaymentGatewaysService) {}

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista todas las pasarelas (admin)' })
  list() {
    return this.gateways.list();
  }

  @Get('active')
  @ApiOperation({ summary: 'Pasarelas activas (métodos disponibles para cobrar)' })
  active() {
    return this.gateways.listActive();
  }

  @Post()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Crea una pasarela (admin)' })
  create(@Body() dto: CreateGatewayDto) {
    return this.gateways.create(dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Actualiza una pasarela (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGatewayDto) {
    return this.gateways.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Cambia el estado de una pasarela (admin)' })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGatewayStatusDto) {
    return this.gateways.setStatus(id, dto.status);
  }

  @Post(':id/make-default')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Designa la pasarela default de plataforma (admin)' })
  makeDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateways.makeDefault(id);
  }
}

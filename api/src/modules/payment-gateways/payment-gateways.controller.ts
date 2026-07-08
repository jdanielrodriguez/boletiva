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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentGatewaysService } from './payment-gateways.service';
import {
  CreateGatewayDto,
  GatewayDeleteResponseDto,
  GatewayResponseDto,
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
  @ApiOkResponse({ type: GatewayResponseDto, isArray: true })
  list() {
    return this.gateways.list();
  }

  @Get('active')
  @ApiOperation({ summary: 'Pasarelas activas (métodos disponibles para cobrar)' })
  @ApiOkResponse({ type: GatewayResponseDto, isArray: true })
  active() {
    return this.gateways.listActive();
  }

  @Post()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Crea una pasarela (admin)' })
  @ApiCreatedResponse({ type: GatewayResponseDto })
  create(@Body() dto: CreateGatewayDto) {
    return this.gateways.create(dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Actualiza una pasarela (admin)' })
  @ApiOkResponse({ type: GatewayResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGatewayDto) {
    return this.gateways.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Cambia el estado de una pasarela (admin)' })
  @ApiOkResponse({ type: GatewayResponseDto })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGatewayStatusDto) {
    return this.gateways.setStatus(id, dto.status);
  }

  @Post(':id/make-default')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Designa la pasarela default de plataforma (admin)' })
  @ApiCreatedResponse({ type: GatewayResponseDto })
  makeDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateways.makeDefault(id);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina una pasarela y migra sus eventos a la default (admin)' })
  @ApiOkResponse({ type: GatewayDeleteResponseDto })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateways.remove(id);
  }
}

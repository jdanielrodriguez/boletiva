import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SeatHoldService } from './seat-hold.service';
import { CreateHoldDto, HoldSeatsDto } from './dto/inventory.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('events/:eventId/holds')
export class InventoryController {
  constructor(private readonly holds: SeatHoldService) {}

  @Post()
  @HttpCode(201)
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Reserva temporal (hold) de 10 min. Numerada: {seatIds}. General: {localityId, quantity}',
  })
  hold(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateHoldDto,
    @CurrentUser('userId') userId: string,
  ) {
    const hasSeats = Array.isArray(dto.seatIds) && dto.seatIds.length > 0;
    const hasQuantity = dto.localityId != null && dto.quantity != null;
    if (hasSeats && hasQuantity) {
      throw new BadRequestException('Indica asientos (seatIds) O cantidad (localityId+quantity), no ambos');
    }
    if (hasSeats) {
      return this.holds.hold(eventId, dto.seatIds as string[], userId);
    }
    if (hasQuantity) {
      return this.holds.holdByQuantity(eventId, dto.localityId as string, dto.quantity as number, userId);
    }
    throw new BadRequestException('Debes indicar seatIds, o bien localityId y quantity');
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Libera los holds propios de esos asientos' })
  release(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: HoldSeatsDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.holds.release(eventId, dto.seatIds, userId);
  }
}

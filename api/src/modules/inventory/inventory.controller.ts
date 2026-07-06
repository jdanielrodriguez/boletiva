import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SeatHoldService } from './seat-hold.service';
import { HoldSeatsDto } from './dto/inventory.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('events/:eventId/holds')
export class InventoryController {
  constructor(private readonly holds: SeatHoldService) {}

  @Post()
  @HttpCode(201)
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Reserva temporal (hold) de asientos (10 min)' })
  hold(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: HoldSeatsDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.holds.hold(eventId, dto.seatIds, userId);
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

import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BannerService } from './banner.service';
import { BannerResponseDto, GenerateBannerDto } from './dto/banner.dto';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events/:id/banner')
export class BannerController {
  constructor(private readonly banner: BannerService) {}

  @Post()
  @Roles(Role.admin, Role.promoter)
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({ summary: 'Genera (o regenera) el banner del evento con IA' })
  @ApiOkResponse({ type: BannerResponseDto })
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: GenerateBannerDto,
  ) {
    return this.banner.generateForEvent(id, user, dto);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { PresignUploadDto, RegisterMediaDto } from './dto/media.dto';
import {
  MediaResponseDto,
  PresignUploadResponseDto,
  PublicMediaItemDto,
} from './dto/media.response';

@ApiTags('media')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Post('events/:eventId/media/presign')
  @ApiOperation({ summary: 'URL firmada para subir un archivo del evento' })
  @ApiCreatedResponse({ type: PresignUploadResponseDto })
  presign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: PresignUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.media.presignUpload(eventId, dto, user);
  }

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Post('events/:eventId/media')
  @ApiOperation({ summary: 'Registra un archivo ya subido' })
  @ApiCreatedResponse({ type: MediaResponseDto })
  register(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RegisterMediaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.media.register(eventId, dto, user);
  }

  @Public()
  @Get('events/:eventId/media')
  @ApiOperation({ summary: 'Media del evento (URLs firmadas)' })
  @ApiOkResponse({ type: PublicMediaItemDto, isArray: true })
  list(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.media.listPublic(eventId);
  }

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Delete('media/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina un archivo del evento' })
  @ApiNoContentResponse({ description: 'Media eliminada' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.media.remove(id, user);
  }
}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';

export class CreateThreadDto {
  @ApiProperty({ example: 'Duda con mi evento' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  subject!: string;

  @ApiProperty({ example: 'Hola, tengo una duda sobre las comisiones.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

export class PostMessageDto {
  @ApiProperty({ example: 'Gracias, ya lo revisé.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class AssignThreadDto {
  @ApiProperty({ format: 'uuid', description: 'Asesor/admin al que se reasigna el hilo' })
  @IsUUID()
  assignedToId!: string;
}

/**
 * Chat de soporte (B3). El promotor PREMIUM abre hilos y escribe; asesor/admin
 * responden. La entrega en vivo va por socket.io (ChatGateway); estos endpoints
 * cubren el historial y el ruteo. Gating (chat.enabled + premium) en el servicio.
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('threads')
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({ summary: 'Abre un hilo de soporte (promotor premium)' })
  createThread(@CurrentUser() user: AuthUser, @Body() dto: CreateThreadDto) {
    return this.chat.createThread(user, dto.subject, dto.message);
  }

  @Get('threads')
  @ApiOperation({ summary: 'Lista de hilos (promotor: los suyos; agente: todos)' })
  listThreads(@CurrentUser() user: AuthUser) {
    return this.chat.listThreads(user);
  }

  @Get('threads/:id/messages')
  @ApiOperation({ summary: 'Historial de mensajes de un hilo' })
  messages(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.getMessages(id, user);
  }

  @Post('threads/:id/messages')
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({ summary: 'Publica un mensaje en un hilo' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: PostMessageDto) {
    return this.chat.postMessage(id, user, dto.body);
  }

  @Post('threads/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cierra un hilo' })
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.close(id, user);
  }

  @Post('threads/:id/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reabre un hilo' })
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.reopen(id, user);
  }

  @Post('threads/:id/assign')
  @Roles(Role.admin)
  @AdminOnly() // reasignar (handoff) es exclusivo del admin (un asesor no se auto-asigna)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reasigna un hilo a un asesor/admin (handoff, admin)' })
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignThreadDto) {
    return this.chat.assign(id, dto.assignedToId);
  }
}

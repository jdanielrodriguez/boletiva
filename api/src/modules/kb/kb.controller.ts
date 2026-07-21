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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContentStatus, Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { KbService } from './kb.service';
import { KbAutoResponderService } from './kb-auto-responder.service';
import {
  CreateKbArticleDto,
  KbArticleResponseDto,
  KbListQueryDto,
  KbPublicArticleDto,
  KbSearchQueryDto,
  KbSuggestionDto,
  UpdateKbArticleDto,
} from './dto/kb.dto';

/**
 * Base de Conocimientos (T6). Lecturas PÚBLICAS (FAQ + búsqueda del bot) y gestión de
 * admin/asesor. NOTA de orden: las rutas estáticas (`search`, `admin`) se declaran ANTES
 * de `:slug` para que Express no las tome como slug.
 */
@ApiTags('kb')
@Controller('kb')
export class KbController {
  constructor(
    private readonly kb: KbService,
    private readonly autoResponder: KbAutoResponderService,
  ) {}

  // ---- Público ----

  @Get()
  @Public()
  @ApiOperation({ summary: 'FAQ público: artículos publicados (filtro categoría/idioma/búsqueda)' })
  @ApiOkResponse({ type: KbPublicArticleDto, isArray: true })
  list(@Query() query: KbListQueryDto) {
    return this.kb.listPublic(query);
  }

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Búsqueda del FAQ/bot: sugiere artículos públicos relevantes (autoresponder)' })
  @ApiOkResponse({ type: KbSuggestionDto, isArray: true })
  search(@Query() query: KbSearchQueryDto) {
    return this.autoResponder.suggest(query.q, { locale: query.locale, limit: query.limit });
  }

  // ---- Gestión (admin/asesor) ----

  @Get('admin')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listado de gestión (cualquier estado/visibilidad) — admin/asesor' })
  @ApiOkResponse({ type: KbArticleResponseDto, isArray: true })
  adminList(@Query() query: KbListQueryDto) {
    return this.kb.adminList(query);
  }

  @Get('admin/suggest')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Asistente del agente: sugiere artículos (incluye INTERNOS) para responder' })
  @ApiOkResponse({ type: KbSuggestionDto, isArray: true })
  agentSuggest(@Query() query: KbSearchQueryDto) {
    return this.autoResponder.suggest(query.q, {
      locale: query.locale,
      limit: query.limit,
      includeInternal: true,
    });
  }

  @Get('admin/:id')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalle de gestión por id — admin/asesor' })
  @ApiOkResponse({ type: KbArticleResponseDto })
  adminGet(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.adminGet(id);
  }

  @Post()
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea un artículo (draft) — admin/asesor' })
  @ApiOkResponse({ type: KbArticleResponseDto })
  create(@Body() dto: CreateKbArticleDto, @CurrentUser('userId') userId: string) {
    return this.kb.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edita un artículo — admin/asesor' })
  @ApiOkResponse({ type: KbArticleResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKbArticleDto) {
    return this.kb.update(id, dto);
  }

  @Post(':id/publish')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Publica un artículo — admin/asesor' })
  @ApiOkResponse({ type: KbArticleResponseDto })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.setStatus(id, ContentStatus.published);
  }

  @Post(':id/unpublish')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Despublica un artículo (vuelve a draft) — admin/asesor' })
  @ApiOkResponse({ type: KbArticleResponseDto })
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.setStatus(id, ContentStatus.draft);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina un artículo — admin/asesor' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.remove(id);
  }

  // ---- Público: detalle por slug (AL FINAL para no capturar rutas estáticas) ----

  @Get(':slug')
  @Public()
  @ApiOperation({ summary: 'Detalle público de un artículo por slug (FAQ)' })
  @ApiOkResponse({ type: KbPublicArticleDto })
  getBySlug(@Param('slug') slug: string) {
    return this.kb.getPublicBySlug(slug);
  }
}

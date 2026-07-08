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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/categories.dto';
import { CategoryResponseDto } from './dto/categories.response';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lista categorías (activas por defecto)' })
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  list(@Query('all') all?: string) {
    return this.categories.list(all !== 'true');
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Categoría por slug' })
  @ApiOkResponse({ type: CategoryResponseDto })
  getBySlug(@Param('slug') slug: string) {
    return this.categories.getBySlug(slug);
  }

  @Post()
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea categoría (admin)' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  create(@Body() dto: CreateCategoryDto, @CurrentUser('userId') userId: string) {
    return this.categories.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualiza categoría (admin)' })
  @ApiOkResponse({ type: CategoryResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina categoría (admin)' })
  @ApiNoContentResponse({ description: 'Categoría eliminada' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }
}

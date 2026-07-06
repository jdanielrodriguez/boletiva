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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/categories.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lista categorías (activas por defecto)' })
  list(@Query('all') all?: string) {
    return this.categories.list(all !== 'true');
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Categoría por slug' })
  getBySlug(@Param('slug') slug: string) {
    return this.categories.getBySlug(slug);
  }

  @Post()
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea categoría (admin)' })
  create(@Body() dto: CreateCategoryDto, @CurrentUser('userId') userId: string) {
    return this.categories.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualiza categoría (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina categoría (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }
}

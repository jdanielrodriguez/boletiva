import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { slugify, slugWithSuffix } from '../../common/utils/slug';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/categories.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    const exists = await this.prisma.category.findUnique({ where: { slug: base } });
    return exists ? slugWithSuffix(name, Date.now().toString(36).slice(-4)) : base;
  }

  list(onlyActive = true) {
    const where: Prisma.CategoryWhereInput = onlyActive ? { active: true } : {};
    return this.prisma.category.findMany({ where, orderBy: { name: 'asc' } });
  }

  async getBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }

  async create(dto: CreateCategoryDto, userId: string) {
    return this.prisma.category.create({
      data: {
        name: dto.name,
        description: dto.description,
        active: dto.active ?? true,
        slug: await this.uniqueSlug(dto.name),
        createdById: userId,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.getById(id);
    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        active: dto.active,
      },
    });
  }

  async remove(id: string) {
    await this.getById(id);
    // Event.category es onDelete:SetNull, así que borrar NO dispararía una
    // violación de FK; verificamos explícitamente para hacer valer la regla de
    // negocio de no borrar una categoría en uso.
    const inUse = await this.prisma.event.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw new ConflictException('La categoría tiene eventos asociados');
    }
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('La categoría tiene eventos asociados');
      }
      throw err;
    }
  }

  private async getById(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }
}

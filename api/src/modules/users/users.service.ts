import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UpdateProfileDto, UpdateUserRolesDto, UpdateUserStatusDto } from './dto/users.dto';

// Nunca exponer passwordHash.
const publicSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  roles: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: publicSelect });
  }

  async list(params: { skip?: number; take?: number; search?: string }) {
    const { skip = 0, take = 20, search } = params;
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: publicSelect,
        skip,
        take: Math.min(take, 100),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicSelect });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async setRoles(id: string, dto: UpdateUserRolesDto) {
    await this.get(id);
    return this.prisma.user.update({
      where: { id },
      data: { roles: dto.roles },
      select: publicSelect,
    });
  }

  async setStatus(id: string, dto: UpdateUserStatusDto) {
    await this.get(id);
    return this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      select: publicSelect,
    });
  }
}

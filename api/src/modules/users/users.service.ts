import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';
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
  language: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: publicSelect });
  }

  async list(params: KeysetQuery & { search?: string }) {
    const { search } = params;
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.user.findMany({
      where,
      select: publicSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(params),
    });
    return keysetResult(rows, params);
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

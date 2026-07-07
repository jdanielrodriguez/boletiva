import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Event, GatewayStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { slugify, slugWithSuffix } from '../../common/utils/slug';
import { PromotersService } from '../promoters/promoters.service';
import { CreateEventDto, UpdateEventDto } from './dto/events.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promoters: PromotersService,
  ) {}

  private assertDates(startsAt?: string, endsAt?: string) {
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }
  }

  /** La pasarela elegida debe existir y estar activa. */
  private async assertGatewayActive(gatewayId?: string): Promise<void> {
    if (!gatewayId) return;
    const gw = await this.prisma.paymentGateway.findUnique({ where: { id: gatewayId } });
    if (!gw || gw.status !== GatewayStatus.active) {
      throw new BadRequestException('La pasarela indicada no existe o no está activa');
    }
  }

  private canManage(event: Event, user: AuthUser): boolean {
    return user.roles.includes(Role.admin) || event.promoterId === user.userId;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    const exists = await this.prisma.event.findUnique({ where: { slug: base } });
    return exists ? slugWithSuffix(name, Date.now().toString(36).slice(-4)) : base;
  }

  async listPublic(params: {
    skip?: number;
    take?: number;
    categorySlug?: string;
    search?: string;
  }) {
    const { skip = 0, take = 20, categorySlug, search } = params;
    const where: Prisma.EventWhereInput = {
      status: 'published',
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        skip,
        take: Math.min(take, 100),
        orderBy: { startsAt: 'asc' },
        include: { category: true, media: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.event.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async getPublicBySlug(slug: string) {
    const event = await this.prisma.event.findFirst({
      where: { slug, status: 'published' },
      include: {
        category: true,
        media: { orderBy: { position: 'asc' } },
        localities: { orderBy: { name: 'asc' } },
      },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    return event;
  }

  listMine(userId: string) {
    return this.prisma.event.findMany({
      where: { promoterId: userId },
      orderBy: { createdAt: 'desc' },
      include: { category: true, _count: { select: { localities: true } } },
    });
  }

  async getManaged(id: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { category: true, media: true, localities: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (!this.canManage(event, user)) throw new ForbiddenException('No es tu evento');
    return event;
  }

  async create(dto: CreateEventDto, userId: string) {
    // Solo un promotor autorizado por un admin (o un admin) puede crear eventos.
    await this.promoters.assertCanOperate(userId);
    this.assertDates(dto.startsAt, dto.endsAt);
    await this.assertGatewayActive(dto.gatewayId);
    return this.prisma.event.create({
      data: {
        promoterId: userId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug: await this.uniqueSlug(dto.name),
        description: dto.description,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        gatewayId: dto.gatewayId,
        ivaOnNet: dto.ivaOnNet,
        status: 'draft',
      },
    });
  }

  async update(id: string, dto: UpdateEventDto, user: AuthUser) {
    const event = await this.getManaged(id, user);
    this.assertDates(
      dto.startsAt ?? event.startsAt.toISOString(),
      dto.endsAt ?? event.endsAt.toISOString(),
    );
    // Con la pasarela ya congelada (evento con compras) no se puede cambiar la
    // pasarela ni el IVA: alteraría un precio que ya no debe cambiar.
    const changesPricing = dto.gatewayId !== undefined || dto.ivaOnNet !== undefined;
    if (changesPricing && event.frozenGatewayId) {
      throw new ConflictException(
        'El evento ya tiene compras; su pasarela e IVA quedaron congelados',
      );
    }
    await this.assertGatewayActive(dto.gatewayId);
    return this.prisma.event.update({
      where: { id },
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        gatewayId: dto.gatewayId,
        ivaOnNet: dto.ivaOnNet,
      },
    });
  }

  async setStatus(id: string, status: 'published' | 'cancelled', user: AuthUser) {
    const event = await this.getManaged(id, user);
    if (status === 'published') {
      // Publicar requiere estar autorizado como promotor (o ser admin).
      await this.promoters.assertCanOperate(user.userId);
      if (event.localities.length === 0) {
        throw new BadRequestException('El evento necesita al menos una localidad para publicarse');
      }
    }
    return this.prisma.event.update({ where: { id }, data: { status } });
  }

  async remove(id: string, user: AuthUser) {
    const event = await this.getManaged(id, user);
    if (event.status === 'published') {
      throw new BadRequestException('No se puede eliminar un evento publicado; cancélalo primero');
    }
    await this.prisma.event.delete({ where: { id } });
  }
}

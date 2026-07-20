import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Event, GatewayStatus, Prisma, PromoterStatus, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { slugify, slugWithSuffix } from '../../common/utils/slug';
import { PromotersService } from '../promoters/promoters.service';
import { PremiumService } from '../promoters/premium.service';
import { PricingService } from '../pricing/pricing.service';
import { PriceQuote } from '../pricing/pricing.engine';
import { CostShareService } from '../cost-share/cost-share.service';
import { PaymentGatewaysService } from '../payment-gateways/payment-gateways.service';
import { EditUnlockService } from './edit-unlock.service';
import { CreateEventDto, UpdateEventDto } from './dto/events.dto';

/** URLs firmadas de media públicas: expiran holgadamente para sobrevivir al
 * cache del edge de la página (HTML cacheado no debe apuntar a URLs vencidas). */
const PUBLIC_MEDIA_URL_TTL = 3600;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promoters: PromotersService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly redis: RedisService,
    private readonly costShare: CostShareService,
    private readonly gateways: PaymentGatewaysService,
    private readonly editUnlock: EditUnlockService,
    private readonly premium: PremiumService,
  ) {}

  /**
   * Resuelve los datos de ubicación: si se indicó un salón, valida que exista y
   * PREFIJA address/lat/lng que vengan vacíos con los del salón (el promotor puede
   * sobrescribirlos). Devuelve los valores efectivos + el hallId a persistir.
   */
  private async resolveLocation(
    dto: { hallId?: string; address?: string; lat?: number; lng?: number },
  ): Promise<{ hallId?: string; address?: string; lat?: number; lng?: number }> {
    if (!dto.hallId) {
      return { hallId: dto.hallId, address: dto.address, lat: dto.lat, lng: dto.lng };
    }
    const hall = await this.prisma.hall.findUnique({ where: { id: dto.hallId } });
    if (!hall) throw new BadRequestException('El salón indicado no existe');
    return {
      hallId: hall.id,
      address: dto.address ?? hall.address ?? undefined,
      lat: dto.lat ?? hall.lat ?? undefined,
      lng: dto.lng ?? hall.lng ?? undefined,
    };
  }

  /** Añade una URL firmada a cada media (para catálogo/SEO/og:image). */
  private async signMedia<T extends { media: { key: string }[] }>(
    entity: T,
  ): Promise<T & { media: (T['media'][number] & { url: string })[] }> {
    const media = await Promise.all(
      entity.media.map(async (m) => ({
        ...m,
        url: await this.storage.signedGetUrl(m.key, PUBLIC_MEDIA_URL_TTL),
      })),
    );
    return { ...entity, media };
  }

  private assertDates(startsAt?: string, endsAt?: string) {
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      throw new BadRequestException('endsAt debe ser posterior a startsAt');
    }
  }

  /**
   * Un evento CONCLUIDO (terminado por fecha, finalizado o cancelado) es de SOLO
   * LECTURA: no se edita/publica/suspende/cancela/elimina — solo se ven sus cuentas.
   * Guarda authoritative para todas las mutaciones del ciclo de vida del evento.
   */
  private assertNotConcluded(event: { endsAt: Date | null; status: string }): void {
    const ended = !!event.endsAt && new Date(event.endsAt).getTime() < Date.now();
    if (ended || event.status === 'finished' || event.status === 'cancelled') {
      throw new ConflictException('El evento ya concluyó; solo puedes ver sus cuentas.');
    }
  }

  /**
   * El promotor solo indica el INICIO; el fin es opcional en la UI. Si no viene,
   * se autocalcula `startsAt + 12h` (decisión del arquitecto): la columna sigue
   * NOT NULL y la retención/"eventos pasados" mantienen un fin coherente.
   */
  private resolveEndsAt(startsAt: Date, endsAt?: string): Date {
    if (endsAt) return new Date(endsAt);
    return new Date(startsAt.getTime() + 12 * 60 * 60 * 1000);
  }

  /**
   * La pasarela elegida debe existir, estar activa y el PROMOTOR debe calificar
   * para usarla (Ola 6.6: su cost-share ≥ `minCostSharePct` de la pasarela; la
   * default del sistema siempre está disponible).
   */
  private async assertGatewayActive(gatewayId?: string, promoterId?: string): Promise<void> {
    if (!gatewayId) return;
    const gw = await this.prisma.paymentGateway.findUnique({ where: { id: gatewayId } });
    if (!gw || gw.status !== GatewayStatus.active) {
      throw new BadRequestException('La pasarela indicada no existe o no está activa');
    }
    if (promoterId) {
      const promoterPct = await this.costShare.effectivePct(promoterId);
      if (!this.costShare.gatewayAllowed(gw, promoterPct)) {
        throw new BadRequestException(
          'Tu nivel de colaboración no habilita esta pasarela; solicita un ajuste al administrador',
        );
      }
    }
  }

  /**
   * Ancla a los usuarios de PRUEBA (isTestUser) a la pasarela Sandbox: aunque
   * elijan otra, sus eventos cobran por el simulador (no contaminan métricas de
   * pasarelas reales). Devuelve el gatewayId efectivo. Requisito del arquitecto.
   */
  private async anchorGatewayForTestUser(
    promoterId: string,
    gatewayId?: string,
  ): Promise<string | undefined> {
    const promoter = await this.prisma.user.findUnique({
      where: { id: promoterId },
      select: { isTestUser: true },
    });
    if (!promoter?.isTestUser) return gatewayId;
    const sandbox = await this.gateways.sandboxGateway();
    if (!sandbox) {
      throw new BadRequestException('No hay una pasarela Sandbox activa para usuarios de prueba');
    }
    return sandbox.id;
  }

  private canManage(event: Event, user: AuthUser): boolean {
    return user.roles.includes(Role.admin) || event.promoterId === user.userId;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    const exists = await this.prisma.event.findUnique({ where: { slug: base } });
    return exists ? slugWithSuffix(name, Date.now().toString(36).slice(-4)) : base;
  }

  /**
   * Ciclo de vida por FECHA: un evento se vende y se muestra en el inicio solo mientras
   * está publicado y NO ha iniciado (`startsAt` en el futuro). Al iniciar pasa a "en
   * curso" (fuera del inicio, ventas cerradas, el promotor valida boletos) y al terminar
   * queda "concluido" (listo para liquidar). `salesOpen` = fuente de verdad de la venta.
   */
  private salesOpen(event: { status: string; startsAt: Date }): boolean {
    return event.status === 'published' && event.startsAt.getTime() > Date.now();
  }
  private assertSalesOpen(event: { status: string; startsAt: Date }): void {
    if (!this.salesOpen(event)) {
      throw new ConflictException('Las ventas de este evento están cerradas');
    }
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
      // Solo eventos por venir: los que ya iniciaron (en curso) o concluyeron no van al inicio.
      startsAt: { gt: new Date() },
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
    const signed = await Promise.all(items.map((ev) => this.signMedia(ev)));
    return { items: signed, total, skip, take };
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
    return this.signMedia(event);
  }

  /**
   * Disponibilidad pública para la pantalla de compra (F2): mapa activo +
   * localidades con el PRECIO all-in del comprador (boleto + serviceFee + IVA,
   * server-authoritative) + asientos con coordenadas (solo localidades con
   * geometría; las GA se compran por cantidad → solo `available`).
   */
  async getAvailability(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: 'published' },
      include: { localities: { orderBy: { name: 'asc' } } },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    // Ventas cerradas si el evento ya inició o concluyó → no se puede comprar.
    this.assertSalesOpen(event);

    const seatMap = await this.prisma.seatMap.findFirst({ where: { eventId, active: true } });

    // Asientos `available` en BD (para conteos y para marcar los que están
    // RESERVADOS en Redis: un hold no cambia el estado en BD, pero para el
    // comprador un asiento reservado por otra persona NO está disponible).
    const available = await this.prisma.seat.findMany({
      where: { locality: { eventId }, status: 'available' },
      select: { id: true, localityId: true },
    });
    const held = await this.heldSet(
      eventId,
      available.map((s) => s.id),
    );

    // Cupos realmente disponibles = available en BD y NO reservados en Redis.
    const availByLoc = new Map<string, number>();
    for (const s of available) {
      if (!held.has(s.id)) availByLoc.set(s.localityId, (availByLoc.get(s.localityId) ?? 0) + 1);
    }

    const localities = await Promise.all(
      event.localities.map(async (loc) => ({
        id: loc.id,
        name: loc.name,
        slug: loc.slug,
        kind: loc.kind,
        capacity: loc.capacity,
        available: availByLoc.get(loc.id) ?? 0,
        price: loc.desiredNet
          ? this.toPublicPrice(await this.pricing.quoteForEvent(loc.desiredNet.toString(), event))
          : null,
      })),
    );

    // Asientos individuales SOLO para localidades con coordenadas (seated). Un
    // asiento `available` pero reservado en Redis se reporta como `held`
    // (ocupado para el comprador; se libera al expirar la reserva).
    const seated = await this.prisma.seat.findMany({
      where: { locality: { eventId }, x: { not: null } },
      select: {
        id: true,
        localityId: true,
        label: true,
        section: true,
        row: true,
        x: true,
        y: true,
        status: true,
      },
      orderBy: { label: 'asc' },
    });
    const seats = seated.map((s) =>
      s.status === 'available' && held.has(s.id) ? { ...s, status: 'held' as const } : s,
    );

    return { seatMap, localities, seats };
  }

  /** IDs (de entre los dados) que están reservados en Redis (hold vigente). */
  private async heldSet(eventId: string, seatIds: string[]): Promise<Set<string>> {
    if (seatIds.length === 0) return new Set();
    const keys = seatIds.map((id) => `hold:${eventId}:${id}`);
    const holders = await this.redis.getClient().mget(...keys);
    const held = new Set<string>();
    holders.forEach((h, i) => {
      if (h !== null) held.add(seatIds[i]);
    });
    return held;
  }

  /** Desglose que ve el comprador (plataforma+pasarela fusionadas en serviceFee). */
  private toPublicPrice(q: PriceQuote) {
    return { currency: q.currency, net: q.net, serviceFee: q.serviceFee, iva: q.iva, total: q.total };
  }

  listMine(userId: string) {
    return this.prisma.event.findMany({
      where: { promoterId: userId },
      orderBy: { createdAt: 'desc' },
      include: { category: true, _count: { select: { localities: true } } },
    });
  }

  /** Todos los eventos (admin), con su promotor, ordenados por fecha de inicio. */
  listAll() {
    return this.prisma.event.findMany({
      orderBy: { startsAt: 'desc' },
      include: {
        category: true,
        promoter: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { localities: true } },
      },
    });
  }

  async getManaged(id: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { category: true, media: { orderBy: { position: 'asc' } }, localities: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (!this.canManage(event, user)) throw new ForbiddenException('No es tu evento');
    // Firma la media (banner/galería) para que el editor pueda previsualizarla.
    const signed = await this.signMedia(event);
    // Boletos vendidos (server-authoritative): ítems activos de órdenes pagadas.
    // Alimenta el aviso del editor ("hay boletos vendidos → ejecutar devoluciones").
    const soldTicketsCount = await this.soldTicketsCount(id);
    return { ...signed, soldTicketsCount };
  }

  /** Boletos vendidos de un evento: ítems ACTIVOS de órdenes PAGADAS (== ticketsSold). */
  private soldTicketsCount(eventId: string): Promise<number> {
    return this.prisma.orderItem.count({
      where: { order: { eventId, status: 'paid' }, active: true },
    });
  }

  async create(dto: CreateEventDto, user: AuthUser) {
    // El evento SIEMPRE pertenece a un PROMOTOR. Un ADMIN puede crearlo a nombre de
    // otro promotor (aprobado) enviando `promoterId`; queda auditado en
    // `createdByAdminId`. Un promotor no-admin ignora cualquier `promoterId` ajeno
    // y crea el evento a su propio nombre.
    const isAdmin = user.roles.includes(Role.admin);
    let ownerId = user.userId;
    let createdByAdminId: string | undefined;
    if (isAdmin && dto.promoterId && dto.promoterId !== user.userId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.promoterId },
        select: { id: true, promoterStatus: true },
      });
      if (!target) throw new NotFoundException('El promotor indicado no existe');
      if (target.promoterStatus !== PromoterStatus.approved) {
        throw new UnprocessableEntityException(
          'El usuario indicado no es un promotor aprobado; no se le puede asignar el evento',
        );
      }
      ownerId = target.id;
      createdByAdminId = user.userId;
    }
    // Solo un promotor autorizado por un admin (o un admin) puede crear eventos.
    await this.promoters.assertCanOperate(ownerId);
    this.assertDates(dto.startsAt, dto.endsAt);
    const gatewayId = await this.anchorGatewayForTestUser(ownerId, dto.gatewayId);
    await this.assertGatewayActive(gatewayId, ownerId);
    const loc = await this.resolveLocation(dto);
    const startsAt = new Date(dto.startsAt);
    return this.prisma.event.create({
      data: {
        promoterId: ownerId,
        createdByAdminId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug: await this.uniqueSlug(dto.name),
        description: dto.description,
        hallId: loc.hallId,
        address: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        startsAt,
        endsAt: this.resolveEndsAt(startsAt, dto.endsAt),
        gatewayId,
        ivaOnNet: dto.ivaOnNet,
        absorbInstallmentCost: dto.absorbInstallmentCost,
        // Destacar (slider del inicio) es SOLO admin: un promotor no puede autopromocionarse.
        promotedPriority: isAdmin ? dto.promotedPriority : undefined,
        status: 'draft',
      },
      include: {
        promoter: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /**
   * Destacar/quitar un evento del slider del inicio (SOLO admin). featured → prioridad 0
   * (primero); false → null (sale del slider). El slider ya filtra a futuros publicados y
   * se oculta si no hay ninguno. Devuelve el detalle gestionable actualizado.
   */
  async setPromoted(id: string, featured: boolean, user: AuthUser) {
    await this.getManaged(id, user); // 404/403 si no existe o no lo gestiona
    // Beneficio PREMIUM (B1): un promotor puede destacar SU evento solo si sus beneficios
    // premium están activos (con premium apagado, aplica a todos). El admin destaca cualquiera.
    if (!user.roles.includes(Role.admin) && !(await this.premium.benefitsActive(user.userId))) {
      throw new ForbiddenException('Destacar eventos es un beneficio premium');
    }
    await this.prisma.event.update({
      where: { id },
      data: { promotedPriority: featured ? 0 : null },
    });
    return this.getManaged(id, user);
  }

  /** Eventos destacados (slider del inicio), ordenados por prioridad ascendente. */
  async listPromoted(take = 10) {
    const events = await this.prisma.event.findMany({
      where: { status: 'published', promotedPriority: { not: null }, startsAt: { gt: new Date() } },
      orderBy: { promotedPriority: 'asc' },
      take: Math.min(take, 20),
      include: { category: true, media: { orderBy: { position: 'asc' } } },
    });
    return Promise.all(events.map((e) => this.signMedia(e)));
  }

  async update(id: string, dto: UpdateEventDto, user: AuthUser, unlockToken?: string) {
    const event = await this.getManaged(id, user);
    this.assertNotConcluded(event);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    // Si el promotor mueve el inicio (sin enviar fin, que ya no está en la UI) a un
    // punto que dejaría el fin anterior en el pasado, recalculamos el fin (+12h)
    // para no romper con un 400 confuso.
    let effectiveEndsAt = dto.endsAt;
    if (dto.startsAt && !dto.endsAt && new Date(dto.startsAt) >= event.endsAt) {
      effectiveEndsAt = this.resolveEndsAt(new Date(dto.startsAt)).toISOString();
    }
    this.assertDates(
      dto.startsAt ?? event.startsAt.toISOString(),
      effectiveEndsAt ?? event.endsAt.toISOString(),
    );
    // Con la pasarela ya congelada (evento con compras) no se puede cambiar la
    // pasarela ni el IVA en un evento a la venta: alteraría un precio que ya no
    // debe cambiar. EXCEPCIÓN v3.10: un evento SUSPENDIDO está en reconfiguración
    // (no se vende) → SÍ puede cambiar de pasarela/IVA; las órdenes ya pagadas
    // conservan su snapshot inmutable y las ventas futuras usan la nueva pasarela.
    const changesPricing = dto.gatewayId !== undefined || dto.ivaOnNet !== undefined;
    const isReconfiguring = event.status === 'suspended';
    if (changesPricing && event.frozenGatewayId && !isReconfiguring) {
      throw new ConflictException(
        'El evento ya tiene compras; su pasarela e IVA quedaron congelados. Suspéndelo para reconfigurarlo.',
      );
    }
    // Cambiar el SALÓN altera la ubicación/layout: solo se permite mientras el
    // evento es reconfigurable (draft o suspendido). En un evento PUBLICADO hay
    // que suspenderlo primero (así deja de venderse mientras se reorganiza).
    const changesHall = dto.hallId !== undefined && dto.hallId !== event.hallId;
    if (changesHall && event.status === 'published') {
      const sold = await this.soldTicketsCount(id);
      const soldNote =
        sold > 0
          ? ` Este evento tiene ${sold} boleto(s) vendido(s): al suspenderlo podrás reorganizar el salón y sus boletos se migrarán al nuevo mapa.`
          : '';
      throw new ConflictException(
        `No puedes cambiar el salón de un evento publicado; suspéndelo para reconfigurarlo.${soldNote}`,
      );
    }
    const gatewayId =
      dto.gatewayId !== undefined
        ? await this.anchorGatewayForTestUser(event.promoterId, dto.gatewayId)
        : undefined;
    await this.assertGatewayActive(gatewayId, event.promoterId);
    const loc = await this.resolveLocation(dto);
    // Al reconfigurar (suspendido) la pasarela, re-congela a la nueva para que las
    // ventas futuras usen el precio coherente (los pagos previos ya están fijados).
    const reFreezeGateway =
      isReconfiguring && dto.gatewayId !== undefined && event.frozenGatewayId
        ? gatewayId ?? null
        : undefined;
    return this.prisma.event.update({
      where: { id },
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        hallId: loc.hallId,
        address: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: effectiveEndsAt ? new Date(effectiveEndsAt) : undefined,
        gatewayId,
        frozenGatewayId: reFreezeGateway,
        ivaOnNet: dto.ivaOnNet,
        // El flag de absorción de cuotas NO congela el precio base (el costo de
        // cuotas se resuelve al pagar): se puede ajustar aunque haya compras.
        absorbInstallmentCost: dto.absorbInstallmentCost,
        // Destacar solo lo cambia un admin (o vía el endpoint /promote); ignorado para promotor.
        promotedPriority: user.roles.includes(Role.admin) ? dto.promotedPriority : undefined,
      },
    });
  }

  async setStatus(
    id: string,
    status: 'published' | 'cancelled',
    user: AuthUser,
    unlockToken?: string,
  ) {
    const event = await this.getManaged(id, user);
    this.assertNotConcluded(event);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    if (status === 'published') {
      // Un evento cancelado/finalizado es terminal: no se re-publica. Un evento
      // SUSPENDIDO sí (estaba en reconfiguración) → pasa el mismo gate de publicar.
      if (event.status === 'cancelled' || event.status === 'finished') {
        throw new ConflictException('Un evento cancelado o finalizado no puede publicarse');
      }
      // Publicar requiere estar autorizado como promotor (o ser admin).
      await this.promoters.assertCanOperate(user.userId);
      if (event.localities.length === 0) {
        throw new BadRequestException('El evento necesita al menos una localidad para publicarse');
      }
      await this.assertPublishable(event);
    }
    return this.prisma.event.update({ where: { id }, data: { status } });
  }

  /**
   * SUSPENDE un evento publicado (v3.7): lo DESPUBLICA (deja de estar visible/
   * vendible en los listados y la disponibilidad públicos) y lo pone en modo
   * RECONFIGURACIÓN — a diferencia de `cancel` (terminal), un suspendido puede
   * volver a editarse (salón/plantilla/localidades/asientos) y RE-PUBLICARSE.
   * Solo aplica desde `published`. Admin no-dueño requiere token de desbloqueo.
   */
  async suspend(id: string, user: AuthUser, unlockToken?: string) {
    const event = await this.getManaged(id, user);
    this.assertNotConcluded(event);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    if (event.status !== 'published') {
      throw new ConflictException('Solo un evento publicado puede suspenderse');
    }
    return this.prisma.event.update({ where: { id }, data: { status: 'suspended' } });
  }

  /**
   * Requisitos para publicar (además de tener ≥1 localidad):
   *  (a) el evento DEBE tener un banner (media `cover`);
   *  (b) toda localidad `seated` DEBE tener al menos un asiento colocado (con
   *      coordenadas). Las `general` se venden por aforo y no requieren mapa.
   * Devuelve 422 con un mensaje que dice exactamente qué falta.
   */
  private async assertPublishable(
    event: Event & { media: { kind: string }[]; localities: { id: string; name: string; kind: string }[] },
  ): Promise<void> {
    const hasBanner = event.media.some((m) => m.kind === 'cover');
    if (!hasBanner) {
      throw new UnprocessableEntityException(
        'El evento necesita un banner (imagen) para publicarse. Agrega un banner.',
      );
    }
    const seated = event.localities.filter((l) => l.kind === 'seated');
    if (seated.length > 0) {
      const placed = await this.prisma.seat.groupBy({
        by: ['localityId'],
        where: { localityId: { in: seated.map((l) => l.id) }, x: { not: null } },
        _count: { _all: true },
      });
      const withSeats = new Set(placed.map((p) => p.localityId));
      const missing = seated.find((l) => !withSeats.has(l.id));
      if (missing) {
        throw new UnprocessableEntityException(
          `La localidad "${missing.name}" no tiene asientos colocados. Agrega asientos en el editor o cámbiala a general.`,
        );
      }
    }
  }

  async remove(id: string, user: AuthUser, unlockToken?: string) {
    const event = await this.getManaged(id, user);
    this.assertNotConcluded(event);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    if (event.status === 'published') {
      throw new BadRequestException('No se puede eliminar un evento publicado; cancélalo primero');
    }
    await this.prisma.event.delete({ where: { id } });
  }
}

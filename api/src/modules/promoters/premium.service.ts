import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PromoterTier } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.types';

/** Config del perfil premium resuelta de los settings (con defaults). */
export interface PremiumConfig {
  enabled: boolean;
  trialEnabled: boolean;
  trialDays: number;
}

/**
 * Perfil PREMIUM del promotor (B1). Un promotor puede ser `free` o `premium`; premium
 * desbloquea beneficios (chat de soporte, destacar SU propio evento, dashboards
 * avanzados). Reglas (settings admin):
 *  - `premium.enabled=false` → NO hay distinción: los beneficios aplican a TODOS los
 *    promotores (la tarjeta de plan se oculta en el frontend).
 *  - `premium.enabled=true` → solo los `premium` tienen beneficios. La prueba gratis
 *    (`premium.trial_enabled` + `premium.trial_days`) da premium temporal; un job diario
 *    lo baja a free al vencer. El premium PAGADO exige tarjeta registrada y no vence.
 */
@Injectable()
export class PremiumService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PremiumService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Quita del slider los eventos destacados de un promotor que pierde los beneficios premium. */
  private async clearPromotedFor(userId: string): Promise<void> {
    await this.prisma.event.updateMany({
      where: { promoterId: userId, promotedPriority: { not: null } },
      data: { promotedPriority: null },
    });
  }

  /** Sweeper diario de pruebas vencidas (apagado en test — NODE_ENV=test). */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const DAY_MS = 24 * 3600 * 1000;
    this.timer = setInterval(() => {
      void this.expireTrials().catch((e) =>
        this.logger.error(`Sweeper de pruebas premium falló: ${(e as Error).message}`),
      );
    }, DAY_MS);
    if (this.timer.unref) this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Lee la config premium de los settings (booleans/int con defaults). */
  async config(): Promise<PremiumConfig> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['premium.enabled', 'premium.trial_enabled', 'premium.trial_days'] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const bool = (k: string) => byKey.get(k) === true;
    const days = Number(byKey.get('premium.trial_days') ?? 7);
    return {
      enabled: bool('premium.enabled'),
      trialEnabled: bool('premium.trial_enabled'),
      trialDays: Number.isFinite(days) && days > 0 ? days : 7,
    };
  }

  /**
   * FUENTE DE VERDAD del gating premium (la usan chat, destacar-propio, dashboards
   * avanzados). Solo resuelve la dimensión "premium": el rol de promotor lo checa
   * cada caller. Con premium apagado → true (no restringe). Con premium encendido →
   * true solo si el tier es `premium` y la prueba (si la hay) no venció.
   */
  async benefitsActive(userId: string): Promise<boolean> {
    const cfg = await this.config();
    if (!cfg.enabled) return true; // sin distinción → beneficios para todos los promotores
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { promoterTier: true, premiumTrialEndsAt: true, premiumSince: true },
    });
    if (!u || u.promoterTier !== PromoterTier.premium) return false;
    // Con premium encendido, el tier `premium` solo concede beneficios si fue ACTIVADO
    // (prueba o pago vía setTier → estampan `premiumSince`), no por la mera intención de
    // plan de `apply` (que registra el tier pero no activa nada). Prueba: mientras no venza.
    if (u.premiumTrialEndsAt) return u.premiumTrialEndsAt.getTime() > Date.now();
    return u.premiumSince != null;
  }

  /**
   * Cambia el tier de un usuario (upgrade/downgrade). `free` limpia todo. `premium`:
   *  - con `trialDays` → prueba gratis (exige `trial_enabled`, salvo que lo conceda un admin);
   *  - sin `trialDays` → premium PAGADO (exige tarjeta registrada, salvo concesión de admin).
   * `byAdmin` relaja los requisitos (el admin concede a mano).
   */
  async setTier(
    userId: string,
    tier: PromoterTier,
    opts: { trialDays?: number; byAdmin?: boolean } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, promoterTier: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (tier === PromoterTier.free) {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { promoterTier: PromoterTier.free, premiumTrialEndsAt: null, premiumSince: null },
      });
      // M-3 (QA): al perder premium se DES-destacan sus eventos (si no, el evento
      // destacado durante el trial quedaría en el slider para siempre = bypass).
      await this.clearPromotedFor(userId);
      return this.summarize(updated);
    }

    const cfg = await this.config();
    if (!cfg.enabled && !opts.byAdmin) {
      throw new BadRequestException('El perfil premium no está habilitado');
    }

    if (opts.trialDays != null) {
      if (!cfg.trialEnabled && !opts.byAdmin) {
        throw new BadRequestException('La prueba gratis de premium no está habilitada');
      }
      const days = opts.byAdmin ? opts.trialDays : cfg.trialDays;
      const endsAt = new Date(Date.now() + days * 24 * 3600 * 1000);
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { promoterTier: PromoterTier.premium, premiumTrialEndsAt: endsAt, premiumSince: new Date() },
      });
      if (opts.byAdmin) await this.notifyPremiumActivated(userId);
      return this.summarize(updated);
    }

    // Premium PAGADO: exige una tarjeta registrada (tokenización PCI) salvo concesión admin.
    if (!opts.byAdmin) {
      const cards = await this.prisma.savedCard.count({ where: { userId } });
      if (cards === 0) {
        throw new BadRequestException('Debes registrar una tarjeta de crédito para activar premium');
      }
    }
    const paid = await this.prisma.user.update({
      where: { id: userId },
      data: { promoterTier: PromoterTier.premium, premiumTrialEndsAt: null, premiumSince: new Date() },
    });
    if (opts.byAdmin) await this.notifyPremiumActivated(userId);
    return this.summarize(paid);
  }

  /**
   * M-2 (QA): avisa al promotor que pasó a Premium y que su comisión se reduce por
   * beneficios premium (la reducción del % la aplica el admin a mano — T8/grandfathering).
   * No lanza (una notificación fallida no debe tumbar el cambio de tier ya realizado).
   */
  private async notifyPremiumActivated(userId: string): Promise<void> {
    await this.notifications.emit(userId, {
      type: NotificationType.PREMIUM_ACTIVATED,
      title: 'Ahora eres Premium',
      body: 'Tu comisión de cobro se ha reducido por beneficios premium. ¡Gracias por confiar en Boletiva!',
    });
  }

  /**
   * Al elegir el plan premium en "conviértete" (apply): si premium está activo y la
   * prueba gratis habilitada, arranca la prueba (una sola vez — no reinicia si ya activó
   * antes). Sin prueba, el tier queda como intención y el usuario sube con tarjeta luego.
   */
  async maybeStartTrialOnApply(userId: string): Promise<void> {
    const cfg = await this.config();
    if (!cfg.enabled || !cfg.trialEnabled) return;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumSince: true },
    });
    if (u?.premiumSince) return; // ya activó premium antes → no reiniciar la prueba
    await this.setTier(userId, PromoterTier.premium, { trialDays: cfg.trialDays });
  }

  /** Estado premium del usuario para su vista propia (+ si los beneficios están activos). */
  async myPremium(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { promoterTier: true, premiumTrialEndsAt: true, premiumSince: true },
    });
    return {
      promoterTier: u?.promoterTier ?? PromoterTier.free,
      premiumTrialEndsAt: u?.premiumTrialEndsAt ?? null,
      onTrial: u?.promoterTier === PromoterTier.premium && u?.premiumTrialEndsAt != null,
      benefitsActive: await this.benefitsActive(userId),
    };
  }

  /** Baja a `free` las pruebas vencidas (job diario / disparo manual admin). */
  async expireTrials(): Promise<number> {
    // Se resuelven los ids ANTES de actualizar para poder des-destacar sus eventos (M-3).
    const expiring = await this.prisma.user.findMany({
      where: { promoterTier: PromoterTier.premium, premiumTrialEndsAt: { lte: new Date() } },
      select: { id: true },
    });
    if (expiring.length === 0) return 0;
    const ids = expiring.map((u) => u.id);
    await this.prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { promoterTier: PromoterTier.free, premiumTrialEndsAt: null },
    });
    await this.prisma.event.updateMany({
      where: { promoterId: { in: ids }, promotedPriority: { not: null } },
      data: { promotedPriority: null },
    });
    this.logger.log(`Pruebas premium vencidas → free: ${ids.length}`);
    return ids.length;
  }

  private summarize(u: {
    promoterTier: PromoterTier;
    premiumTrialEndsAt: Date | null;
    premiumSince: Date | null;
  }) {
    return {
      promoterTier: u.promoterTier,
      premiumTrialEndsAt: u.premiumTrialEndsAt,
      premiumSince: u.premiumSince,
      onTrial: u.promoterTier === PromoterTier.premium && u.premiumTrialEndsAt != null,
    };
  }
}

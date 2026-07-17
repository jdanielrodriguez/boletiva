import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { PublicConfigStore } from '../config/public-config.store';

/** Franjas que el usuario puede elegir; el tema concreto lo resuelve la asignación admin. */
export const FRANJAS = ['dia', 'noche'] as const;
export type Franja = (typeof FRANJAS)[number];

/** Cookie/almacenamiento de la franja preferida (visitante) y del tema resuelto (anti-parpadeo). */
export const FRANJA_STORAGE_KEY = 'pe_franja';
export const THEME_STORAGE_KEY = 'pe_theme';

/**
 * Fachada de TEMAS (rebranding Boletiva), espejo de `I18nService`. El usuario elige
 * una FRANJA (día/noche); el tema concreto (bloque de tokens `data-theme`) lo resuelve
 * la asignación del admin (`PublicConfigStore.theme().slots`). Estampa `data-theme` en
 * `<html>` (los tokens `--pe-*` hacen el reskin). SSR-safe: en el servidor y primer
 * render se usa la franja por defecto; tras hidratar se aplica la preferencia. Un
 * script anti-parpadeo en `index.html` estampa el tema cacheado antes del primer paint.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly config = inject(PublicConfigStore);

  /** Franja activa (signal). Default: la de la plataforma (se ajusta al cargar config). */
  readonly franja = signal<Franja>('noche');

  /** Tema concreto resuelto (clave de bloque de tokens) según la asignación admin. */
  readonly theme = computed(() => this.resolve(this.franja()));

  /** Tema AUTOMÁTICO por hora: el reloj (GT) manda; nadie cambia manualmente. */
  readonly autoByHour = computed(() => this.config.theme().autoByHour === true);

  /**
   * ¿Se muestra el botón de cambio de tema? Gate admin (igual que el de idioma) Y
   * que NO esté el modo automático activo (con auto, el reloj decide → sin botón).
   */
  readonly canSwitch = computed(() => this.config.theme().allowVisitorSwitch && !this.autoByHour());

  readonly franjas = FRANJAS;

  /** Timer del modo automático (navegador): re-evalúa la franja periódicamente. */
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  /** Resuelve la franja al tema asignado por el admin (fallback: pulso). */
  private resolve(franja: Franja): string {
    const slots = this.config.theme().slots;
    return slots[franja] ?? 'pulso';
  }

  /** Arranque: aplica la franja por defecto de la plataforma (sin persistir). */
  init(): void {
    this.apply(this.config.theme().defaultFranja as Franja, false);
  }

  /** Aplica la preferencia persistida del visitante (solo navegador, tras hidratar). */
  hydratePreference(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const stored = this.readStored();
    this.apply(stored ?? (this.config.theme().defaultFranja as Franja), false);
  }

  /**
   * Aplica una franja EXPLÍCITA sin persistir (p.ej. la del perfil de un usuario
   * logueado, que ya vive en BD). `null` → aplica la franja por defecto de la plataforma.
   */
  hydrate(franja: Franja | null): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.apply(franja ?? (this.config.theme().defaultFranja as Franja), false);
  }

  /** Cambia la franja y persiste (solo navegador). */
  use(franja: Franja): void {
    this.apply(franja, true);
  }

  /** Alterna día↔noche (para el botón del header). */
  toggle(): void {
    this.use(this.franja() === 'noche' ? 'dia' : 'noche');
  }

  /** Vuelve a la franja por defecto y borra la preferencia (al cerrar sesión). */
  reset(): void {
    this.clearStored();
    this.apply(this.config.theme().defaultFranja as Franja, false);
  }

  /** Reaplica el tema tras un cambio de asignación admin o de config (misma franja). */
  reapply(): void {
    this.apply(this.franja(), false);
  }

  /**
   * Franja según la HORA de Guatemala (tema automático). DÍA si la hora está en
   * [dayStartHour, dayEndHour); NOCHE en el resto. Soporta rangos que cruzan la
   * medianoche (p.ej. día 20→6 = noche invertida). SSR-safe (Intl corre en Node).
   */
  autoFranja(): Franja {
    const cfg = this.config.theme();
    const start = Number.isFinite(cfg.dayStartHour) ? (cfg.dayStartHour as number) : 6;
    const end = Number.isFinite(cfg.dayEndHour) ? (cfg.dayEndHour as number) : 18;
    let hour: number;
    try {
      hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Guatemala',
          hour: 'numeric',
          hour12: false,
        }).format(new Date()),
      );
      if (hour === 24) hour = 0; // Intl puede devolver 24 a medianoche
    } catch {
      hour = new Date().getHours();
    }
    const isDay = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    return isDay ? 'dia' : 'noche';
  }

  /**
   * Enciende el tema AUTOMÁTICO: aplica la franja de la hora actual y re-evalúa cada
   * minuto (navegador) para cruzar el umbral día↔noche sin recargar. Idempotente:
   * reinicia el timer si ya estaba activo. No persiste preferencia (el reloj manda),
   * pero sí deja el tema resuelto en la cookie anti-parpadeo.
   */
  startAuto(): void {
    this.applyAutoNow();
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = setInterval(() => this.applyAutoNow(), 60_000);
  }

  /** Apaga el modo automático (detiene el timer). El tema vigente se conserva. */
  stopAuto(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  /** Favicon SVG por tema (los demás archivos —.ico, apple-touch— quedan fijos). */
  private static readonly FAVICON_BY_THEME: Record<string, string> = {
    pulso: 'favicon.svg',
    marquesina: 'favicon-marquesina.svg',
  };

  /**
   * Cambia el favicon SVG al del tema activo (solo navegador). Los navegadores
   * modernos prefieren el `<link rel=icon type=image/svg+xml>`, así el icono de la
   * pestaña acompaña al tema. Si no encuentra el link (SSR), no hace nada.
   */
  private syncFavicon(theme: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const file = ThemeService.FAVICON_BY_THEME[theme] ?? 'favicon.svg';
    const link = this.document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (link) link.setAttribute('href', `${file}?v=2`);
  }

  private applyAutoNow(): void {
    const franja = this.autoFranja();
    this.franja.set(franja);
    const theme = this.resolve(franja);
    if (isPlatformBrowser(this.platformId)) {
      this.document.documentElement.setAttribute('data-theme', theme);
      this.syncFavicon(theme);
      // Solo la cookie de tema resuelto (anti-parpadeo); NO persistimos preferencia
      // de franja, porque en modo automático el reloj decide, no el usuario.
      try {
        this.document.cookie = `${THEME_STORAGE_KEY}=${theme};path=/;max-age=31536000;SameSite=Lax`;
      } catch {
        /* sin persistencia → se corrige al primer tick */
      }
    }
  }

  private apply(franja: Franja, persist: boolean): void {
    const next = FRANJAS.includes(franja) ? franja : 'noche';
    this.franja.set(next);
    const theme = this.resolve(next);
    if (isPlatformBrowser(this.platformId)) {
      this.document.documentElement.setAttribute('data-theme', theme);
      this.syncFavicon(theme);
      if (persist) this.persist(next, theme);
    }
  }

  private readStored(): Franja | null {
    try {
      const fromLs = this.window()?.localStorage?.getItem(FRANJA_STORAGE_KEY);
      if (fromLs && FRANJAS.includes(fromLs as Franja)) return fromLs as Franja;
      const fromCookie = this.readCookie(FRANJA_STORAGE_KEY);
      if (fromCookie && FRANJAS.includes(fromCookie as Franja)) return fromCookie as Franja;
    } catch {
      /* almacenamiento no disponible → default */
    }
    return null;
  }

  private persist(franja: Franja, theme: string): void {
    try {
      this.window()?.localStorage?.setItem(FRANJA_STORAGE_KEY, franja);
      // Franja (semántica) + tema resuelto (para el script anti-parpadeo del index.html).
      this.document.cookie = `${FRANJA_STORAGE_KEY}=${franja};path=/;max-age=31536000;SameSite=Lax`;
      this.document.cookie = `${THEME_STORAGE_KEY}=${theme};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      /* sin persistencia → se pierde entre sesiones, no rompe */
    }
  }

  private clearStored(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      this.window()?.localStorage?.removeItem(FRANJA_STORAGE_KEY);
      this.document.cookie = `${FRANJA_STORAGE_KEY}=;path=/;max-age=0;SameSite=Lax`;
      this.document.cookie = `${THEME_STORAGE_KEY}=;path=/;max-age=0;SameSite=Lax`;
    } catch {
      /* nada que borrar */
    }
  }

  private readCookie(name: string): string | null {
    const match = this.document.cookie?.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private window(): (Window & typeof globalThis) | null {
    return this.document.defaultView;
  }
}

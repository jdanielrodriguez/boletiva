import { Injectable, Injector, inject, signal } from '@angular/core';
import { PublicConfigApi, ThemeConfig } from '../api/public-config.api';

/** Asignación de tema por defecto (mientras llega /public/config): noche→pulso, día→marquesina. */
const DEFAULT_THEME: ThemeConfig = {
  slots: { dia: 'marquesina', noche: 'pulso' },
  defaultFranja: 'dia', // default de plataforma: franja DÍA
  allowVisitorSwitch: false, // botón de cambio de tema OFF por defecto
  autoByHour: false,
  dayStartHour: 6,
  dayEndHour: 18,
};

/**
 * Estado reactivo de la config pública (signals, zoneless). Fuente única de verdad
 * de los flags globales de la plataforma que afectan al visitante:
 *  - `allowVisitorLangSwitch`: ¿el visitante sin sesión puede cambiar idioma?
 *  - `showHomeCategories`: ¿se muestran las categorías en el inicio?
 *
 * Valores por defecto = los del backend (visitante NO cambia idioma; categorías SÍ
 * se muestran) → seguros para el primer render/SSR mientras llega la respuesta. Se
 * carga SOLO en el navegador al arrancar (como el estado de mantenimiento).
 */
@Injectable({ providedIn: 'root' })
export class PublicConfigStore {
  // El API (→ ApiClient → HttpClient) se resuelve DIFERIDO en `load()`: así, los
  // componentes que solo LEEN los flags (header/lang-switcher, catálogo) no
  // arrastran HttpClient a sus specs por el mero hecho de inyectar el store.
  private readonly injector = inject(Injector);

  private readonly _allowVisitorLangSwitch = signal(false);
  private readonly _showHomeCategories = signal(false); // categorías ocultas en inicio por defecto
  private readonly _reportsMaintenance = signal(false); // reportes activos por defecto
  private readonly _tourEnabled = signal(true); // tour de onboarding activo por defecto
  private readonly _theme = signal<ThemeConfig>(DEFAULT_THEME);
  private readonly _recaptchaSiteKey = signal('');
  private readonly _premium = signal<{ enabled: boolean; trialEnabled: boolean; trialDays: number }>({
    enabled: false,
    trialEnabled: false,
    trialDays: 7,
  });
  private readonly _chatEnabled = signal(false);
  private readonly _loaded = signal(false);

  readonly allowVisitorLangSwitch = this._allowVisitorLangSwitch.asReadonly();
  readonly showHomeCategories = this._showHomeCategories.asReadonly();
  /** ¿Reportes/dashboards en mantenimiento? (admin lo activa si hay descuadre.) */
  readonly reportsMaintenance = this._reportsMaintenance.asReadonly();
  /** ¿El tour de onboarding está habilitado? (admin puede apagarlo.) */
  readonly tourEnabled = this._tourEnabled.asReadonly();
  /** Asignación de tema por franja + switch (rebranding Boletiva). */
  readonly theme = this._theme.asReadonly();
  /** Site key pública de reCAPTCHA v3 ('' = deshabilitado; RecaptchaService la lee). */
  readonly recaptchaSiteKey = this._recaptchaSiteKey.asReadonly();
  /** Perfil premium: enabled (distinción free/premium), trialEnabled, trialDays. */
  readonly premium = this._premium.asReadonly();
  /** ¿El chat de soporte está habilitado globalmente? */
  readonly chatEnabled = this._chatEnabled.asReadonly();
  /** true una vez resuelta (o fallida) la consulta inicial. */
  readonly loaded = this._loaded.asReadonly();

  /** Consulta la config inicial. Fallo → conserva los defaults y marca cargado. */
  load(): void {
    if (this._loaded()) return;
    this.fetch();
  }

  /**
   * Re-consulta `GET /public/config` SIEMPRE (ignora el guard de `load`). Lo usa el
   * catálogo/inicio al entrar a la ruta: una navegación fresca toma los cambios de
   * config que hizo el admin (idioma/categorías) sin necesidad de un F5 (W2/W10).
   */
  refresh(): void {
    this.fetch();
  }

  private fetch(): void {
    this.injector.get(PublicConfigApi).get().subscribe({
      next: (c) => {
        this._allowVisitorLangSwitch.set(c.allowVisitorLangSwitch);
        this._showHomeCategories.set(c.showHomeCategories);
        this._reportsMaintenance.set(c.reportsMaintenance ?? false);
        this._tourEnabled.set(c.tourEnabled ?? true);
        if (c.theme) this._theme.set(c.theme);
        this._recaptchaSiteKey.set(c.recaptchaSiteKey ?? '');
        if (c.premium) this._premium.set(c.premium);
        this._chatEnabled.set(c.chatEnabled ?? false);
        this._loaded.set(true);
      },
      error: () => this._loaded.set(true),
    });
  }

  /**
   * Setters instantáneos (W2/W10): al togglear el setting en la consola admin,
   * el store refleja el cambio al momento para el admin que lo hizo (el switcher
   * de idioma se oculta/muestra y las categorías aparecen/desaparecen sin F5).
   */
  setAllowVisitorLangSwitch(value: boolean): void {
    this._allowVisitorLangSwitch.set(value);
  }
  setShowHomeCategories(value: boolean): void {
    this._showHomeCategories.set(value);
  }
  /** Reasignar un tema a una franja o togglear el switch sin F5 (consola admin). */
  setThemeSlot(franja: 'dia' | 'noche', theme: string): void {
    this._theme.update((t) => ({ ...t, slots: { ...t.slots, [franja]: theme } }));
  }
  setThemeAllowVisitorSwitch(value: boolean): void {
    this._theme.update((t) => ({ ...t, allowVisitorSwitch: value }));
  }
  /** Encender/apagar el tema automático por hora sin F5 (consola admin). */
  setThemeAutoByHour(value: boolean): void {
    this._theme.update((t) => ({ ...t, autoByHour: value }));
  }
  /** Togglear el interruptor maestro premium / prueba / días sin F5 (consola admin). */
  setPremiumEnabled(value: boolean): void {
    this._premium.update((p) => ({ ...p, enabled: value }));
  }
  setPremiumTrialEnabled(value: boolean): void {
    this._premium.update((p) => ({ ...p, trialEnabled: value }));
  }
  setPremiumTrialDays(value: number): void {
    this._premium.update((p) => ({ ...p, trialDays: value }));
  }
  setChatEnabled(value: boolean): void {
    this._chatEnabled.set(value);
  }
}

import { Component, PLATFORM_ID, afterNextRender, computed, effect, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Header } from './shared/layout/header';
import { Footer } from './shared/layout/footer';
import { ToastContainer } from './shared/ui/toast-container';
import { LoadingComponent } from './shared/ui/loading.component';
import { MaintenancePageComponent } from './shared/maintenance/maintenance-page.component';
import { MaintenanceBannerComponent } from './shared/maintenance/maintenance-banner.component';
import { ImpersonationBannerComponent } from './shared/layout/impersonation-banner.component';
import { EmailVerificationModal } from './shared/email-verification/email-verification-modal.component';
import { SupportBubbleComponent } from './shared/support/support-bubble.component';
import { SessionStore } from './core/auth/session.store';
import { TokenStore } from './core/auth/token-store.service';
import { ImpersonationService } from './core/auth/impersonation.service';
import { MaintenanceStore } from './core/maintenance/maintenance.store';
import { LoadingStore } from './core/ui/loading.store';
import { I18nService } from './core/i18n/i18n.service';
import { ThemeService, type Franja } from './core/theme/theme.service';
import { PublicConfigStore } from './core/config/public-config.store';
import { ClickDelayService } from './core/ui/click-delay.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Header,
    Footer,
    ToastContainer,
    LoadingComponent,
    MaintenancePageComponent,
    MaintenanceBannerComponent,
    ImpersonationBannerComponent,
    EmailVerificationModal,
    SupportBubbleComponent,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = inject(SessionStore);
  private readonly tokens = inject(TokenStore);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly loading = inject(LoadingStore);
  private readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeService);
  private readonly publicConfig = inject(PublicConfigStore);
  private readonly clickDelay = inject(ClickDelayService);
  private readonly impersonation = inject(ImpersonationService);
  /** Velo breve tras un clic (cliente/visitante) — sensación de "está procesando". */
  protected readonly clickDelayActive = this.clickDelay.active;
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Guard: la decisión de idioma inicial se aplica una sola vez. */
  private langDecided = false;
  private themeDecided = false;

  protected readonly maintMessage = this.maintenance.message;

  /**
   * Overlay de carga GLOBAL oscurecido: peticiones HTTP en vuelo (tras el debounce
   * del LoadingStore). Se suprime durante el arranque (`booting`) para no apilar dos
   * overlays a la vez con el de hidratación (v3.9 · C1).
   */
  protected readonly globalLoading = computed(
    () => this.isBrowser && !this.booting() && this.loading.visible(),
  );

  /** ¿El overlay global debe BLOQUEAR la interacción? (acciones deliberadas como
   * el logout, F1). Los overlays HTTP transitorios dejan pasar el clic. */
  protected readonly globalLoadingBlocking = computed(() => this.loading.blocking());

  /** ¿El usuario resuelto es admin? (para el bypass del mantenimiento). */
  private readonly isAdmin = computed(() => this.session.roles().includes('admin'));

  /**
   * Banner persistente de MODO PRUEBA: el usuario es de prueba (invitado en modo test)
   * → sus eventos usan la pasarela Sandbox y no hay cargos reales. Se muestra en toda la
   * app para que quede claro que está en un entorno de pruebas (tarjetas 4242, etc.).
   */
  protected readonly showTestBanner = computed(
    () => this.isBrowser && this.session.user()?.isTestUser === true,
  );

  /**
   * Arranque en el navegador: tapamos con el loader mientras NO sepamos (a) el
   * estado de mantenimiento y (b) quién es el usuario (si hay marca de sesión).
   * Así evitamos el PARPADEO de la pantalla de login/contenido antes de decidir si
   * hay que mostrar la página de mantenimiento (F5 admin incluido).
   */
  protected readonly booting = computed(
    () =>
      this.isBrowser &&
      (!this.maintenance.loaded() ||
        (this.tokens.hasSessionHint() && !this.session.loaded())),
  );

  /** Página de mantenimiento bloqueante: mantenimiento activo y NO-admin. */
  protected readonly showMaintenancePage = computed(
    () => this.isBrowser && !this.booting() && this.maintenance.active() && !this.isAdmin(),
  );

  /** Banner superior: mantenimiento activo y el usuario ES admin (no bloquea). */
  protected readonly showAdminBanner = computed(
    () => this.isBrowser && !this.booting() && this.maintenance.active() && this.isAdmin(),
  );

  /** Mantenimiento SOLO para asesores (T7): el admin lo activa; el asesor ve una
   *  pantalla de acceso deshabilitado. No aplica a admins ni a otros roles. */
  protected readonly showAdvisorMaintenance = computed(
    () =>
      this.isBrowser &&
      !this.booting() &&
      this.publicConfig.advisorsMaintenance() &&
      this.session.hasAnyRole(['advisor']) &&
      !this.isAdmin(),
  );

  constructor() {
    // Publica la altura REAL de la franja superior fija (banners + header) como
    // `--pe-topbar-h` para que los elementos sticky (resumen de compra/checkout) se
    // anclen debajo de ella aunque crezca con banners (impersonación/test/mantenimiento).
    afterNextRender(() => {
      const bar = document.querySelector('.topbar-stack');
      if (!bar) return;
      const setVar = () =>
        document.documentElement.style.setProperty('--pe-topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
      setVar();
      new ResizeObserver(setVar).observe(bar);
    });

    // Hidrata sesión y consulta el mantenimiento SOLO en el navegador: en SSR no
    // hay tokens (localStorage) y no queremos pegar al API en el servidor (rompería
    // el cache público de las páginas anónimas).
    if (this.isBrowser) {
      this.maintenance.load();
      this.publicConfig.load();
      this.clickDelay.install(); // delay artificial en clics (cliente/visitante, config admin)
      // W9: restaura una impersonación persistida ANTES de resolver la sesión. Si
      // había token, `ensureLoaded` ve un access token en memoria y hace /auth/me
      // directo → resuelve al promotor (con `impersonatedBy`) sin refrescar al admin.
      // Sin token, el flujo normal (refresh del admin/usuario) sigue igual.
      const restoringImpersonation = this.impersonation.bootstrap();
      this.session.ensureLoaded().subscribe(() => {
        // Si el token impersonado ya venció (el interceptor cayó al admin), descarta
        // el token obsoleto para no reintentarlo en el próximo F5.
        if (restoringImpersonation) this.impersonation.reconcile();
      });

      // Decisión de idioma inicial (v3.10 · GI). Se aplica UNA vez, cuando ya se
      // resolvió la sesión Y llegó la config pública (ambas HTTP → post-hidratación,
      // sin romper el calce del SSR que va en español):
      //  - usuario logueado → SIEMPRE su idioma de BD, sin importar el flag;
      //  - visitante con el flag ACTIVO → aplica su preferencia guardada;
      //  - visitante con el flag INACTIVO → se queda en español (default).
      effect(() => {
        if (this.langDecided) return;
        if (!this.session.loaded() || !this.publicConfig.loaded()) return;
        this.langDecided = true;
        const lang = this.session.user()?.language;
        if (lang === 'es' || lang === 'en') {
          this.i18n.use(lang);
        } else if (this.publicConfig.allowVisitorLangSwitch()) {
          this.i18n.hydratePreference();
        }
      });

      // Decisión de TEMA inicial (rebranding Boletiva), análoga a la de idioma:
      //  - usuario logueado → su franja de BD (themePref) si la tiene;
      //  - visitante → su franja guardada (cookie) si el admin permite el switch;
      //  - si no → la franja por defecto de la plataforma.
      // Luego, ante un cambio de asignación admin (slots) SIN F5, se reaplica la
      // franja vigente para resolver el nuevo tema (respeta un toggle en sesión).
      effect(() => {
        const themeCfg = this.publicConfig.theme(); // se rastrea → reacciona a cambios admin
        if (!this.session.loaded() || !this.publicConfig.loaded()) return;
        // Tema AUTOMÁTICO por hora: el reloj manda; se ignora cualquier preferencia y
        // el botón de cambio se oculta (canSwitch=false). Idempotente ante cambios admin.
        if (themeCfg.autoByHour) {
          this.themeDecided = true;
          this.theme.startAuto();
          return;
        }
        this.theme.stopAuto(); // por si venía de modo automático (admin lo apagó)
        if (!this.themeDecided) {
          this.themeDecided = true;
          // PRIORIDAD: la preferencia de PERFIL del usuario logueado (día/noche) SIEMPRE
          // manda, aunque el admin tenga el switch de visitantes apagado. El switch solo
          // gobierna a VISITANTES / usuarios sin preferencia guardada.
          const pref = this.session.user()?.themePref;
          if (pref === 'dia' || pref === 'noche') {
            this.theme.hydrate(pref as Franja);
            return;
          }
          // Sin preferencia de perfil: switch apagado → franja del admin; permitido →
          // preferencia guardada (cookie) del visitante.
          if (!themeCfg.allowVisitorSwitch) {
            this.theme.hydrate(null);
          } else {
            this.theme.hydratePreference();
          }
        } else {
          this.theme.reapply(); // cambió la asignación admin → re-resolver el tema
        }
      });
    }
  }
}

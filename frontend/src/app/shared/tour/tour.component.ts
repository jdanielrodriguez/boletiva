import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { PublicConfigStore } from '../../core/config/public-config.store';

/**
 * Un paso del tour. `target` (opcional) = selector CSS del elemento a RESALTAR: el tour
 * hace foco en él (spotlight) y ancla la explicación a su lado. Sin `target`, el paso
 * se muestra como tarjeta centrada.
 */
export interface TourStep {
  title: string;
  body: string;
  target?: string;
}

/** % de VISITANTES ANÓNIMOS a los que se ofrece el tour (tirada estable por navegador). */
const ANON_SHOW_PCT = 50;
/** Máximo de veces que se OFRECE el tour sin que el usuario interactúe (luego se calla). */
const MAX_OFFERS = 3;

interface TourRecord {
  status?: 'done' | 'dismissed';
  at?: number; // epoch ms de la última acción (para el reinicio por días)
  views?: number; // veces que se ofreció el prompt
}

/**
 * Tour de onboarding con PROMPT + SPOTLIGHT (rework):
 *  1) Pregunta primero "¿Quieres un tour rápido? Sí / No, gracias" (no invasivo).
 *  2) Si dice SÍ → tour SUPERINVASIVO: oscurece la página, RESALTA cada elemento
 *     (`step.target`) y ancla la explicación a su lado (no deja el "siguiente" abajo).
 *  3) Si dice NO / lo termina / lo salta → se recuerda por `tour.reset_days` días
 *     (config admin); tras {@link MAX_OFFERS} ofertas sin interactuar, se calla.
 * Persistencia por navegador (localStorage) para logueado y anónimo → sobrevive recargas
 * y "expira" para reofrecerse. Global OFF con `tour.enabled`. SSR-safe.
 */
@Component({
  selector: 'app-tour',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (phase() === 'prompt') {
      <div class="tour-pop" data-testid="tour" role="complementary" [attr.aria-label]="'tour.aria' | translate">
        <button type="button" class="tour-close" (click)="decline()" data-testid="tour-close" [attr.aria-label]="'tour.skip' | translate">×</button>
        <h3 class="tour-title">{{ 'tour.promptTitle' | translate }}</h3>
        <p class="tour-body">{{ 'tour.promptBody' | translate }}</p>
        <div class="tour-actions">
          <button type="button" class="btn ghost tour-btn" (click)="decline()" data-testid="tour-no">{{ 'tour.no' | translate }}</button>
          <span class="tour-spacer"></span>
          <button type="button" class="btn primary tour-btn" (click)="accept()" data-testid="tour-yes">{{ 'tour.yes' | translate }}</button>
        </div>
      </div>
    } @else if (phase() === 'running') {
      <!-- Backdrop invasivo con "agujero" sobre el elemento resaltado (o sólido si no hay target). -->
      <div class="tour-overlay" data-testid="tour-overlay" (click)="skip()">
        @if (rect(); as r) {
          <div class="tour-spotlight" [style.top.px]="r.top" [style.left.px]="r.left" [style.width.px]="r.width" [style.height.px]="r.height"></div>
        }
      </div>
      <div class="tour-card" data-testid="tour" role="dialog" aria-modal="true" [attr.aria-label]="'tour.aria' | translate"
        [class.anchored]="!!rect()" [style.top.px]="cardPos().top" [style.left.px]="cardPos().left">
        <button type="button" class="tour-close" (click)="skip()" data-testid="tour-close" [attr.aria-label]="'tour.skip' | translate">×</button>
        <p class="tour-step-count">{{ index() + 1 }} / {{ steps().length }}</p>
        <h3 class="tour-title">{{ steps()[index()].title | translate }}</h3>
        <p class="tour-body">{{ steps()[index()].body | translate }}</p>
        <div class="tour-actions">
          <button type="button" class="btn ghost tour-btn" (click)="skip()" data-testid="tour-skip">{{ 'tour.skip' | translate }}</button>
          <span class="tour-spacer"></span>
          @if (index() > 0) {
            <button type="button" class="btn tour-btn" (click)="back()" data-testid="tour-back">{{ 'tour.back' | translate }}</button>
          }
          @if (index() < steps().length - 1) {
            <button type="button" class="btn primary tour-btn" (click)="next()" data-testid="tour-next">{{ 'tour.next' | translate }}</button>
          } @else {
            <button type="button" class="btn primary tour-btn" (click)="finish()" data-testid="tour-finish">{{ 'tour.finish' | translate }}</button>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .tour-pop { position: fixed; left: 1rem; bottom: 1rem; z-index: 1200; width: min(340px, calc(100vw - 2rem)); background: var(--pe-bg-elev, var(--pe-surface, #14151c)); color: var(--pe-text, #f5f6fa); border: 1px solid var(--pe-border, #2a2c36); border-radius: 14px; padding: .95rem 1rem .85rem; box-shadow: 0 14px 38px rgba(0,0,0,.28); animation: tour-in .25s ease-out; }
      /* Spotlight invasivo: backdrop oscurecido + agujero (via box-shadow spread) sobre el target. */
      .tour-overlay { position: fixed; inset: 0; z-index: 1300; }
      .tour-overlay:not(:has(.tour-spotlight)) { background: rgba(0,0,0,.6); }
      .tour-spotlight { position: fixed; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(0,0,0,.6), 0 0 0 3px var(--pe-accent, #e14eca); transition: all .2s ease; pointer-events: none; }
      .tour-card { position: fixed; z-index: 1301; width: min(340px, calc(100vw - 2rem)); background: var(--pe-bg-elev, var(--pe-surface, #14151c)); color: var(--pe-text, #f5f6fa); border: 1px solid var(--pe-border, #2a2c36); border-radius: 14px; padding: .95rem 1rem .85rem; box-shadow: 0 14px 38px rgba(0,0,0,.4); animation: tour-in .2s ease-out; }
      /* Sin target: tarjeta centrada. */
      .tour-card:not(.anchored) { top: 50% !important; left: 50% !important; transform: translate(-50%, -50%); }
      .tour-close { position: absolute; top: .35rem; right: .45rem; background: none; border: 0; color: var(--pe-muted); font-size: 1.3rem; line-height: 1; cursor: pointer; padding: .1rem .35rem; border-radius: 8px; }
      .tour-close:hover { color: var(--pe-text); background: var(--pe-border, #2a2c36); }
      .tour-step-count { display: inline-block; color: var(--pe-text-muted, var(--pe-muted)); background: var(--pe-surface-2, rgba(127,127,127,.12)); font-weight: 600; font-size: .72rem; margin: 0 0 .45rem; padding: .12rem .5rem; border-radius: 999px; }
      .tour-title { margin: 0 0 .4rem; font-size: 1.02rem; padding-right: 1.3rem; }
      .tour-body { color: var(--pe-muted); margin: 0 0 .8rem; font-size: .9rem; line-height: 1.4; }
      .tour-actions { display: flex; align-items: center; gap: .4rem; }
      .tour-spacer { flex: 1; }
      .tour-btn { padding: .35rem .7rem; font-size: .85rem; }
      @keyframes tour-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      @media (max-width: 480px) { .tour-pop, .tour-card { left: .5rem !important; right: .5rem; bottom: .5rem; width: auto; } }
      @media (prefers-reduced-motion: reduce) { .tour-pop, .tour-card, .tour-spotlight { animation: none; transition: none; } }
    `,
  ],
})
export class TourComponent {
  private readonly session = inject(SessionStore);
  private readonly usersApi = inject(UsersApi);
  private readonly config = inject(PublicConfigStore);
  private readonly platformId = inject(PLATFORM_ID);

  readonly tourKey = input.required<string>();
  readonly steps = input.required<TourStep[]>();

  protected readonly index = signal(0);
  /** 'idle' (no ofrecer), 'prompt' (¿sí/no?), 'running' (spotlight). */
  protected readonly phase = signal<'idle' | 'prompt' | 'running'>('idle');
  protected readonly rect = signal<{ top: number; left: number; width: number; height: number } | null>(null);

  constructor() {
    afterNextRender(() => {
      if (this.shouldOffer()) {
        this.registerView();
        this.phase.set('prompt');
      }
    });
  }

  /** Posición de la tarjeta: debajo del target resaltado (o centrada si no hay). */
  protected readonly cardPos = computed(() => {
    const r = this.rect();
    if (!r || !isPlatformBrowser(this.platformId)) return { top: 0, left: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = r.top + r.height + 12;
    const top = below + 200 > vh ? Math.max(12, r.top - 212) : below; // arriba si no cabe abajo
    const left = Math.min(Math.max(12, r.left), vw - 352);
    return { top, left };
  });

  /** ¿Se OFRECE el tour ahora? (flag global + elegibilidad + no-visto-reciente + <MAX_OFFERS). */
  private shouldOffer(): boolean {
    if (!this.config.tourEnabled()) return false;
    if (!this.config.loaded() || !this.session.loaded()) return false;
    // Anónimo: además de la persistencia, respeta la tirada aleatoria estable.
    if (!this.session.user() && !this.anonRollOk()) return false;
    const rec = this.readRecord();
    if (rec.status) {
      const days = this.config.tourResetDays() || 30;
      const freshMs = days * 24 * 60 * 60 * 1000;
      if (rec.at && Date.now() - rec.at < freshMs) return false; // aún dentro de la ventana
    }
    if ((rec.views ?? 0) >= MAX_OFFERS) return false; // ofrecido 3 veces sin interactuar
    return true;
  }

  protected accept(): void {
    this.index.set(0);
    this.phase.set('running');
    this.measureSoon();
  }
  protected decline(): void {
    this.persist('dismissed');
    this.phase.set('idle');
  }
  protected next(): void {
    this.index.update((i) => Math.min(i + 1, this.steps().length - 1));
    this.measureSoon();
  }
  protected back(): void {
    this.index.update((i) => Math.max(i - 1, 0));
    this.measureSoon();
  }
  protected finish(): void {
    this.markDone();
  }
  protected skip(): void {
    this.markDone();
  }

  @HostListener('window:resize') @HostListener('window:scroll')
  protected onViewportChange(): void {
    if (this.phase() === 'running') this.measure();
  }

  /** Mide el target del paso actual tras el render (scroll + rect). */
  private measureSoon(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => this.measure(), 0);
  }
  private measure(): void {
    const sel = this.steps()[this.index()]?.target;
    if (!sel) { this.rect.set(null); return; }
    try {
      const el = document.querySelector(sel);
      if (!el) { this.rect.set(null); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const r = el.getBoundingClientRect();
      this.rect.set({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
    } catch {
      this.rect.set(null);
    }
  }

  // --- Persistencia (localStorage v2 con status/at/views) ---
  private key(): string {
    return `pe.tour.v2.${this.tourKey()}`;
  }
  private ls(): Storage | null {
    try {
      return isPlatformBrowser(this.platformId) && typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }
  private readRecord(): TourRecord {
    const ls = this.ls();
    if (!ls) return {};
    try {
      return JSON.parse(ls.getItem(this.key()) ?? '{}') as TourRecord;
    } catch {
      return {};
    }
  }
  private writeRecord(rec: TourRecord): void {
    try {
      this.ls()?.setItem(this.key(), JSON.stringify(rec));
    } catch {
      /* modo privado / cuota */
    }
  }
  /** Incrementa el contador de ofertas (para el tope de MAX_OFFERS sin interacción). */
  private registerView(): void {
    const rec = this.readRecord();
    this.writeRecord({ ...rec, views: (rec.views ?? 0) + 1 });
  }
  private persist(status: 'done' | 'dismissed'): void {
    this.writeRecord({ ...this.readRecord(), status, at: Date.now() });
  }
  private markDone(): void {
    this.persist('done');
    this.phase.set('idle');
    // Logueado: además marca en el perfil (pista cross-device; no bloquea el reinicio local).
    if (this.session.user()) {
      this.usersApi.markTourSeen(this.tourKey()).subscribe({
        next: (u) => this.session.setUser(u),
        error: () => undefined,
      });
    }
  }

  /** Tirada aleatoria estable del visitante anónimo (una vez por navegador). */
  private anonRollOk(): boolean {
    const ls = this.ls();
    if (!ls) return false;
    try {
      let roll = ls.getItem('pe.tour.roll');
      if (roll === null) {
        roll = String(Math.floor(Math.random() * 100));
        ls.setItem('pe.tour.roll', roll);
      }
      return Number(roll) < ANON_SHOW_PCT;
    } catch {
      return false;
    }
  }
}

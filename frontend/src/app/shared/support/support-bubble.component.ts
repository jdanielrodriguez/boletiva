import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ChatSocketService } from '../../core/chat/chat-socket.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Burbuja global de soporte (T3) para AGENTES (asesor/admin). Vive en el shell y
 * mantiene una conexión socket persistente (ref-count) mientras el agente navega.
 * Cuando un promotor manda un mensaje (evento `ticket-activity`), la burbuja se
 * "abre" (pulsa + toast) y lleva la cuenta de tickets con actividad sin leer, para
 * que el agente pueda atender varios chats desde cualquier página. Un click abre la
 * bandeja (/soporte) y limpia el contador.
 *
 * SSR-safe y gated: solo se monta si estamos en navegador, el soporte está habilitado
 * y el usuario es agente. No aparece para promotores/compradores.
 */
@Component({
  selector: 'app-support-bubble',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, IconComponent],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="support-bubble"
        [class.has-activity]="unread() > 0"
        data-testid="support-bubble"
        [attr.aria-label]="'chat.bubbleAria' | translate: { n: unread() }"
        [title]="'chat.title' | translate"
        (click)="openInbox()"
      >
        <app-icon name="chat" [size]="24" />
        @if (unread() > 0) {
          <span class="support-bubble-badge" aria-hidden="true">{{ unread() > 9 ? '9+' : unread() }}</span>
        }
      </button>
    }
  `,
  styles: [
    `
      .support-bubble {
        position: fixed;
        right: 1.1rem;
        bottom: 1.1rem;
        z-index: 900;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: var(--pe-grad, linear-gradient(135deg, #2f6bff, #e14eca));
        box-shadow: var(--pe-shadow, 0 10px 30px rgba(0, 0, 0, 0.35));
        transition: transform 0.15s ease;
      }
      .support-bubble:hover {
        transform: translateY(-2px) scale(1.04);
      }
      .support-bubble.has-activity {
        animation: support-pulse 1.6s infinite;
      }
      .support-bubble-badge {
        position: absolute;
        top: -2px;
        right: -2px;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--pe-danger, #ff6b81);
        color: #fff;
        font-size: 0.72rem;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      @keyframes support-pulse {
        0% {
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--pe-accent, #e14eca) 55%, transparent);
        }
        70% {
          box-shadow: 0 0 0 14px transparent;
        }
        100% {
          box-shadow: 0 0 0 0 transparent;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .support-bubble.has-activity {
          animation: none;
        }
      }
    `,
  ],
})
export class SupportBubbleComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = inject(SessionStore);
  private readonly config = inject(PublicConfigStore);
  private readonly socket = inject(ChatSocketService);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  protected readonly unread = signal(0);
  /** Tickets distintos con actividad sin leer (para no inflar el contador por ticket). */
  private readonly activeTickets = new Set<string>();
  private connected = false;

  /** Ruta actual empieza en /soporte → dentro de la vista de soporte NO se muestra la burbuja. */
  private readonly onSupportRoute = signal(false);

  protected readonly visible = computed(
    () =>
      this.isBrowser &&
      this.config.chatEnabled() &&
      this.session.hasAnyRole(['admin', 'advisor']) &&
      !this.onSupportRoute(),
  );

  constructor() {
    if (this.isBrowser) {
      this.config.load();
      this.onSupportRoute.set(this.router.url.startsWith('/soporte'));
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
        .subscribe((e) => this.onSupportRoute.set(e.urlAfterRedirects.startsWith('/soporte')));
    }
    // Cuando el agente es visible, conecta una sola vez y escucha la actividad.
    effect(() => {
      if (this.visible() && !this.connected) {
        this.connected = true;
        void this.socket.acquire();
        this.socket.activity$.subscribe((a) => this.onActivity(a.ticketId));
      }
    });
  }

  private onActivity(ticketId: string): void {
    // No cuentes actividad de la bandeja que el agente ya está mirando.
    if (this.router.url.startsWith('/soporte')) return;
    if (this.activeTickets.has(ticketId)) return;
    this.activeTickets.add(ticketId);
    this.unread.set(this.activeTickets.size);
    this.toasts.info(this.translate.instant('chat.bubbleToast'));
  }

  protected openInbox(): void {
    this.activeTickets.clear();
    this.unread.set(0);
    void this.router.navigate(['/soporte']);
  }
}

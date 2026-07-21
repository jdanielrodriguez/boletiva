import { ChangeDetectionStrategy, Component, HostListener, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { SessionStore } from '../../core/auth/session.store';
import { NotificationsApi, type AppNotification } from '../../core/api/notifications.api';
import { NotificationsSocketService } from '../../core/notifications/notifications-socket.service';

/**
 * Campanita de notificaciones (T5) en la cabecera. Para usuarios autenticados con rol
 * promotor/asesor/admin. Muestra el contador de no-leídas y un panel con la lista;
 * entrega en vivo por socket. SSR-safe: solo hidrata/conecta en el navegador.
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LocalizedDatePipe],
  template: `
    @if (visible()) {
      <div class="notif-bell">
        <button
          type="button"
          class="notif-trigger"
          data-testid="notif-bell"
          [attr.aria-label]="'notifications.bellAria' | translate: { n: unread() }"
          [attr.aria-expanded]="open()"
          aria-haspopup="menu"
          (click)="toggle()"
        >
          <svg class="notif-icon" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M12 2.25a2 2 0 0 1 2 2v.4a6 6 0 0 1 4 5.66v3.36l1.36 2.72A1 1 0 0 1 18.47 18H5.53a1 1 0 0 1-.89-1.45L6 13.67v-3.36a6 6 0 0 1 4-5.66v-.4a2 2 0 0 1 2-2Z" />
            <path d="M9.5 19.25h5a2.5 2.5 0 0 1-5 0Z" />
          </svg>
          @if (unread() > 0) {
            <span class="notif-badge" data-testid="notif-badge" aria-hidden="true">{{ unread() > 9 ? '9+' : unread() }}</span>
          }
        </button>

        @if (open()) {
          <div class="notif-panel" role="menu" data-testid="notif-panel">
            <header class="notif-panel-head">
              <strong>{{ 'notifications.title' | translate }}</strong>
              @if (unread() > 0) {
                <button type="button" class="link-btn small" (click)="markAll()" data-testid="notif-read-all">{{ 'notifications.markAll' | translate }}</button>
              }
            </header>
            @for (n of items(); track n.id) {
              <button type="button" class="notif-item" [class.unread]="!n.readAt" (click)="onItem(n)" [attr.data-testid]="'notif-item-' + n.id">
                <span class="notif-item-title">{{ typeTitle(n) }}</span>
                @if (n.body) { <span class="notif-item-body">{{ n.body }}</span> }
                <time class="muted small">{{ n.createdAt | localizedDate: 'short' }}</time>
              </button>
            } @empty {
              <p class="muted small notif-empty" data-testid="notif-empty">{{ 'notifications.empty' | translate }}</p>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .notif-bell { position: relative; display: inline-flex; }
      /* Icono LIMPIO sin fondo (moderno). El header es superficie SIEMPRE oscura → el
         icono va claro fijo (usar --pe-text lo volvía invisible en el tema día). Bell
         RELLENA para que se vea nítida (el trazo fino se perdía como un puntito). */
      /* El botón-ícono NO debe heredar el fondo/borde del botón temático global
         (button base). Se anula con !important en TODOS los estados → sin caja, solo
         el icono limpio. Hover = leve cambio de opacidad. */
      .notif-trigger,
      .notif-trigger:hover,
      .notif-trigger:focus,
      .notif-trigger:active {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
      }
      .notif-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        padding: 0;
        color: #f5f6fa;
        cursor: pointer;
        opacity: 0.9;
        transition: opacity 0.15s ease;
      }
      .notif-trigger:hover { opacity: 1; }
      .notif-trigger:focus-visible { outline: 2px solid var(--pe-accent); outline-offset: 3px; border-radius: 50%; }
      .notif-icon { display: block; }
      .notif-badge { position: absolute; top: 2px; right: 2px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: var(--pe-danger); color: #fff; font-size: 0.68rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
      /* El panel es una superficie propia: RESETEA el color al del tema (si no, hereda
         el texto claro del header y se mezcla con el fondo claro en el tema día). */
      .notif-panel { position: absolute; top: 110%; right: 0; z-index: 950; width: min(360px, 92vw); max-height: 70vh; overflow-y: auto; background: var(--pe-surface); color: var(--pe-text); border: 1px solid var(--pe-border); border-radius: var(--pe-radius-sm); box-shadow: var(--pe-shadow); }
      .notif-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--pe-border); position: sticky; top: 0; background: var(--pe-surface); }
      .notif-item { display: flex; flex-direction: column; gap: 0.15rem; width: 100%; text-align: left; padding: 0.6rem 0.8rem; border: none; border-bottom: 1px solid var(--pe-border); background: none; color: var(--pe-text); cursor: pointer; }
      .notif-item:hover { background: var(--pe-surface-2); }
      .notif-item.unread { background: var(--pe-accent-soft); }
      .notif-item-title { font-weight: 600; }
      .notif-item-body { font-size: 0.85rem; color: var(--pe-text-muted, #6b6b76); }
      .notif-empty { padding: 1rem 0.8rem; text-align: center; }
    `,
  ],
})
export class NotificationBellComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = inject(SessionStore);
  private readonly api = inject(NotificationsApi);
  private readonly socket = inject(NotificationsSocketService);

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  protected readonly unread = signal(0);
  protected readonly items = signal<AppNotification[]>([]);
  protected readonly open = signal(false);
  private started = false;

  protected readonly visible = computed(
    () => this.isBrowser && this.session.isAuthenticated() && this.session.hasAnyRole(['admin', 'advisor', 'promoter']),
  );

  constructor() {
    effect(() => {
      if (this.visible() && !this.started) {
        this.started = true;
        this.refreshCount();
        void this.socket.connect();
        this.socket.notification$.subscribe((n) => {
          this.items.update((list) => [n, ...list].slice(0, 50));
          this.unread.update((c) => c + 1);
        });
        this.socket.unread$.subscribe((c) => this.unread.set(c));
      }
    });
  }

  private refreshCount(): void {
    this.api.unreadCount().subscribe({ next: (r) => this.unread.set(r.count), error: () => undefined });
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) this.api.list().subscribe({ next: (p) => this.items.set(p.items), error: () => undefined });
  }

  protected onItem(n: AppNotification): void {
    if (!n.readAt) {
      this.api.read(n.id).subscribe({
        next: (r) => {
          this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
          this.unread.set(r.unread);
        },
        error: () => undefined,
      });
    }
  }

  protected markAll(): void {
    this.api.readAll().subscribe({
      next: () => {
        const now = new Date().toISOString();
        this.items.update((list) => list.map((x) => ({ ...x, readAt: x.readAt ?? now })));
        this.unread.set(0);
      },
      error: () => undefined,
    });
  }

  /** Título mostrado: el propio de la notificación (ya viene redactado por el backend). */
  protected typeTitle(n: AppNotification): string {
    return n.title;
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.open()) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.notif-bell')) return;
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }
}

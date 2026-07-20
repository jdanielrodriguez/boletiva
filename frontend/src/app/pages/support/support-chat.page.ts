import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import {
  ChatApi,
  type ChatMessage,
  type ChatThread,
  type QueueFilters,
  type SupportCategory,
  type SupportMacro,
  type SupportPriority,
  type SupportStatus,
} from '../../core/api/chat.api';
import { ChatSocketService } from '../../core/chat/chat-socket.service';
import { SessionStore } from '../../core/auth/session.store';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';

const CATEGORIES: SupportCategory[] = ['billing', 'payments_settlement', 'event', 'technical', 'account', 'other'];
const PRIORITIES: SupportPriority[] = ['low', 'medium', 'high', 'urgent'];
const AGENT_STATUS: (SupportStatus | '')[] = ['', 'new', 'open', 'awaiting_support', 'awaiting_promoter', 'resolved', 'suspended'];

/**
 * Workspace de soporte (T3). Un solo punto de entrada que se adapta al rol:
 *  - PROMOTOR: abre tickets (con categoría/prioridad), chatea, archiva y califica.
 *  - AGENTE (asesor/admin): bandeja con filtros (sin-asignar/míos/estado) + "cargar más"
 *    (keyset), acciones de ciclo de vida (tomar/resolver/suspender/reanudar/reabrir/
 *    cerrar/prioridad/categoría), notas internas y respuestas rápidas (macros).
 * Entrega en vivo por socket.io (ref-count compartido con la burbuja global).
 */
@Component({
  selector: 'app-support-chat',
  imports: [FormsModule, TranslatePipe, LocalizedDatePipe, StatusLabelPipe, EmptyStateComponent],
  templateUrl: './support-chat.page.html',
})
export class SupportChatPage implements OnDestroy {
  private readonly api = inject(ChatApi);
  private readonly socket = inject(ChatSocketService);
  private readonly session = inject(SessionStore);
  private readonly config = inject(PublicConfigStore);
  private readonly i18n = inject(I18nService);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly categories = CATEGORIES;
  protected readonly priorities = PRIORITIES;
  protected readonly agentStatuses = AGENT_STATUS;

  protected readonly chatEnabled = computed(() => this.config.chatEnabled());
  protected readonly isAgent = computed(() => this.session.hasAnyRole(['admin', 'advisor']));
  protected readonly canOpen = computed(() => this.session.hasRole('promoter') && !this.isAgent());
  protected readonly myId = computed(() => this.session.user()?.id ?? '');

  protected readonly threads = signal<ChatThread[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly active = signal<ChatThread | null>(null);
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly composingNew = signal(false);
  protected readonly working = signal(false);
  protected readonly draft = signal('');
  protected readonly internalNote = signal(false);

  // Promotor: crear ticket
  protected readonly newSubject = signal('');
  protected readonly newBody = signal('');
  protected readonly newCategory = signal<SupportCategory>('other');
  protected readonly newPriority = signal<SupportPriority>('medium');
  protected readonly showArchived = signal(false);

  // Agente: filtros de la cola
  protected readonly quick = signal<'unassigned' | 'mine' | 'all'>('unassigned');
  protected readonly statusFilter = signal<SupportStatus | ''>('');
  protected readonly macros = signal<SupportMacro[]>([]);
  protected readonly showMacros = signal(false);

  constructor() {
    this.config.load();
    if (!this.chatEnabled()) return;
    if (this.isAgent()) {
      this.loadQueue(true);
      this.loadMacros();
    } else {
      this.reloadOwn();
    }
    void this.socket.acquire();
    this.socket.message$.subscribe((m) => {
      if (this.active()?.id === m.ticketId && !this.messages().some((x) => x.id === m.id)) {
        this.messages.update((list) => [...list, m]);
      }
    });
    this.socket.activity$.subscribe(() => this.reloadList());
  }

  ngOnDestroy(): void {
    if (this.chatEnabled()) this.socket.release();
  }

  // --- Carga de listas ---
  private reloadList(): void {
    if (this.isAgent()) this.loadQueue(true);
    else this.reloadOwn();
  }

  private reloadOwn(): void {
    this.api.listThreads(this.showArchived()).subscribe({
      next: (t) => this.threads.set(t),
      error: () => undefined,
    });
  }

  protected loadQueue(reset: boolean): void {
    const filters: QueueFilters = {
      status: this.statusFilter() || undefined,
      unassigned: this.quick() === 'unassigned',
      mine: this.quick() === 'mine',
    };
    this.api.queue(filters, reset ? undefined : (this.nextCursor() ?? undefined)).subscribe({
      next: (page) => {
        this.threads.set(reset ? page.items : [...this.threads(), ...page.items]);
        this.nextCursor.set(page.nextCursor);
      },
      error: () => undefined,
    });
  }

  protected setQuick(q: 'unassigned' | 'mine' | 'all'): void {
    this.quick.set(q);
    this.loadQueue(true);
  }
  protected setStatus(s: SupportStatus | ''): void {
    this.statusFilter.set(s);
    this.loadQueue(true);
  }
  protected toggleArchived(): void {
    this.showArchived.update((v) => !v);
    this.reloadOwn();
  }

  private loadMacros(): void {
    this.api.listMacros(this.i18n.locale().startsWith('en') ? 'en' : 'es').subscribe({
      next: (m) => this.macros.set(m),
      error: () => undefined,
    });
  }

  // --- Crear (promotor) ---
  protected startNew(): void {
    this.composingNew.set(true);
    this.active.set(null);
    this.newSubject.set('');
    this.newBody.set('');
    this.newCategory.set('other');
    this.newPriority.set('medium');
  }

  protected createThread(): void {
    if (this.working() || !this.newSubject().trim() || !this.newBody().trim()) return;
    this.working.set(true);
    this.api
      .createThread(this.newSubject().trim(), this.newBody().trim(), {
        category: this.newCategory(),
        priority: this.newPriority(),
      })
      .subscribe({
        next: (t) => {
          this.working.set(false);
          this.composingNew.set(false);
          this.reloadList();
          this.open(t);
        },
        error: () => {
          this.working.set(false);
          this.toasts.error(this.translate.instant('chat.sendError'));
        },
      });
  }

  // --- Abrir / mensajes ---
  protected open(t: ChatThread): void {
    this.composingNew.set(false);
    this.active.set(t);
    this.showMacros.set(false);
    this.api.getMessages(t.id).subscribe({
      next: (res) => {
        this.messages.set(res.messages);
        this.active.set(res.ticket);
        this.socket.joinThread(t.id);
      },
      error: () => undefined,
    });
  }

  protected send(): void {
    const t = this.active();
    const body = this.draft().trim();
    if (!t || !body || this.working()) return;
    this.working.set(true);
    const note = this.isAgent() && this.internalNote();
    this.api.postMessage(t.id, body, note).subscribe({
      next: (m) => {
        this.working.set(false);
        this.draft.set('');
        if (!this.messages().some((x) => x.id === m.id)) this.messages.update((list) => [...list, m]);
        // El estado del ticket pudo cambiar (awaiting_*). Refresca cabecera + lista.
        this.refreshActive();
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('chat.sendError'));
      },
    });
  }

  protected applyMacro(m: SupportMacro): void {
    this.draft.update((d) => (d ? `${d}\n${m.body}` : m.body));
    this.showMacros.set(false);
  }

  private refreshActive(): void {
    const t = this.active();
    if (!t) return;
    this.api.getMessages(t.id).subscribe({
      next: (res) => {
        this.active.set(res.ticket);
        this.reloadList();
      },
      error: () => undefined,
    });
  }

  // --- Acciones de ciclo de vida ---
  private act(op: (id: string) => ReturnType<ChatApi['resolve']>): void {
    const t = this.active();
    if (!t || this.working()) return;
    this.working.set(true);
    op(t.id).subscribe({
      next: (u) => {
        this.working.set(false);
        this.active.set(u);
        this.reloadList();
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('chat.actionError'));
      },
    });
  }

  protected take(): void {
    this.act((id) => this.api.take(id));
  }
  protected resolve(): void {
    this.act((id) => this.api.resolve(id));
  }
  protected suspend(): void {
    this.act((id) => this.api.suspend(id));
  }
  protected resume(): void {
    this.act((id) => this.api.resume(id));
  }
  protected reopen(): void {
    this.act((id) => this.api.reopen(id));
  }
  protected close(): void {
    this.act((id) => this.api.close(id));
  }
  protected changePriority(p: SupportPriority): void {
    this.act((id) => this.api.setPriority(id, p));
  }
  protected changeCategory(c: SupportCategory): void {
    this.act((id) => this.api.setCategory(id, c));
  }

  protected archive(): void {
    const t = this.active();
    if (!t) return;
    this.api.archive(t.id).subscribe({
      next: () => {
        this.active.set(null);
        this.reloadList();
        this.toasts.success(this.translate.instant('chat.archived'));
      },
      error: () => this.toasts.error(this.translate.instant('chat.actionError')),
    });
  }

  protected rate(score: number): void {
    const t = this.active();
    if (!t) return;
    this.api.rate(t.id, score).subscribe({
      next: (u) => {
        this.active.set(u);
        this.toasts.success(this.translate.instant('chat.rated'));
      },
      error: () => this.toasts.error(this.translate.instant('chat.actionError')),
    });
  }

  // --- Helpers de presentación ---
  protected canWrite(t: ChatThread): boolean {
    return t.status !== 'closed';
  }

  /** Pista de SLA del ticket: objetivo relevante (1ª resp o resolución) vs ahora. */
  protected slaHint(t: ChatThread): { text: string; breached: boolean } | null {
    if (t.status === 'closed' || t.status === 'resolved' || t.status === 'suspended') return null;
    const due = !t.firstRespondedAt ? t.firstResponseDueAt : t.resolveDueAt;
    const kind = !t.firstRespondedAt ? 'first' : 'res';
    if (!due) return null;
    const diffMin = Math.round((new Date(due).getTime() - Date.now()) / 60_000);
    if (diffMin < 0) {
      return { text: this.translate.instant('chat.slaBreached', { kind: this.slaKind(kind) }), breached: true };
    }
    const human = diffMin >= 60 ? `${Math.floor(diffMin / 60)}h ${diffMin % 60}m` : `${diffMin}m`;
    return { text: this.translate.instant('chat.slaDue', { kind: this.slaKind(kind), t: human }), breached: false };
  }
  private slaKind(k: 'first' | 'res'): string {
    return this.translate.instant(k === 'first' ? 'chat.slaFirst' : 'chat.slaResolution');
  }
}

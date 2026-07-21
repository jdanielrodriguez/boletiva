import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import {
  ChatApi,
  type ChatMessage,
  type ChatThread,
  type QueueFilters,
  type SupportCategory,
  type SupportAgent,
  type SupportMacro,
  type SupportMetrics,
  type SupportPriority,
  type SupportStatus,
  type UploadedAttachment,
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
  imports: [FormsModule, RouterLink, TranslatePipe, LocalizedDatePipe, StatusLabelPipe, EmptyStateComponent],
  templateUrl: './support-chat.page.html',
})
export class SupportChatPage implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
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

  /** Embebido en otra página con su propio <h1> (consola admin) → título como <h2>. */
  readonly embedded = input(false);
  protected readonly chatEnabled = computed(() => this.config.chatEnabled());
  protected readonly isAgent = computed(() => this.session.hasAnyRole(['admin', 'advisor']));
  /** Solo el admin reasigna tickets entre asesores (T7f; backend assign es admin-only). */
  protected readonly isAdmin = computed(() => this.session.hasRole('admin'));
  protected readonly canOpen = computed(() => this.session.hasRole('promoter') && !this.isAgent());
  protected readonly myId = computed(() => this.session.user()?.id ?? '');

  protected readonly threads = signal<ChatThread[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  /** El backend gatea el soporte por beneficio premium; un 403 en la carga → upsell (M-4). */
  protected readonly premiumRequired = signal(false);
  /** Estado de carga/error de la bandeja (evita el falso "sin tickets" y errores silenciados). */
  protected readonly loading = signal(false);
  protected readonly listError = signal(false);
  /** ¿El agente ya cargó más allá de la 1ª página? (para no resetear la cola con cada actividad). */
  private readonly pagedBeyond = signal(false);
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
  /** Agentes para el selector de reasignación (admin). */
  protected readonly agents = signal<SupportAgent[]>([]);

  // Adjuntos pendientes de enviar + métricas del agente
  protected readonly pendingFiles = signal<File[]>([]);
  protected readonly metrics = signal<SupportMetrics | null>(null);
  protected readonly showMetrics = signal(false);

  constructor() {
    this.config.load();
    if (!this.chatEnabled()) return;
    if (this.isAgent()) {
      this.loadQueue(true);
      this.loadMacros();
      this.loadMetrics();
      if (this.isAdmin()) this.api.listAgents().subscribe({ next: (a) => this.agents.set(a), error: () => undefined });
    } else {
      this.reloadOwn();
    }
    void this.socket.acquire();
    this.socket.message$.subscribe((m) => {
      // Defensa en profundidad: un no-agente NUNCA muestra notas internas (el backend ya
      // no se las emite, pero por si acaso llegara una).
      if (m.internalNote && !this.isAgent()) return;
      if (this.active()?.id === m.ticketId && !this.messages().some((x) => x.id === m.id)) {
        this.messages.update((list) => [...list, m]);
      }
    });
    this.socket.activity$.subscribe((a) => this.applyActivity(a.ticketId));
    // Auto-scroll al fondo SOLO cuando conviene (QA final): al abrir/cargar un ticket,
    // cuando el último mensaje es MÍO (acabo de enviar), o si el usuario YA estaba cerca
    // del fondo. Un mensaje entrante mientras leo historial arriba NO arrebata la vista.
    effect(() => {
      const msgs = this.messages();
      const prev = this.prevMsgCount;
      this.prevMsgCount = msgs.length;
      if (msgs.length === 0) return;
      const justLoaded = prev === 0;
      const lastMine = msgs[msgs.length - 1]?.senderId === this.myId();
      setTimeout(() => {
        const box = this.host.nativeElement.querySelector('[data-testid="chat-messages"]') as HTMLElement | null;
        if (!box) return;
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
        if (justLoaded || lastMine || nearBottom) box.scrollTop = box.scrollHeight;
      }, 0);
    });
  }

  /** Nº de mensajes en el render anterior (para decidir el auto-scroll). */
  private prevMsgCount = 0;

  ngOnDestroy(): void {
    if (this.chatEnabled()) this.socket.release();
  }

  // --- Carga de listas ---
  private reloadList(): void {
    if (this.isAgent()) this.loadQueue(true);
    else this.reloadOwn();
  }

  /**
   * Actividad en vivo de un ticket (socket). Preserva la paginación/scroll del agente:
   *  - si el ticket está abierto, los mensajes ya llegan por message$ (no toca la lista);
   *  - si está visible en la cola, lo sube al frente SIN refetch;
   *  - si no está visible pero seguimos en la 1ª página, refetch barato de la 1ª página;
   *  - si el agente ya paginó ("cargar más"), NO resetea la cola (evita perder páginas).
   */
  private applyActivity(ticketId: string): void {
    if (this.active()?.id === ticketId) return;
    if (!this.isAgent()) {
      this.reloadOwn();
      return;
    }
    const list = this.threads();
    const idx = list.findIndex((t) => t.id === ticketId);
    if (idx > 0) {
      this.threads.set([list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)]);
    } else if (idx === -1 && !this.pagedBeyond()) {
      this.loadQueue(true);
    }
  }

  private reloadOwn(): void {
    this.loading.set(true);
    this.listError.set(false);
    this.api.listThreads(this.showArchived()).subscribe({
      next: (t) => {
        this.threads.set(t);
        this.loading.set(false);
      },
      error: (err: { status?: number }) => {
        this.loading.set(false);
        // 403 del promotor no premium → upsell en vez de "error" genérico (M-4).
        if (err?.status === 403) this.premiumRequired.set(true);
        else this.listError.set(true);
      },
    });
  }

  protected loadQueue(reset: boolean): void {
    const filters: QueueFilters = {
      status: this.statusFilter() || undefined,
      unassigned: this.quick() === 'unassigned',
      mine: this.quick() === 'mine',
    };
    if (reset) {
      this.loading.set(true);
      this.listError.set(false);
      this.pagedBeyond.set(false);
    } else {
      this.pagedBeyond.set(true);
    }
    this.api.queue(filters, reset ? undefined : (this.nextCursor() ?? undefined)).subscribe({
      next: (page) => {
        this.threads.set(reset ? page.items : [...this.threads(), ...page.items]);
        this.nextCursor.set(page.nextCursor);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        if (reset) this.listError.set(true);
      },
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

  protected loadMetrics(): void {
    this.api.metrics().subscribe({ next: (m) => this.metrics.set(m), error: () => undefined });
  }
  protected toggleMetrics(): void {
    this.showMetrics.update((v) => !v);
    if (this.showMetrics()) this.loadMetrics();
  }

  // --- Adjuntos ---
  protected onFiles(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.pendingFiles.set(input.files ? Array.from(input.files) : []);
  }
  protected clearFiles(): void {
    this.pendingFiles.set([]);
  }

  /** Sube cada archivo (presign → PUT directo) y devuelve los adjuntos listos para el mensaje. */
  private async uploadFiles(ticketId: string): Promise<UploadedAttachment[]> {
    const files = this.pendingFiles();
    const out: UploadedAttachment[] = [];
    for (const f of files) {
      const { key, uploadUrl } = await firstValueFrom(this.api.presignAttachment(ticketId, f.name, f.type));
      const res = await fetch(uploadUrl, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
      if (!res.ok) throw new Error('upload failed');
      out.push({ key, filename: f.name, mime: f.type, size: f.size });
    }
    return out;
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
    const hasFiles = this.pendingFiles().length > 0;
    if (!t || (!body && !hasFiles) || this.working()) return;
    this.working.set(true);
    const note = this.isAgent() && this.internalNote();
    void this.uploadFiles(t.id)
      .then((attachments) => {
        this.api.postMessage(t.id, body || ' ', note, attachments).subscribe({
          next: (m) => {
            this.working.set(false);
            this.draft.set('');
            this.clearFiles();
            if (!this.messages().some((x) => x.id === m.id)) this.messages.update((list) => [...list, m]);
            this.refreshActive();
          },
          error: () => {
            this.working.set(false);
            this.toasts.error(this.translate.instant('chat.sendError'));
          },
        });
      })
      .catch(() => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('chat.uploadError'));
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
  /** (Admin) Reasigna el ticket a otro agente. */
  protected reassign(agentId: string): void {
    if (!agentId) return;
    this.act((id) => this.api.assign(id, agentId));
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

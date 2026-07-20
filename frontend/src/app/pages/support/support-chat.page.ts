import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { ChatApi, type ChatMessage, type ChatThread } from '../../core/api/chat.api';
import { ChatSocketService } from '../../core/chat/chat-socket.service';
import { SessionStore } from '../../core/auth/session.store';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';

/**
 * Chat de soporte (B3). El promotor PREMIUM abre hilos y escribe; asesor/admin ven
 * TODOS los hilos y responden. Entrega en vivo por socket.io. Gating por
 * `chat.enabled` (config pública) + rol/beneficios (el backend es la autoridad).
 */
@Component({
  selector: 'app-support-chat',
  imports: [FormsModule, TranslatePipe, LocalizedDatePipe, StatusLabelPipe, EmptyStateComponent],
  template: `
    <section class="support-chat">
      <h1>{{ 'chat.title' | translate }}</h1>

      @if (!chatEnabled()) {
        <app-empty-state variant="generic" [title]="'chat.disabledTitle' | translate" [subtitle]="'chat.disabledSubtitle' | translate" />
      } @else {
        <div class="chat-layout">
          <aside class="chat-threads" data-testid="chat-threads">
            @if (canOpen()) {
              <button type="button" class="btn primary btn-block" (click)="startNew()" data-testid="chat-new">
                {{ 'chat.newThread' | translate }}
              </button>
            }
            @for (t of threads(); track t.id) {
              <button type="button" class="chat-thread-item" [class.active]="active()?.id === t.id"
                (click)="open(t)" [attr.data-testid]="'chat-thread-' + t.id">
                <strong>{{ t.subject }}</strong>
                <span class="badge badge-{{ t.status }}">{{ t.status | statusLabel }}</span>
                @if (isAgent() && t.promoter) { <span class="muted small">{{ t.promoter.firstName }}</span> }
              </button>
            } @empty {
              <p class="muted small" data-testid="chat-empty">{{ 'chat.noThreads' | translate }}</p>
            }
          </aside>

          <div class="chat-main">
            @if (composingNew()) {
              <form class="chat-compose-new" (ngSubmit)="createThread()">
                <input [(ngModel)]="newSubject" name="subject" [placeholder]="'chat.subject' | translate" data-testid="chat-subject" />
                <textarea [(ngModel)]="newBody" name="body" rows="3" [placeholder]="'chat.firstMessage' | translate" data-testid="chat-first-message"></textarea>
                <button type="submit" class="btn primary" [disabled]="working()" data-testid="chat-create">{{ 'chat.send' | translate }}</button>
              </form>
            } @else if (active(); as t) {
              <div class="chat-thread-head">
                <h2>{{ t.subject }}</h2>
                <div class="chat-thread-actions">
                  @if (t.status === 'open') {
                    <button type="button" class="btn small" (click)="close(t)" data-testid="chat-close">{{ 'chat.close' | translate }}</button>
                  } @else {
                    <button type="button" class="btn small" (click)="reopen(t)" data-testid="chat-reopen">{{ 'chat.reopen' | translate }}</button>
                  }
                </div>
              </div>
              <div class="chat-messages" data-testid="chat-messages" aria-live="polite" aria-atomic="false">
                @for (m of messages(); track m.id) {
                  <div class="chat-msg" [class.mine]="m.senderId === myId()" [class.agent]="m.senderRole !== 'promoter'">
                    <span class="chat-msg-body">{{ m.body }}</span>
                    <time class="muted small">{{ m.createdAt | localizedDate: 'HH:mm' }}</time>
                  </div>
                }
              </div>
              @if (t.status === 'open') {
                <form class="chat-composer" (ngSubmit)="send()">
                  <input [(ngModel)]="draft" name="draft" [attr.aria-label]="'chat.typeMessage' | translate"
                    [placeholder]="'chat.typeMessage' | translate" data-testid="chat-input" />
                  <button type="submit" class="btn primary" [disabled]="working() || !draft().trim()" data-testid="chat-send">{{ 'chat.send' | translate }}</button>
                </form>
              }
            } @else {
              <app-empty-state variant="generic" [title]="'chat.pickThread' | translate" />
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class SupportChatPage implements OnDestroy {
  private readonly api = inject(ChatApi);
  private readonly socket = inject(ChatSocketService);
  private readonly session = inject(SessionStore);
  private readonly config = inject(PublicConfigStore);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly chatEnabled = computed(() => this.config.chatEnabled());
  protected readonly isAgent = computed(() => this.session.hasAnyRole(['admin', 'advisor']));
  protected readonly canOpen = computed(() => this.session.hasRole('promoter') && !this.isAgent());
  protected readonly myId = computed(() => this.session.user()?.id ?? '');

  protected readonly threads = signal<ChatThread[]>([]);
  protected readonly active = signal<ChatThread | null>(null);
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly composingNew = signal(false);
  protected readonly working = signal(false);
  protected readonly draft = signal('');
  protected readonly newSubject = signal('');
  protected readonly newBody = signal('');

  constructor() {
    this.config.load();
    if (!this.chatEnabled()) return;
    this.reload();
    void this.socket.connect();
    this.socket.message$.subscribe((m) => {
      if (this.active()?.id === m.threadId && !this.messages().some((x) => x.id === m.id)) {
        this.messages.update((list) => [...list, m]);
      }
    });
    this.socket.activity$.subscribe(() => this.reload());
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
  }

  private reload(): void {
    this.api.listThreads().subscribe({
      next: (t) => this.threads.set(t),
      error: () => undefined,
    });
  }

  protected startNew(): void {
    this.composingNew.set(true);
    this.active.set(null);
    this.newSubject.set('');
    this.newBody.set('');
  }

  protected createThread(): void {
    if (this.working() || !this.newSubject().trim() || !this.newBody().trim()) return;
    this.working.set(true);
    this.api.createThread(this.newSubject().trim(), this.newBody().trim()).subscribe({
      next: (t) => {
        this.working.set(false);
        this.composingNew.set(false);
        this.reload();
        this.open(t);
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('chat.sendError'));
      },
    });
  }

  protected open(t: ChatThread): void {
    this.composingNew.set(false);
    this.active.set(t);
    this.api.getMessages(t.id).subscribe({
      next: (res) => {
        this.messages.set(res.messages);
        this.active.set(res.thread);
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
    this.api.postMessage(t.id, body).subscribe({
      next: (m) => {
        this.working.set(false);
        this.draft.set('');
        if (!this.messages().some((x) => x.id === m.id)) this.messages.update((list) => [...list, m]);
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('chat.sendError'));
      },
    });
  }

  protected close(t: ChatThread): void {
    this.api.close(t.id).subscribe({ next: (u) => this.active.set(u), error: () => undefined });
  }
  protected reopen(t: ChatThread): void {
    this.api.reopen(t.id).subscribe({ next: (u) => this.active.set(u), error: () => undefined });
  }
}

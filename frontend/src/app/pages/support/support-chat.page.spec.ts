import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ChatApi } from '../../core/api/chat.api';
import { ChatSocketService } from '../../core/chat/chat-socket.service';
import { SessionStore } from '../../core/auth/session.store';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ToastService } from '../../core/ui/toast.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { SupportChatPage } from './support-chat.page';

describe('SupportChatPage (B3)', () => {
  let fixture: ComponentFixture<SupportChatPage>;
  let el: HTMLElement;

  const THREADS = [
    { id: 't1', promoterId: 'p1', subject: 'Duda', status: 'open', assignedToId: null, answered: false, lastMessageAt: '', createdAt: '' },
  ];

  async function setup(opts: { chatEnabled?: boolean; roles?: string[]; api?: Record<string, unknown> } = {}) {
    const roles = opts.roles ?? ['promoter'];
    const chatEnabled = opts.chatEnabled ?? true;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        ToastService,
        {
          provide: ChatApi,
          useValue: {
            listThreads: () => of(THREADS),
            getMessages: () => of({ thread: THREADS[0], messages: [{ id: 'm1', threadId: 't1', senderId: 'p1', senderRole: 'promoter', body: 'Hola', createdAt: '' }] }),
            createThread: () => of(THREADS[0]),
            postMessage: () => of({ id: 'm2', threadId: 't1', senderId: 'p1', senderRole: 'promoter', body: 'x', createdAt: '' }),
            close: () => of({ ...THREADS[0], status: 'closed' }),
            reopen: () => of(THREADS[0]),
            ...opts.api,
          } as unknown as ChatApi,
        },
        {
          provide: ChatSocketService,
          useValue: { connect: () => Promise.resolve(), disconnect: () => undefined, joinThread: () => undefined, message$: new Subject(), activity$: new Subject() },
        },
        { provide: SessionStore, useValue: { hasRole: (r: string) => roles.includes(r), hasAnyRole: (rs: string[]) => rs.some((r) => roles.includes(r)), user: () => ({ id: 'p1' }) } },
        { provide: PublicConfigStore, useValue: { load: () => undefined, chatEnabled: () => chatEnabled } },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(SupportChatPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('chat deshabilitado → muestra estado vacío y no lista hilos', async () => {
    await setup({ chatEnabled: false });
    expect(el.querySelector('[data-testid="chat-threads"]')).toBeNull();
    expect(el.textContent).toContain('Chat no disponible');
  });

  it('promotor: ve el botón "nueva conversación" y sus hilos', async () => {
    await setup({ roles: ['promoter'] });
    expect(el.querySelector('[data-testid="chat-new"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chat-thread-t1"]')).not.toBeNull();
  });

  it('agente (admin): NO ve el botón de abrir, pero sí los hilos', async () => {
    await setup({ roles: ['admin'] });
    expect(el.querySelector('[data-testid="chat-new"]')).toBeNull();
    expect(el.querySelector('[data-testid="chat-thread-t1"]')).not.toBeNull();
  });

  it('abrir un hilo carga los mensajes y permite enviar', async () => {
    await setup();
    (el.querySelector('[data-testid="chat-thread-t1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="chat-messages"]')?.textContent).toContain('Hola');
    expect(el.querySelector('[data-testid="chat-send"]')).not.toBeNull();
  });
});

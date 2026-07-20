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

describe('SupportChatPage (T3)', () => {
  let fixture: ComponentFixture<SupportChatPage>;
  let el: HTMLElement;

  const THREADS = [
    { id: 't1', promoterId: 'p1', subject: 'Duda', status: 'open', priority: 'medium', assignedToId: null, lastMessageAt: '', createdAt: '', promoter: { id: 'p1', firstName: 'Ana', lastName: null, email: 'a@a.co' } },
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
            queue: () => of({ items: THREADS, nextCursor: null }),
            listMacros: () => of([]),
            metrics: () => of({ byStatus: {}, byCategory: {}, byPriority: {}, unassigned: 0, slaBreach: { firstResponse: 0, resolution: 0 }, csat: { avg: null, count: 0 }, resolvedTotal: 0 }),
            presignAttachment: () => of({ key: 'support/t1/x.png', uploadUrl: 'http://up' }),
            getMessages: () => of({ ticket: THREADS[0], messages: [{ id: 'm1', ticketId: 't1', senderId: 'p1', senderRole: 'promoter', body: 'Hola', createdAt: '' }] }),
            createThread: () => of(THREADS[0]),
            postMessage: () => of({ id: 'm2', ticketId: 't1', senderId: 'p1', senderRole: 'promoter', body: 'x', createdAt: '' }),
            close: () => of({ ...THREADS[0], status: 'closed' }),
            reopen: () => of(THREADS[0]),
            take: () => of({ ...THREADS[0], status: 'open' }),
            resolve: () => of({ ...THREADS[0], status: 'resolved' }),
            suspend: () => of({ ...THREADS[0], status: 'suspended' }),
            resume: () => of(THREADS[0]),
            archive: () => of(THREADS[0]),
            rate: () => of({ ...THREADS[0], csatScore: 5 }),
            ...opts.api,
          } as unknown as ChatApi,
        },
        {
          provide: ChatSocketService,
          useValue: { acquire: () => Promise.resolve(), release: () => undefined, joinThread: () => undefined, message$: new Subject(), activity$: new Subject() },
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

  it('soporte deshabilitado → estado vacío y no lista tickets', async () => {
    await setup({ chatEnabled: false });
    expect(el.querySelector('[data-testid="chat-threads"]')).toBeNull();
    expect(el.textContent).toContain('Soporte no disponible');
  });

  it('promotor: ve el botón "nuevo ticket" y sus tickets (sin filtros de agente)', async () => {
    await setup({ roles: ['promoter'] });
    expect(el.querySelector('[data-testid="chat-new"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chat-thread-t1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="q-unassigned"]')).toBeNull(); // filtros solo agente
  });

  it('agente (admin): NO ve el botón de abrir, sí la cola con filtros', async () => {
    await setup({ roles: ['admin'] });
    expect(el.querySelector('[data-testid="chat-new"]')).toBeNull();
    expect(el.querySelector('[data-testid="q-unassigned"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chat-thread-t1"]')).not.toBeNull();
  });

  it('abrir un ticket carga los mensajes y permite escribir', async () => {
    await setup();
    (el.querySelector('[data-testid="chat-thread-t1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="chat-messages"]')?.textContent).toContain('Hola');
    expect(el.querySelector('[data-testid="chat-send"]')).not.toBeNull();
  });

  it('agente al abrir un ticket ve las acciones de ciclo de vida', async () => {
    await setup({ roles: ['admin'] });
    (el.querySelector('[data-testid="chat-thread-t1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="chat-agent-actions"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chat-resolve"]')).not.toBeNull();
  });
});

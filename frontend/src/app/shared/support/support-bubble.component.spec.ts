import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ChatSocketService } from '../../core/chat/chat-socket.service';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting } from '../../core/i18n/testing';
import { SupportBubbleComponent } from './support-bubble.component';

describe('SupportBubbleComponent (T3)', () => {
  let fixture: ComponentFixture<SupportBubbleComponent>;
  let el: HTMLElement;
  let activity$: Subject<{ ticketId: string }>;
  let acquired = 0;

  async function setup(roles: string[], chatEnabled = true) {
    activity$ = new Subject();
    acquired = 0;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        provideRouter([]),
        ToastService,
        { provide: SessionStore, useValue: { hasAnyRole: (rs: string[]) => rs.some((r) => roles.includes(r)) } },
        { provide: PublicConfigStore, useValue: { load: () => undefined, chatEnabled: () => chatEnabled } },
        {
          provide: ChatSocketService,
          useValue: { acquire: () => { acquired++; return Promise.resolve(); }, activity$, message$: new Subject() },
        },
      ],
    });
    fixture = TestBed.createComponent(SupportBubbleComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('NO se muestra para un promotor', async () => {
    await setup(['promoter']);
    expect(el.querySelector('[data-testid="support-bubble"]')).toBeNull();
    expect(acquired).toBe(0);
  });

  it('se muestra para un agente y toma la conexión', async () => {
    await setup(['advisor']);
    expect(el.querySelector('[data-testid="support-bubble"]')).not.toBeNull();
    expect(acquired).toBe(1);
  });

  it('actividad de un ticket incrementa el contador de no-leídos', async () => {
    await setup(['admin']);
    activity$.next({ ticketId: 'a' });
    activity$.next({ ticketId: 'a' }); // mismo ticket → no duplica
    activity$.next({ ticketId: 'b' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.support-bubble-badge')?.textContent?.trim()).toBe('2');
  });
});

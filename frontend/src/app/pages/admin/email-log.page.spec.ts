import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { EmailLogApi, EmailLogItem, EmailLogPage as EmailLogPageResult } from '../../core/api/email-log.api';
import { EmailLogPage } from './email-log.page';

const ITEMS: EmailLogItem[] = [
  { id: 'e1', recipient: 'a@test.com', type: 'promoter_invite', subject: 'Invitación', status: 'sent', error: null, createdAt: '2026-01-01T10:00:00Z', sentAt: '2026-01-01T10:00:01Z' },
  { id: 'e2', recipient: 'b@test.com', type: 'notification:x', subject: 'Aviso', status: 'queued', error: null, createdAt: '2026-01-01T09:00:00Z', sentAt: null },
];

function setup(list: (f: unknown) => unknown = () => of({ items: ITEMS, nextCursor: null } as EmailLogPageResult)) {
  TestBed.configureTestingModule({
    providers: [
      ...provideI18nTesting(),
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: EmailLogApi, useValue: { list } },
    ],
  });
  const fixture = TestBed.createComponent(EmailLogPage);
  fixture.detectChanges();
  return fixture;
}

describe('EmailLogPage', () => {
  it('carga y pinta la tabla de correos', () => {
    const fixture = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="elog-table"]')).not.toBeNull();
    expect(el.textContent).toContain('a@test.com');
    expect(el.textContent).toContain('Invitación');
  });

  it('filtrar por estado re-consulta con el filtro (server-side)', () => {
    const spy = jasmine.createSpy('list').and.returnValue(of({ items: ITEMS, nextCursor: null }));
    const fixture = setup(spy as unknown as (f: unknown) => unknown);
    const comp = fixture.componentInstance as unknown as { onFilter: (k: string, v: string) => void };
    comp.onFilter('status', 'failed');
    fixture.detectChanges();
    expect(spy).toHaveBeenCalled();
    expect(spy.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ status: 'failed' }));
  });

  it('muestra estado de error si la carga falla', () => {
    const fixture = setup(() => {
      return { subscribe: (obs: { error: () => void }) => obs.error() } as unknown;
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="elog-table"]')).toBeNull();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { EventValidatorsComponent } from './event-validators.component';
import { ValidatorsApi } from '../../core/api/validators.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting } from '../../core/i18n/testing';

interface Priv {
  invite(): void;
  disableAll(): void;
  disable(v: { id: string; email: string; status: string }): void;
  resend(v: { id: string; email: string; status: string }): void;
  email: { set(v: string): void };
  issued(): unknown;
  hasActive(): boolean;
  confirm: { accept(): void };
}

describe('EventValidatorsComponent', () => {
  let list: jasmine.Spy;
  let invite: jasmine.Spy;
  let disable: jasmine.Spy;
  let disableAll: jasmine.Spy;
  let enable: jasmine.Spy;

  async function setup(rows: unknown[] = []) {
    list = jasmine.createSpy('list').and.returnValue(of(rows));
    // El acceso ya NO trae `code`: solo la url del enlace.
    invite = jasmine
      .createSpy('invite')
      .and.returnValue(of({ id: 'i1', email: 'val@x.com', status: 'active', url: 'http://x/validar/tok' }));
    disable = jasmine.createSpy('disable').and.returnValue(of({ disabled: true }));
    disableAll = jasmine.createSpy('disableAll').and.returnValue(of({ disabled: 2 }));
    enable = jasmine
      .createSpy('enable')
      .and.returnValue(of({ id: 'i1', email: 'val@x.com', status: 'active', url: 'http://x/validar/tok2' }));

    await TestBed.configureTestingModule({
      imports: [EventValidatorsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideI18nTesting(),
        { provide: ValidatorsApi, useValue: { list, invite, disable, disableAll, enable } },
        {
          provide: ToastService,
          useValue: { success: jasmine.createSpy(), error: jasmine.createSpy(), info: jasmine.createSpy() },
        },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<EventValidatorsComponent> = TestBed.createComponent(EventValidatorsComponent);
    fixture.componentRef.setInput('eventId', 'ev-1');
    fixture.detectChanges();
    await new Promise((r) => queueMicrotask(() => r(null))); // deja correr el load() del constructor
    fixture.detectChanges();
    return fixture;
  }

  it('carga la lista de validadores del evento al iniciar', async () => {
    await setup([{ id: 'a', email: 'a@x.com', status: 'active' }]);
    expect(list).toHaveBeenCalledWith('ev-1');
  });

  it('invitar llama al API y muestra el acceso emitido (SOLO el enlace, sin código) una vez', async () => {
    const f = await setup();
    const c = f.componentInstance as unknown as Priv;
    c.email.set('val@x.com');
    c.invite();
    expect(invite).toHaveBeenCalledWith('ev-1', 'val@x.com');
    expect(c.issued()).toBeTruthy();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="validators-issued"]')).not.toBeNull();
    // Se muestra el botón de copiar enlace; ya NO hay fila de código.
    expect(el.querySelector('[data-testid="validators-copy-link"]')).not.toBeNull();
    expect(el.textContent).not.toContain('123456');
  });

  it('reenviar enlace de un validador activo llama a enable (rota el token) y muestra el nuevo acceso', async () => {
    const f = await setup([{ id: 'v9', email: 'v@x.com', status: 'active' }]);
    const c = f.componentInstance as unknown as Priv;
    c.resend({ id: 'v9', email: 'v@x.com', status: 'active' });
    expect(enable).toHaveBeenCalledWith('ev-1', 'v9');
    expect(c.issued()).toBeTruthy();
  });

  it('sin validadores activos NO se ofrece "deshabilitar todos"', async () => {
    const off = await setup([{ id: 'a', email: 'a@x.com', status: 'disabled' }]);
    expect((off.componentInstance as unknown as Priv).hasActive()).toBe(false);
  });

  it('con validadores activos, "deshabilitar todos" confirma y llama al API', async () => {
    const on = await setup([{ id: 'b', email: 'b@x.com', status: 'active' }]);
    const c = on.componentInstance as unknown as Priv;
    expect(c.hasActive()).toBe(true);
    c.disableAll();
    c.confirm.accept(); // confirma el modal
    expect(disableAll).toHaveBeenCalledWith('ev-1');
  });

  it('deshabilitar un validador pide confirmación y llama al API', async () => {
    const f = await setup([{ id: 'v9', email: 'v@x.com', status: 'active' }]);
    const c = f.componentInstance as unknown as Priv;
    c.disable({ id: 'v9', email: 'v@x.com', status: 'active' });
    c.confirm.accept();
    expect(disable).toHaveBeenCalledWith('ev-1', 'v9');
  });
});

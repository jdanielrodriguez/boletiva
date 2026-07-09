import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { InvitationsApi } from '../../core/api/invitations.api';
import { Register } from './register';

describe('Register (F4)', () => {
  let fixture: ComponentFixture<Register>;
  let el: HTMLElement;
  let signup: jasmine.Spy;
  let peek: jasmine.Spy;
  let accept: jasmine.Spy;
  let navSpy: jasmine.Spy;

  async function setup(token?: string, opts: { signupOk?: boolean } = {}) {
    signup = jasmine.createSpy('signup').and.returnValue(opts.signupOk === false ? throwError(() => new Error('dup')) : of({ user: {}, tokens: {} }));
    peek = jasmine.createSpy('peek').and.returnValue(of({ email: 'inv@correo.com', valid: true }));
    accept = jasmine.createSpy('accept').and.returnValue(of({ accepted: true }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: { signup } },
        { provide: InvitationsApi, useValue: { peek, accept } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });
    fixture = TestBed.createComponent(Register);
    navSpy = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const set = (name: string, value: string) => {
    const c = fixture.componentInstance as unknown as Record<string, { set: (v: string) => void }>;
    c[name].set(value);
  };
  const submit = () => {
    (el.querySelector('[data-testid="rg-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('alta normal: signup y navega a verificar-correo', async () => {
    await setup();
    set('firstName', 'Ana');
    set('email', 'ana@correo.com');
    set('password', 'Password123');
    submit();
    expect(signup).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/verificar-correo']);
  });

  it('validación: campos vacíos → error, no llama signup', async () => {
    await setup();
    submit();
    expect(signup).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="rg-error"]')).not.toBeNull();
  });

  it('con token de invitación: peek precarga el correo (bloqueado) y muestra nota', async () => {
    await setup('inv-token');
    expect(peek).toHaveBeenCalledWith('inv-token');
    expect(el.querySelector('[data-testid="invited-note"]')).not.toBeNull();
    const email = el.querySelector('[data-testid="rg-email"]') as HTMLInputElement;
    expect(email.value).toBe('inv@correo.com');
    expect(email.readOnly).toBe(true);
  });

  it('con token: tras el alta acepta la invitación y navega', async () => {
    await setup('inv-token');
    set('firstName', 'Ana');
    set('password', 'Password123');
    submit();
    expect(signup).toHaveBeenCalled();
    expect(accept).toHaveBeenCalledWith('inv-token');
    expect(navSpy).toHaveBeenCalledWith(['/verificar-correo']);
  });

  it('signup falla → muestra error', async () => {
    await setup(undefined, { signupOk: false });
    set('firstName', 'Ana');
    set('email', 'dup@correo.com');
    set('password', 'Password123');
    submit();
    expect(el.querySelector('[data-testid="rg-error"]')).not.toBeNull();
  });
});

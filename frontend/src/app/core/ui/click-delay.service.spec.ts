import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PublicConfigStore } from '../config/public-config.store';
import { SessionStore } from '../auth/session.store';
import { ClickDelayService } from './click-delay.service';

describe('ClickDelayService', () => {
  let enabled: ReturnType<typeof signal<boolean>>;
  let ms: ReturnType<typeof signal<number>>;
  let roles: string[];

  function setup(): ClickDelayService {
    enabled = signal(true);
    ms = signal(200);
    roles = [];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ClickDelayService,
        { provide: PublicConfigStore, useValue: { clickDelayEnabled: enabled, clickDelayMs: ms } },
        { provide: SessionStore, useValue: { hasAnyRole: (r: string[]) => r.some((x) => roles.includes(x)) } },
      ],
    });
    const svc = TestBed.inject(ClickDelayService);
    svc.install();
    return svc;
  }

  function clickButton(): void {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.click();
    btn.remove();
  }

  it('activa el velo al hacer clic en un botón (cliente) y lo apaga tras el delay', () => {
    jasmine.clock().install();
    const svc = setup();
    clickButton();
    expect(svc.active()).toBe(true);
    jasmine.clock().tick(201);
    expect(svc.active()).toBe(false);
    jasmine.clock().uninstall();
  });

  it('NO aplica a staff (admin/promotor/asesor)', () => {
    const svc = setup();
    roles = ['admin'];
    clickButton();
    expect(svc.active()).toBe(false);
  });

  it('NO aplica si está deshabilitado por config', () => {
    const svc = setup();
    enabled.set(false);
    clickButton();
    expect(svc.active()).toBe(false);
  });

  it('ignora clics fuera de controles interactivos (texto plano)', () => {
    const svc = setup();
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.click();
    div.remove();
    expect(svc.active()).toBe(false);
  });
});

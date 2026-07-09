import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  function make(platform: 'browser' | 'server' = 'browser'): ToastService {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ToastService,
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    return TestBed.inject(ToastService);
  }

  it('encola un toast por severidad con su tipo y mensaje', () => {
    const t = make();
    t.success('ok');
    t.error('malo');
    const list = t.toasts();
    expect(list.length).toBe(2);
    expect(list[0].kind).toBe('success');
    expect(list[0].message).toBe('ok');
    expect(list[1].kind).toBe('error');
  });

  it('dismiss elimina solo el toast indicado', () => {
    const t = make();
    const id = t.info('uno');
    t.warning('dos');
    t.dismiss(id);
    const list = t.toasts();
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe('warning');
  });

  it('auto-cierra tras la duración (navegador)', () => {
    jasmine.clock().install();
    try {
      const t = make('browser');
      t.success('desaparece', 1000);
      expect(t.toasts().length).toBe(1);
      jasmine.clock().tick(1000);
      expect(t.toasts().length).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('duration 0 no auto-cierra', () => {
    jasmine.clock().install();
    try {
      const t = make('browser');
      t.error('persistente', 0);
      jasmine.clock().tick(60000);
      expect(t.toasts().length).toBe(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('en SSR (server) no agenda timer (no revienta) y el toast queda', () => {
    jasmine.clock().install();
    try {
      const t = make('server');
      t.info('ssr', 1000);
      jasmine.clock().tick(2000);
      expect(t.toasts().length).toBe(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('clear vacía la cola', () => {
    const t = make();
    t.success('a');
    t.success('b');
    t.clear();
    expect(t.toasts().length).toBe(0);
  });
});

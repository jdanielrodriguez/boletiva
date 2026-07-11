import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { ImpersonationBannerComponent } from './impersonation-banner.component';

describe('ImpersonationBannerComponent (v3.8)', () => {
  let fixture: ComponentFixture<ImpersonationBannerComponent>;
  let el: HTMLElement;
  const activeSig = signal(true);
  const stop = jasmine.createSpy('stop').and.returnValue(of(null));

  async function setup(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        ToastService,
        {
          provide: ImpersonationService,
          useValue: {
            active: () => activeSig(),
            asUser: () => ({ firstName: 'Leo', lastName: 'G', email: 'leo@x.com' }),
            stop,
          },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(ImpersonationBannerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('muestra el banner con el nombre del promotor cuando hay impersonación', async () => {
    activeSig.set(true);
    await setup();
    const banner = el.querySelector('[data-testid="impersonation-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Leo G');
  });

  it('no se muestra cuando no hay impersonación', async () => {
    activeSig.set(false);
    await setup();
    expect(el.querySelector('[data-testid="impersonation-banner"]')).toBeNull();
    activeSig.set(true);
  });

  it('"Salir de la vista" llama stop y navega a la consola', async () => {
    activeSig.set(true);
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    (el.querySelector('[data-testid="impersonation-exit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(stop).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith('/configuracion?tab=promotores');
  });
});

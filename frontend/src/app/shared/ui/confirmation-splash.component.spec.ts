import { Component } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationSplashComponent } from './confirmation-splash.component';

@Component({
  imports: [ConfirmationSplashComponent],
  template: `
    <app-confirmation-splash [icon]="icon" [title]="title" [message]="message" [redirectLabel]="redirectLabel">
      @if (withCta) {
        <a class="btn primary" data-testid="cta" href="/">ir</a>
      }
    </app-confirmation-splash>
  `,
})
class Host {
  icon: 'check' | 'mail' = 'check';
  title = 'Listo';
  message = 'Todo bien';
  redirectLabel = '';
  withCta = false;
}

describe('ConfirmationSplashComponent', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  function setup(patch: Partial<Host> = {}): void {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('muestra título y mensaje', () => {
    setup();
    expect(el.querySelector('[data-testid="confirmation-splash"]')).not.toBeNull();
    expect(el.textContent).toContain('Listo');
    expect(el.textContent).toContain('Todo bien');
  });

  it('no muestra el loader de redirección sin redirectLabel', () => {
    setup();
    expect(el.querySelector('[data-testid="splash-redirect"]')).toBeNull();
  });

  it('muestra el loader de redirección con redirectLabel', () => {
    setup({ redirectLabel: 'Redirigiendo…' });
    expect(el.querySelector('[data-testid="splash-redirect"]')).not.toBeNull();
    expect(el.textContent).toContain('Redirigiendo…');
  });

  it('proyecta el CTA', () => {
    setup({ withCta: true });
    expect(el.querySelector('[data-testid="cta"]')).not.toBeNull();
  });

  it('usa el icono de correo cuando icon="mail"', () => {
    setup({ icon: 'mail' });
    expect(el.querySelector('.splash-halo--mail')).not.toBeNull();
  });
});

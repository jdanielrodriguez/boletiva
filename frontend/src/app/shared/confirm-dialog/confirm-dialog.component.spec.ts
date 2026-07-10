import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let el: HTMLElement;

  async function setup() {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.componentRef.setInput('title', 'Eliminar evento');
    fixture.componentRef.setInput('message', '¿Seguro que deseas eliminar "Fiesta"?');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('muestra el título y el mensaje', async () => {
    await setup();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(el.textContent).toContain('Eliminar evento');
    expect(el.textContent).toContain('Fiesta');
  });

  it('usa las clases animadas de modal (backdrop + card)', async () => {
    await setup();
    // .modal-backdrop y .modal-card reciben la animación de entrada + sombra global.
    expect(el.querySelector('.modal-backdrop')).not.toBeNull();
    expect(el.querySelector('.modal-card')).not.toBeNull();
  });

  it('aceptar emite accept', async () => {
    await setup();
    const spy = jasmine.createSpy('accept');
    fixture.componentInstance.accept.subscribe(spy);
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });

  it('cancelar emite cancelled', async () => {
    await setup();
    const spy = jasmine.createSpy('cancelled');
    fixture.componentInstance.cancelled.subscribe(spy);
    (el.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});

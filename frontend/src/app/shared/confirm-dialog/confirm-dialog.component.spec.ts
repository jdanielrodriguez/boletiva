import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { API_BASE_URL } from '../../core/config/api.tokens';
import { ConfirmDialogComponent } from './confirm-dialog.component';

const BASE = 'http://api.test';

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let el: HTMLElement;
  let httpMock: HttpTestingController;

  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.componentRef.setInput('title', 'Eliminar evento');
    fixture.componentRef.setInput('message', '¿Seguro que deseas eliminar "Fiesta"?');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => httpMock?.verify());

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

  it('muestra un icono en el título y centra las acciones (v3.7)', async () => {
    await setup();
    // Encabezado con icono grande (app-icon dentro de .confirm-icon).
    expect(el.querySelector('.confirm-head .confirm-icon app-icon')).not.toBeNull();
    // Mensaje llamativo con su propia clase (no el gris tenue anterior).
    expect(el.querySelector('.confirm-message')).not.toBeNull();
    // Fila de acciones centrada.
    expect(el.querySelector('.confirm-actions')).not.toBeNull();
  });

  it('por defecto es destructiva (icono de alerta y botón danger)', async () => {
    await setup();
    expect(el.querySelector('.confirm-head.is-danger')).not.toBeNull();
    expect(el.querySelector('[data-testid="confirm-accept"].danger')).not.toBeNull();
  });

  it('no destructiva usa botón primario y icono de ayuda', async () => {
    await setup();
    fixture.componentRef.setInput('danger', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="confirm-accept"].primary')).not.toBeNull();
    expect(el.querySelector('.confirm-head.is-danger')).toBeNull();
  });

  it('SIN auditAction: al confirmar NO registra en la bitácora (usos actuales intactos)', async () => {
    await setup();
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    // httpMock.verify() en afterEach falla si hubo alguna petición inesperada.
  });

  it('CON auditAction: al confirmar registra el click (POST /audit/confirm) con action+resource', async () => {
    await setup();
    fixture.componentRef.setInput('auditAction', 'promoter.suspend');
    fixture.componentRef.setInput('auditResource', 'promo-123');
    fixture.detectChanges();
    await fixture.whenStable();

    const spy = jasmine.createSpy('accept');
    fixture.componentInstance.accept.subscribe(spy);
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();

    // La acción se emite SIEMPRE (no espera al audit).
    expect(spy).toHaveBeenCalled();
    const reqs = httpMock.match(`${BASE}/audit/confirm`);
    expect(reqs.length).toBe(1);
    expect(reqs[0].request.method).toBe('POST');
    expect(reqs[0].request.body).toEqual({ action: 'promoter.suspend', resource: 'promo-123' });
    reqs[0].flush({ message: 'ok' });
  });

  it('FIRE-AND-FORGET: si el audit falla, la acción igual se ejecuta', async () => {
    await setup();
    fixture.componentRef.setInput('auditAction', 'event.publish');
    fixture.detectChanges();
    await fixture.whenStable();

    const spy = jasmine.createSpy('accept');
    fixture.componentInstance.accept.subscribe(spy);
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();

    expect(spy).toHaveBeenCalled();
    const reqs = httpMock.match(`${BASE}/audit/confirm`);
    expect(reqs.length).toBe(1);
    // El backend responde error; el subscribe lo captura en silencio (no relanza).
    reqs[0].flush({ message: 'nope' }, { status: 500, statusText: 'Server Error' });
  });
});

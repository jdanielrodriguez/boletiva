import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapPickerComponent, type MapLocation } from './map-picker.component';

/**
 * El mapa Leaflet es browser-only (import dinámico en afterNextRender) y no se
 * inicializa en el entorno de test sin DOM real de tiles. Estos specs verifican el
 * contrato observable: render del buscador y emisión de `{lat,lng,address}` vía el
 * método `emit` (usado por búsqueda/drag/click del mapa real).
 */
describe('MapPickerComponent', () => {
  let fixture: ComponentFixture<MapPickerComponent>;

  async function setup() {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(MapPickerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renderiza el buscador de ubicación', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="map-search"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="map-canvas"]')).not.toBeNull();
  });

  it('emite locationChange con las coordenadas seleccionadas', async () => {
    await setup();
    const events: MapLocation[] = [];
    fixture.componentInstance.locationChange.subscribe((l) => events.push(l));
    // Simula lo que hace el marker/drag/click: emitir coords.
    (fixture.componentInstance as unknown as { emit: (a: number, b: number, c?: string) => void }).emit(
      14.6,
      -90.5,
      'Zona 1',
    );
    expect(events[0]).toEqual({ lat: 14.6, lng: -90.5, address: 'Zona 1' });
  });
});

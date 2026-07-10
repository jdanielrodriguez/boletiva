import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type * as L from 'leaflet';
import { IconComponent } from '../icon/icon.component';

/** Ubicación seleccionada en el mapa. */
export interface MapLocation {
  lat: number;
  lng: number;
  address: string;
}

/** Centro por defecto: Ciudad de Guatemala. */
const DEFAULT_CENTER: [number, number] = [14.6349, -90.5069];

/**
 * Selector de ubicación reutilizable (v3.5) con Leaflet + OpenStreetMap. Buscador
 * (geocoding Nominatim), marcador arrastrable y emisión de `{lat, lng, address}`.
 * BROWSER-ONLY: importa Leaflet dinámicamente en `afterNextRender` (SSR-safe, igual
 * que Konva). Se usa en el editor de evento (Dirección) y en salones (admin).
 */
@Component({
  selector: 'app-map-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="map-picker" data-testid="map-picker">
      <div class="map-search-row">
        <input
          type="search"
          class="map-search"
          [placeholder]="searchPlaceholder()"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
          (keydown.enter)="search(); $event.preventDefault()"
          name="mapsearch"
          data-testid="map-search"
          aria-label="Buscar ubicación"
        />
        <button type="button" class="btn small" (click)="search()" [disabled]="searching()" data-testid="map-search-btn" title="Buscar en el mapa">
          <app-icon name="search" /> {{ searching() ? 'Buscando…' : 'Buscar' }}
        </button>
      </div>
      @if (notFound()) {
        <p class="muted small" data-testid="map-notfound">No se encontró esa ubicación. Prueba con otra búsqueda o arrastra el marcador.</p>
      }
      <div #host class="map-canvas" data-testid="map-canvas"></div>
      @if (selected(); as s) {
        <p class="muted small" data-testid="map-coords">
          {{ s.address || 'Ubicación seleccionada' }} · {{ s.lat.toFixed(5) }}, {{ s.lng.toFixed(5) }}
        </p>
      }
    </div>
  `,
})
export class MapPickerComponent implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
  readonly address = input<string>('');
  readonly searchPlaceholder = input('Buscar dirección o lugar…');
  readonly locationChange = output<MapLocation>();

  protected readonly query = signal('');
  protected readonly searching = signal(false);
  protected readonly notFound = signal(false);
  protected readonly selected = signal<MapLocation | null>(null);

  private leaflet: typeof L | null = null;
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;

  constructor() {
    afterNextRender(async () => {
      if (!isPlatformBrowser(this.platformId)) return;
      const el = this.host()?.nativeElement;
      // Solo inicializa si el contenedor está en el DOM (evita crashear en tests,
      // donde el fixture no se adjunta al documento).
      if (!el || !el.isConnected) return;
      try {
        const mod = (await import('leaflet')) as unknown as { default?: typeof L } & typeof L;
        this.leaflet = mod.default ?? mod;
        this.query.set(this.address() ?? '');
        this.initMap();
      } catch {
        // Si Leaflet no carga, el buscador y el resto de la UI siguen funcionando.
      }
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  private initMap(): void {
    const el = this.host()?.nativeElement;
    if (!this.leaflet || !el) return;
    const Lm = this.leaflet;
    const hasInitial = this.lat() != null && this.lng() != null;
    const center: [number, number] = hasInitial
      ? [this.lat() as number, this.lng() as number]
      : DEFAULT_CENTER;

    this.map = Lm.map(el, { center, zoom: hasInitial ? 15 : 12 });
    Lm.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    // Marcador basado en DivIcon (evita depender de assets de imagen de Leaflet).
    const icon = Lm.divIcon({ className: 'map-pin', iconSize: [22, 22], iconAnchor: [11, 22] });
    this.marker = Lm.marker(center, { draggable: true, icon }).addTo(this.map);
    this.marker.on('dragend', () => {
      const p = this.marker?.getLatLng();
      if (p) this.emit(p.lat, p.lng);
    });
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.marker?.setLatLng(e.latlng);
      this.emit(e.latlng.lat, e.latlng.lng);
    });

    // Leaflet necesita recalcular el tamaño cuando el contenedor ya está visible.
    setTimeout(() => this.map?.invalidateSize(), 0);

    if (hasInitial) {
      this.selected.set({ lat: this.lat() as number, lng: this.lng() as number, address: this.address() ?? '' });
    }
  }

  /** Geocoding con Nominatim (browser fetch): centra el mapa y coloca el marcador. */
  protected search(): void {
    const q = this.query().trim();
    if (!q || !isPlatformBrowser(this.platformId)) return;
    this.searching.set(true);
    this.notFound.set(false);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((results: { lat: string; lon: string; display_name: string }[]) => {
        this.searching.set(false);
        if (!results || results.length === 0) {
          this.notFound.set(true);
          return;
        }
        const { lat, lon, display_name } = results[0];
        const latN = Number(lat);
        const lngN = Number(lon);
        this.map?.setView([latN, lngN], 16);
        this.marker?.setLatLng([latN, lngN]);
        this.emit(latN, lngN, display_name);
      })
      .catch(() => {
        this.searching.set(false);
        this.notFound.set(true);
      });
  }

  private emit(lat: number, lng: number, address?: string): void {
    const loc: MapLocation = { lat, lng, address: address ?? this.selected()?.address ?? this.query() };
    this.selected.set(loc);
    this.locationChange.emit(loc);
  }
}

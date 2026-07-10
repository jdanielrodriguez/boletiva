import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import type Konva from 'konva';
import { PromoterEventsApi, SeatView } from '../../core/api/promoter-events.api';
import type { LocalityView } from '../../core/api/types';
import { IconComponent } from '../../shared/icon/icon.component';

/** Paleta estable para distinguir localidades en el mapa combinado. */
const PALETTE = ['#7b5cff', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#eab308', '#14b8a6'];
const PAD = 26;
const CLUSTER_GAP = 60;
const MAX_ROW_WIDTH = 1100;

/** Un cúmulo (localidad) posicionado en el mapa combinado. */
interface Cluster {
  id: string;
  name: string;
  color: string;
  count: number;
  seats: { x: number; y: number }[];
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Mapa COMBINADO de solo lectura de un evento: junta los asientos de TODAS las
 * localidades `seated` en un único lienzo (Konva, browser-only), cada localidad con
 * su color. Como cada localidad se diseña en su propio origen de coordenadas, aquí
 * se disponen sus cúmulos lado a lado (wrap por ancho) con una etiqueta. Sin
 * controles de edición: es solo visualización para el panel del evento.
 */
@Component({
  selector: 'app-event-seat-map',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './event-seat-map.component.html',
})
export class EventSeatMapComponent {
  private readonly api = inject(PromoterEventsApi);

  readonly eventId = input.required<string>();
  /** Localidades del evento (se filtran las `seated` con asientos). */
  readonly localities = input<LocalityView[]>([]);

  protected readonly loading = signal(true);
  protected readonly clusters = signal<Cluster[]>([]);
  protected readonly totalSeats = computed(() =>
    this.clusters().reduce((sum, c) => sum + c.count, 0),
  );
  /** Leyenda: localidad + color + conteo. */
  protected readonly legend = computed(() =>
    this.clusters().map((c) => ({ name: c.name, color: c.color, count: c.count })),
  );

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;

  constructor() {
    // Recalcula los cúmulos cuando llegan las localidades.
    effect(() => {
      const locs = this.localities().filter((l) => l.kind === 'seated');
      this.loadSeats(locs);
    });
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.draw();
    });
    effect(() => {
      this.clusters();
      if (this.stage) this.draw();
    });
  }

  private loadSeats(locs: LocalityView[]): void {
    if (locs.length === 0) {
      this.clusters.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    forkJoin(locs.map((l) => this.api.seats(l.id))).subscribe({
      next: (perLoc) => {
        this.clusters.set(this.layoutClusters(locs, perLoc));
        this.loading.set(false);
      },
      error: () => {
        this.clusters.set([]);
        this.loading.set(false);
      },
    });
  }

  /** Normaliza cada localidad a su bounding box y las dispone lado a lado (wrap). */
  private layoutClusters(locs: LocalityView[], perLoc: SeatView[][]): Cluster[] {
    const out: Cluster[] = [];
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    locs.forEach((loc, i) => {
      const seats = perLoc[i]
        .filter((s) => s.x != null && s.y != null)
        .map((s) => ({ x: s.x as number, y: s.y as number }));
      if (seats.length === 0) return;
      const minX = Math.min(...seats.map((s) => s.x));
      const minY = Math.min(...seats.map((s) => s.y));
      const norm = seats.map((s) => ({ x: s.x - minX, y: s.y - minY }));
      const width = Math.max(...norm.map((s) => s.x)) + PAD * 2;
      const height = Math.max(...norm.map((s) => s.y)) + PAD * 2 + 24; // +etiqueta
      if (cursorX > 0 && cursorX + width > MAX_ROW_WIDTH) {
        cursorX = 0;
        cursorY += rowHeight + CLUSTER_GAP;
        rowHeight = 0;
      }
      out.push({
        id: loc.id,
        name: loc.name,
        color: PALETTE[out.length % PALETTE.length],
        count: seats.length,
        seats: norm,
        offsetX: cursorX,
        offsetY: cursorY,
        width,
        height,
      });
      cursorX += width + CLUSTER_GAP;
      rowHeight = Math.max(rowHeight, height);
    });
    return out;
  }

  private draw(): void {
    const el = this.host()?.nativeElement;
    if (!this.konva || !el) return;
    const K = this.konva;
    const clusters = this.clusters();
    const width = Math.max(320, ...clusters.map((c) => c.offsetX + c.width));
    const height = Math.max(160, ...clusters.map((c) => c.offsetY + c.height));
    if (!this.stage) {
      this.stage = new K.Stage({ container: el, width, height });
      this.layer = new K.Layer();
      this.stage.add(this.layer);
    } else {
      this.stage.size({ width, height });
      this.layer?.destroyChildren();
    }
    if (!this.layer) return;
    for (const c of clusters) {
      // Etiqueta de la localidad.
      this.layer.add(
        new K.Text({
          x: c.offsetX,
          y: c.offsetY,
          text: `${c.name} · ${c.count}`,
          fontSize: 13,
          fontStyle: 'bold',
          fill: c.color,
        }),
      );
      const baseY = c.offsetY + 22;
      for (const s of c.seats) {
        const g = new K.Group({ x: c.offsetX + PAD + s.x, y: baseY + PAD + s.y });
        g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: c.color }));
        g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: c.color }));
        this.layer.add(g);
      }
    }
    this.layer.draw();
  }
}

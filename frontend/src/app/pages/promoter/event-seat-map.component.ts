import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import type Konva from 'konva';
import { PromoterEventsApi, SeatView } from '../../core/api/promoter-events.api';
import type { LocalityView } from '../../core/api/types';
import { IconComponent } from '../../shared/icon/icon.component';

/** Paleta estable para distinguir localidades en el mapa combinado. */
const PALETTE = ['#e14eca', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#eab308', '#14b8a6'];
const PAD = 26;
const CLUSTER_GAP = 60;
const MAX_ROW_WIDTH = 1100;
/** Tope de asientos a dibujar uno a uno en la vista previa combinada (evita freeze). */
const MAX_PREVIEW_SEATS = 1500;

/** Disposición de los cúmulos en el mapa combinado. */
type MapLayout = 'horizontal' | 'vertical';

/** Cúmulo (localidad) MEDIDO: geometría propia sin la posición en el lienzo. */
interface BaseCluster {
  id: string;
  name: string;
  color: string;
  count: number;
  seats: { x: number; y: number }[];
  width: number;
  height: number;
}

/** Cúmulo posicionado en el mapa combinado (base + offset del layout). */
interface Cluster extends BaseCluster {
  offsetX: number;
  offsetY: number;
}

/**
 * Mapa COMBINADO de solo lectura de un evento: junta los asientos de TODAS las
 * localidades `seated` en un único lienzo (Konva, browser-only), cada localidad con
 * su color. El CONTENIDO de asientos es solo lectura, pero el LAYOUT es ajustable:
 * el usuario reordena las localidades con flechas y alterna la disposición
 * (lado a lado ↔ apiladas). La elección se persiste en localStorage por evento.
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
  /** Cúmulos medidos (sin posición); el orden lo fija `order`. */
  private readonly baseClusters = signal<BaseCluster[]>([]);
  /** Orden elegido por el usuario (ids de localidad). */
  protected readonly order = signal<string[]>([]);
  /** Disposición: lado a lado (horizontal) o apiladas (vertical). */
  protected readonly layout = signal<MapLayout>('horizontal');

  /** Cúmulos posicionados según el orden y la disposición elegidos. */
  protected readonly clusters = computed<Cluster[]>(() => {
    const byId = new Map(this.baseClusters().map((c) => [c.id, c]));
    const ordered = this.order()
      .map((id) => byId.get(id))
      .filter((c): c is BaseCluster => !!c);
    return this.position(ordered, this.layout());
  });

  protected readonly totalSeats = computed(() =>
    this.clusters().reduce((sum, c) => sum + c.count, 0),
  );
  /** Leyenda + controles de reorden: localidad + color + conteo (en el orden actual). */
  protected readonly legend = computed(() =>
    this.clusters().map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.count })),
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

  // --- Reorden / disposición (mutan solo la vista, sin backend) ---
  protected moveUp(id: string): void {
    this.swap(id, -1);
  }
  protected moveDown(id: string): void {
    this.swap(id, 1);
  }
  private swap(id: string, dir: -1 | 1): void {
    const arr = [...this.order()];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.order.set(arr);
    this.persist();
  }
  protected toggleLayout(): void {
    this.layout.update((l) => (l === 'horizontal' ? 'vertical' : 'horizontal'));
    this.persist();
  }
  /** Persiste la preferencia actual (orden + disposición) para este evento. */
  private persist(): void {
    this.savePrefs(this.eventId(), this.order(), this.layout());
  }
  /** true si `id` es el primero del orden (deshabilita ‹subir›). */
  protected isFirst(id: string): boolean {
    return this.order()[0] === id;
  }
  /** true si `id` es el último del orden (deshabilita ‹bajar›). */
  protected isLast(id: string): boolean {
    return this.order()[this.order().length - 1] === id;
  }

  private loadSeats(locs: LocalityView[]): void {
    if (locs.length === 0) {
      this.baseClusters.set([]);
      this.order.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    forkJoin(locs.map((l) => this.api.seats(l.id))).subscribe({
      next: (perLoc) => {
        const base = this.measureClusters(locs, perLoc);
        // `untracked`: leer/escribir order aquí NO debe crear dependencia con el
        // effect disparador (con `of()` síncrono en test formaría un bucle infinito).
        untracked(() => {
          this.baseClusters.set(base);
          this.reconcileOrder(base.map((c) => c.id));
        });
        this.loading.set(false);
      },
      error: () => {
        this.baseClusters.set([]);
        this.order.set([]);
        this.loading.set(false);
      },
    });
  }

  /**
   * Concilia el orden con los ids disponibles: si hay preferencia guardada la usa
   * (filtrando ids que ya no existen) y agrega los nuevos al final; si no, orden
   * natural. Preserva los movimientos manuales del usuario en la sesión.
   */
  private reconcileOrder(ids: string[]): void {
    const idSet = new Set(ids);
    const prev = this.order().length > 0 ? this.order() : this.loadPrefs(this.eventId());
    const kept = prev.filter((id) => idSet.has(id));
    const added = ids.filter((id) => !kept.includes(id));
    this.order.set([...kept, ...added]);
  }

  /** Normaliza cada localidad a su bounding box (sin posición en el lienzo). */
  private measureClusters(locs: LocalityView[], perLoc: SeatView[][]): BaseCluster[] {
    const out: BaseCluster[] = [];
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
      out.push({
        id: loc.id,
        name: loc.name,
        color: PALETTE[out.length % PALETTE.length],
        count: seats.length,
        seats: norm,
        width,
        height,
      });
    });
    return out;
  }

  /** Dispone los cúmulos según el layout: lado a lado (wrap) o apilados. */
  private position(base: BaseCluster[], layout: MapLayout): Cluster[] {
    const out: Cluster[] = [];
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    for (const c of base) {
      if (layout === 'vertical') {
        out.push({ ...c, offsetX: 0, offsetY: cursorY });
        cursorY += c.height + CLUSTER_GAP;
        continue;
      }
      // Horizontal: fila con wrap por ancho.
      if (cursorX > 0 && cursorX + c.width > MAX_ROW_WIDTH) {
        cursorX = 0;
        cursorY += rowHeight + CLUSTER_GAP;
        rowHeight = 0;
      }
      out.push({ ...c, offsetX: cursorX, offsetY: cursorY });
      cursorX += c.width + CLUSTER_GAP;
      rowHeight = Math.max(rowHeight, c.height);
    }
    return out;
  }

  // --- Persistencia (localStorage, browser-only) ---
  private prefKey(eventId: string): string {
    return `pe.combinedMap.${eventId}`;
  }
  private loadPrefs(eventId: string): string[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.prefKey(eventId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { order?: string[]; layout?: MapLayout };
      if (parsed.layout === 'horizontal' || parsed.layout === 'vertical') {
        this.layout.set(parsed.layout);
      }
      return Array.isArray(parsed.order) ? parsed.order : [];
    } catch {
      return [];
    }
  }
  private savePrefs(eventId: string, order: string[], layout: MapLayout): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.prefKey(eventId), JSON.stringify({ order, layout }));
    } catch {
      /* almacenamiento no disponible: la preferencia solo vive en la sesión */
    }
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
    // Tope de nodos: por encima, dibujar cada asiento (2 rects) congelaría el navegador
    // (sobre todo en móvil). Se muestran solo las etiquetas + un aviso (QA).
    const totalSeats = clusters.reduce((n, c) => n + c.count, 0);
    const tooMany = totalSeats > MAX_PREVIEW_SEATS;
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
      if (tooMany) continue;
      const baseY = c.offsetY + 22;
      for (const s of c.seats) {
        const g = new K.Group({ x: c.offsetX + PAD + s.x, y: baseY + PAD + s.y });
        g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: c.color }));
        g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: c.color }));
        this.layer.add(g);
      }
    }
    if (tooMany) {
      this.layer.add(
        new K.Text({
          x: 0,
          y: height - 18,
          text: `Vista previa simplificada (${totalSeats} asientos)`,
          fontSize: 12,
          fontStyle: 'italic',
          fill: '#9aa0aa',
        }),
      );
    }
    this.layer.draw();
  }
}

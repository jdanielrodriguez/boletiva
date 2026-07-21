import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type Konva from 'konva';
import type { SeatAvailabilityDto } from '../../core/api/types';

// Paleta alineada a la marca (mismos hex que la leyenda en styles.scss:
// .seat-legend .legend.{av,sel,tk}). Konva pinta sobre canvas → hex literal,
// no tokens CSS; si cambian aquí, cambiar también la leyenda.
const COLORS = {
  available: '#35d07f', // = --pe-success (noche)
  selected: '#e14eca', // = --pe-accent (rosa de marca), antes morado residual
  taken: '#3a3f52',
};
const PAD = 40;

/**
 * Mapa de asientos con Konva/Canvas: dibuja SILLITAS (no puntos) coloreadas por
 * estado, con un icono ✓ al seleccionar y × cuando están ocupadas. El cursor es
 * pointer SOLO sobre asientos disponibles; los ocupados no cambian el cursor ni
 * son clicables. Solo navegador (Konva se importa dinámicamente en afterNextRender).
 */
@Component({
  selector: 'app-seat-map',
  template: `
    <div class="seat-map-zoom" role="group" aria-label="Zoom del mapa">
      <button type="button" class="btn small icon-only" [disabled]="zoom() <= MIN_ZOOM" (click)="zoomOut()" data-testid="seat-zoom-out" aria-label="Alejar">−</button>
      <span class="seat-zoom-lvl" data-testid="seat-zoom-lvl">{{ zoom() * 100 }}%</span>
      <button type="button" class="btn small icon-only" [disabled]="zoom() >= MAX_ZOOM" (click)="zoomIn()" data-testid="seat-zoom-in" aria-label="Acercar">+</button>
      <button type="button" class="btn small" (click)="resetZoom()" data-testid="seat-zoom-reset">100%</button>
    </div>
    <div #host class="seat-map-host"></div>
  `,
  styles: [
    // El CANVAS ocupa el 100% del ancho del contenedor; el CONTENIDO (los asientos)
    // se centra dentro del stage vía offset del layer (no con CSS del canvas).
    ':host { display: block; width: 100%; }',
    // overflow-x:auto → si el mapa es más ancho que el viewport (evento grande en móvil)
    // se scrollea DENTRO en vez de desbordar la página. touch-action permite el pan.
    '.seat-map-host { display: block; width: 100%; overflow: auto; -webkit-overflow-scrolling: touch; max-height: 70vh; }',
    '.seat-map-zoom { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; }',
    '.seat-zoom-lvl { min-width: 3.2rem; text-align: center; font-variant-numeric: tabular-nums; color: var(--pe-text-muted, #6b6b76); }',
  ],
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  readonly seatToggle = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  protected readonly MIN_ZOOM = 1;
  protected readonly MAX_ZOOM = 3;
  /** Zoom del mapa (FU11): en móvil permite acercar para tocar asientos densos. */
  protected readonly zoom = signal(1);

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private resizeObserver: ResizeObserver | null = null;

  protected zoomIn(): void {
    this.zoom.set(Math.min(this.MAX_ZOOM, Math.round((this.zoom() + 0.25) * 100) / 100));
  }
  protected zoomOut(): void {
    this.zoom.set(Math.max(this.MIN_ZOOM, Math.round((this.zoom() - 0.25) * 100) / 100));
  }
  protected resetZoom(): void {
    this.zoom.set(1);
  }

  constructor() {
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.build();
      // Reajusta el ancho del stage al del contenedor cuando cambia (responsive).
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.rebuild());
        this.resizeObserver.observe(this.host().nativeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => this.resizeObserver?.disconnect());
    effect(() => {
      this.seats();
      this.selected();
      this.zoom(); // repinta al cambiar el zoom
      if (this.stage) this.rebuild();
    });
  }

  private build(): void {
    if (!this.konva) return;
    const { width, height, offsetX, offsetY } = this.extents();
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    const z = this.zoom();
    this.stage = new this.konva.Stage({ container: this.host().nativeElement, width: width * z, height: height * z });
    this.stage.scale({ x: z, y: z });
    this.layer = new this.konva.Layer();
    this.stage.add(this.layer);
    this.drawSeats();
  }

  private rebuild(): void {
    if (!this.konva || !this.stage) return;
    const { width, height, offsetX, offsetY } = this.extents();
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    const z = this.zoom();
    this.stage.scale({ x: z, y: z });
    this.stage.size({ width: width * z, height: height * z });
    this.layer?.destroyChildren();
    this.drawSeats();
  }

  /** Ancho disponible del contenedor (para que el stage ocupe el 100%). */
  private containerWidth(): number {
    const el = this.host().nativeElement;
    return el.clientWidth || el.parentElement?.clientWidth || 320;
  }

  /**
   * El STAGE ocupa el ancho del contenedor (mínimo, el del contenido). El OFFSET
   * normaliza el origen del contenido a (PAD, PAD) y además lo CENTRA
   * horizontalmente dentro del stage (margen sobrante repartido a ambos lados) →
   * el canvas llena el ancho y los asientos quedan centrados.
   */
  private extents(): { width: number; height: number; offsetX: number; offsetY: number } {
    const pts = this.seats().filter((s) => s.x != null && s.y != null);
    const containerW = this.containerWidth();
    if (pts.length === 0) {
      return { width: containerW, height: 160, offsetX: 0, offsetY: 0 };
    }
    const xs = pts.map((s) => s.x as number);
    const ys = pts.map((s) => s.y as number);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const contentWidth = maxX - minX + PAD * 2;
    const stageWidth = Math.max(contentWidth, containerW);
    const centerExtra = Math.max(0, (stageWidth - contentWidth) / 2);
    return {
      width: stageWidth,
      height: maxY - minY + PAD * 2,
      offsetX: PAD - minX + centerExtra,
      offsetY: PAD - minY,
    };
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const sel = this.selected();

    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      const taken = seat.status !== 'available';
      const chosen = sel.has(seat.id);
      const color = taken ? COLORS.taken : chosen ? COLORS.selected : COLORS.available;

      const g = new K.Group({ x: (seat.x as number) + this.offsetX, y: (seat.y as number) + this.offsetY });
      // Respaldo + asiento (sillita).
      g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: color }));
      g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: color }));

      if (chosen && !taken) {
        g.add(this.icon(K, '✓', '#ffffff'));
      } else if (taken) {
        g.add(this.icon(K, '×', '#9aa0b0'));
      }

      if (!taken) {
        g.on('click tap', () => this.seatToggle.emit(seat.id));
        g.on('mouseenter', () => this.setCursor('pointer'));
        g.on('mouseleave', () => this.setCursor('default'));
      }
      this.layer.add(g);
    }
    this.layer.draw();
  }

  private icon(K: typeof Konva, text: string, fill: string): Konva.Text {
    return new K.Text({
      text,
      x: -13,
      y: -8,
      width: 26,
      height: 16,
      align: 'center',
      verticalAlign: 'middle',
      fontSize: 13,
      fontStyle: 'bold',
      fill,
      listening: false,
    });
  }

  private setCursor(value: string): void {
    if (this.stage) this.stage.container().style.cursor = value;
  }
}

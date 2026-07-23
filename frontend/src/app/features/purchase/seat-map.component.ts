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
    <div class="seat-map-frame">
      @if (stageLabel()) {
        <div class="seat-stage" data-testid="seat-stage" aria-hidden="true"><span>{{ stageLabel() }}</span></div>
      }
      <div #host class="seat-map-host"></div>
    </div>
  `,
  styles: [
    // El CANVAS ocupa el 100% del ancho del contenedor; el CONTENIDO (los asientos)
    // se centra dentro del stage vía offset del layer (no con CSS del canvas).
    ':host { display: block; width: 100%; }',
    // El fondo del mapa = color de la página (antes blanco brillante). Marco con el
    // escenario arriba (las localidades quedan debajo, hacia el escenario).
    '.seat-map-frame { border-radius: 12px; background: var(--pe-bg); padding: 0.25rem; overflow: hidden; }',
    // overflow-x:auto → si el mapa es más ancho que el viewport (evento grande en móvil)
    // se scrollea DENTRO en vez de desbordar la página. touch-action permite el pan.
    '.seat-map-host { display: block; width: 100%; overflow: auto; -webkit-overflow-scrolling: touch; max-height: 70vh; background: var(--pe-bg); }',
    '.seat-map-zoom { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; }',
    '.seat-zoom-lvl { min-width: 3.2rem; text-align: center; font-variant-numeric: tabular-nums; color: var(--pe-text-muted, #6b6b76); }',
    // Etiqueta ESCENARIO: barra centrada arriba del mapa (referencia de orientación).
    '.seat-stage { display: flex; justify-content: center; margin: 0.15rem auto 0.6rem; }',
    '.seat-stage span { display: inline-block; min-width: 55%; text-align: center; padding: 0.4rem 1.5rem; border-radius: 8px; background: var(--pe-surface-2); color: var(--pe-text-muted, #6b6b76); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; box-shadow: inset 0 -3px 0 var(--pe-border); }',
  ],
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  /**
   * `false` = modo VISTA GENERAL (mapa unido del recinto): los asientos no se
   * seleccionan; al hacer clic se emite `localityPick` (entrar a esa localidad) y al
   * pasar el cursor `localityHover` (para el CTA de la página). `true` = compra normal.
   */
  readonly interactive = input(true);
  /** Texto de la etiqueta del escenario (barra superior). null = no se muestra. */
  readonly stageLabel = input<string | null>(null);
  readonly seatToggle = output<string>();
  /** Vista general: clic en una zona → id de su localidad. */
  readonly localityPick = output<string>();
  /** Vista general: cursor sobre una zona (id) o fuera (null) → CTA en la página. */
  readonly localityHover = output<string | null>();

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
      this.interactive();
      this.zoom(); // repinta al cambiar el zoom
      if (this.stage) this.rebuild();
    });
  }

  private build(): void {
    if (!this.konva) return;
    this.stage = new this.konva.Stage({ container: this.host().nativeElement, width: 1, height: 1 });
    this.layer = new this.konva.Layer();
    this.stage.add(this.layer);
    this.applyLayout();
    this.drawSeats();
  }

  private rebuild(): void {
    if (!this.konva || !this.stage) return;
    this.applyLayout();
    this.layer?.destroyChildren();
    this.drawSeats();
  }

  /**
   * Layout ANCHO-FIJO: el mapa nunca es más ancho que el contenedor a zoom 100%
   * (se escala el contenido para caber en el ancho → sin scroll horizontal). El
   * alto CRECE en vertical (más asientos ⇒ más alto) y el host scrollea en Y.
   * El zoom manual (>100%) sí puede desbordar en X → ahí el pan/scroll es esperado.
   * La escala se aplica al LAYER (no al stage) para poder centrar con layer.position.
   */
  private applyLayout(): void {
    if (!this.stage || !this.layer) return;
    const pts = this.seats().filter((s) => s.x != null && s.y != null);
    const containerW = this.containerWidth();
    if (pts.length === 0) {
      this.offsetX = 0;
      this.offsetY = 0;
      this.stage.scale({ x: 1, y: 1 });
      this.layer.scale({ x: 1, y: 1 });
      this.layer.position({ x: 0, y: 0 });
      this.stage.size({ width: containerW, height: 160 });
      return;
    }
    const xs = pts.map((s) => s.x as number);
    const ys = pts.map((s) => s.y as number);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const contentWidth = Math.max(...xs) - minX + PAD * 2;
    const contentHeight = Math.max(...ys) - minY + PAD * 2;

    // Normaliza el origen del contenido a (PAD, PAD).
    this.offsetX = PAD - minX;
    this.offsetY = PAD - minY;

    // Ajuste-a-ancho: nunca AMPLÍA por encima de 1 (mapas pequeños quedan a tamaño
    // natural y se centran); si el contenido es más ancho, lo REDUCE para caber.
    const fitScale = Math.min(1, containerW / contentWidth);
    const scale = fitScale * this.zoom();

    // El stage ocupa como mínimo el ancho del contenedor (permite centrar); si el
    // zoom lo hace más ancho, crece (scroll horizontal al hacer zoom-in).
    const scaledW = contentWidth * scale;
    const stageW = Math.max(containerW, scaledW);
    const stageH = contentHeight * scale;
    const centerPx = Math.max(0, (stageW - scaledW) / 2);

    this.stage.scale({ x: 1, y: 1 });
    this.layer.scale({ x: scale, y: scale });
    this.layer.position({ x: centerPx, y: 0 });
    this.stage.size({ width: stageW, height: stageH });
  }

  /** Ancho disponible del contenedor (para que el stage ocupe el 100%). */
  private containerWidth(): number {
    const el = this.host().nativeElement;
    return el.clientWidth || el.parentElement?.clientWidth || 320;
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const sel = this.selected();
    const preview = !this.interactive();

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

      if (preview) {
        // Vista general: toda la zona es clicable (entrar a la localidad) y el cursor
        // es pointer; el hover avisa a la página para el CTA de la zona.
        g.on('click tap', () => this.localityPick.emit(seat.localityId));
        g.on('mouseenter', () => {
          this.setCursor('pointer');
          this.localityHover.emit(seat.localityId);
        });
        g.on('mouseleave', () => {
          this.setCursor('default');
          this.localityHover.emit(null);
        });
      } else if (!taken) {
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

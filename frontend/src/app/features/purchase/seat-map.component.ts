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
  selected: '#e14eca', // = --pe-accent (rosa de marca)
  taken: '#3a3f52',
};
const PAD = 46; // margen alrededor del contenido al encuadrar (en coords de mundo)

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Mapa de asientos con Konva/Canvas y CÁMARA (B0): dibuja TODO el recinto en un
 * "mundo" y encuadra con la cámara (escala + posición del layer). El viewport es
 * de alto fijo (sin overflow); se puede recorrer con drag (pan). Al indicar
 * `focusLocalityId` la cámara hace un tween de acercamiento a esa localidad; sin
 * foco encuadra todo lo más lejos posible. `selectableLocalityId` BLOQUEA las demás
 * zonas (atenuadas; un clic en ellas cambia de localidad en vez de seleccionar).
 * Solo navegador (Konva se importa dinámicamente en afterNextRender).
 */
@Component({
  selector: 'app-seat-map',
  template: `
    <div class="seat-map-zoom" role="group" aria-label="Zoom del mapa">
      <button type="button" class="btn small icon-only" [disabled]="zoom() <= MIN_ZOOM" (click)="zoomOut()" data-testid="seat-zoom-out" aria-label="Alejar">−</button>
      <span class="seat-zoom-lvl" data-testid="seat-zoom-lvl">{{ zoom() * 100 }}%</span>
      <button type="button" class="btn small icon-only" [disabled]="zoom() >= MAX_ZOOM" (click)="zoomIn()" data-testid="seat-zoom-in" aria-label="Acercar">+</button>
      <button type="button" class="btn small" (click)="resetZoom()" data-testid="seat-zoom-reset">{{ focusLocalityId() ? '↺' : '100%' }}</button>
    </div>
    <div class="seat-map-frame">
      @if (stageLabel()) {
        <div class="seat-stage" data-testid="seat-stage" aria-hidden="true"><span>{{ stageLabel() }}</span></div>
      }
      <div #host class="seat-map-host"></div>
    </div>
  `,
  styles: [
    ':host { display: block; width: 100%; }',
    // Fondo = color de la página (antes blanco brillante). El viewport es de ALTO FIJO
    // y sin overflow: la cámara (pan/zoom) recorre el mundo, no la barra de scroll.
    '.seat-map-frame { border-radius: 12px; background: var(--pe-bg); padding: 0.25rem; overflow: hidden; }',
    '.seat-map-host { display: block; width: 100%; height: clamp(320px, 60vh, 680px); overflow: hidden; touch-action: none; cursor: grab; background: var(--pe-bg); }',
    '.seat-map-host:active { cursor: grabbing; }',
    '.seat-map-zoom { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; }',
    '.seat-zoom-lvl { min-width: 3.2rem; text-align: center; font-variant-numeric: tabular-nums; color: var(--pe-text-muted, #6b6b76); }',
    '.seat-stage { display: flex; justify-content: center; margin: 0.15rem auto 0.6rem; }',
    '.seat-stage span { display: inline-block; min-width: 55%; text-align: center; padding: 0.4rem 1.5rem; border-radius: 8px; background: var(--pe-surface-2); color: var(--pe-text-muted, #6b6b76); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; box-shadow: inset 0 -3px 0 var(--pe-border); }',
  ],
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  /** Texto de la etiqueta del escenario (barra superior). null = no se muestra. */
  readonly stageLabel = input<string | null>(null);
  /** CÁMARA: la localidad a encuadrar (zoom). null = encuadra todo (vista lejana). */
  readonly focusLocalityId = input<string | null>(null);
  /** BLOQUEO: solo esta localidad es seleccionable; las demás se atenúan y su clic cambia de zona. */
  readonly selectableLocalityId = input<string | null>(null);
  readonly seatToggle = output<string>();
  /** Clic en una zona NO activa (o sin foco) → id de su localidad (cambiar/enfocar). */
  readonly localityPick = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  protected readonly MIN_ZOOM = 1;
  protected readonly MAX_ZOOM = 4;
  /** Zoom manual del usuario (multiplica sobre el encuadre de la cámara). */
  protected readonly zoom = signal(1);

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastFocus: string | null | undefined = undefined;

  protected zoomIn(): void {
    this.zoom.set(Math.min(this.MAX_ZOOM, Math.round((this.zoom() + 0.5) * 100) / 100));
  }
  protected zoomOut(): void {
    this.zoom.set(Math.max(this.MIN_ZOOM, Math.round((this.zoom() - 0.5) * 100) / 100));
  }
  protected resetZoom(): void {
    this.zoom.set(1);
  }

  constructor() {
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.build();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.host().nativeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => this.resizeObserver?.disconnect());
    effect(() => {
      // Dependencias: repinta/reencuadra al cambiar.
      this.seats();
      this.selected();
      this.selectableLocalityId();
      const focus = this.focusLocalityId();
      this.zoom();
      if (!this.stage) return;
      const focusChanged = this.lastFocus !== focus;
      this.lastFocus = focus;
      this.redraw();
      this.applyCamera(focusChanged); // anima solo cuando cambia el foco
    });
  }

  private build(): void {
    if (!this.konva) return;
    const el = this.host().nativeElement;
    this.stage = new this.konva.Stage({
      container: el,
      width: this.viewportWidth(),
      height: this.viewportHeight(),
    });
    this.layer = new this.konva.Layer();
    this.layer.draggable(true); // pan libre por el recinto
    this.stage.add(this.layer);
    this.lastFocus = this.focusLocalityId();
    this.redraw();
    this.applyCamera(false);
  }

  private onResize(): void {
    if (!this.stage) return;
    this.stage.size({ width: this.viewportWidth(), height: this.viewportHeight() });
    this.applyCamera(false);
  }

  private redraw(): void {
    this.layer?.destroyChildren();
    this.drawSeats();
  }

  private viewportWidth(): number {
    const el = this.host().nativeElement;
    return el.clientWidth || el.parentElement?.clientWidth || 320;
  }
  private viewportHeight(): number {
    const el = this.host().nativeElement;
    return el.clientHeight || 420;
  }

  /** BBox (en coords de mundo) de un subconjunto de asientos, o null si no hay. */
  private boxOf(seats: SeatAvailabilityDto[]): Box | null {
    const pts = seats.filter((s) => s.x != null && s.y != null);
    if (pts.length === 0) return null;
    const xs = pts.map((s) => s.x as number);
    const ys = pts.map((s) => s.y as number);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  /** Calcula escala + posición del layer para encuadrar `box` en el viewport. */
  private cameraFor(box: Box): { scale: number; x: number; y: number } {
    const vw = this.viewportWidth();
    const vh = this.viewportHeight();
    const boxW = box.maxX - box.minX + PAD * 2;
    const boxH = box.maxY - box.minY + PAD * 2;
    // Encaja el box completo en el viewport (ambos ejes) y aplica el zoom manual.
    const fit = Math.min(vw / boxW, vh / boxH);
    const scale = Math.max(0.05, Math.min(this.MAX_ZOOM * 2, fit * this.zoom()));
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;
    return { scale, x: vw / 2 - centerX * scale, y: vh / 2 - centerY * scale };
  }

  /** Encuadra la cámara al foco (localidad) o a todo el recinto; anima si `animate`. */
  private applyCamera(animate: boolean): void {
    if (!this.konva || !this.stage || !this.layer) return;
    const focusId = this.focusLocalityId();
    const focusBox = focusId ? this.boxOf(this.seats().filter((s) => s.localityId === focusId)) : null;
    const box = focusBox ?? this.boxOf(this.seats());
    if (!box) {
      this.stage.size({ width: this.viewportWidth(), height: 160 });
      return;
    }
    const cam = this.cameraFor(box);
    if (animate) {
      new this.konva.Tween({
        node: this.layer,
        duration: 0.45,
        easing: this.konva.Easings.EaseInOut,
        scaleX: cam.scale,
        scaleY: cam.scale,
        x: cam.x,
        y: cam.y,
      }).play();
    } else {
      this.layer.scale({ x: cam.scale, y: cam.scale });
      this.layer.position({ x: cam.x, y: cam.y });
      this.layer.draw();
    }
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const sel = this.selected();
    const activeLoc = this.selectableLocalityId();

    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      const taken = seat.status !== 'available';
      const chosen = sel.has(seat.id);
      // Bloqueada = hay una localidad activa y este asiento es de OTRA.
      const locked = !!activeLoc && seat.localityId !== activeLoc;
      const color = taken ? COLORS.taken : chosen ? COLORS.selected : COLORS.available;

      const g = new K.Group({ x: seat.x as number, y: seat.y as number, opacity: locked ? 0.4 : 1 });
      g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: color }));
      g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: color }));
      if (chosen && !taken && !locked) {
        g.add(this.icon(K, '✓', '#ffffff'));
      } else if (taken) {
        g.add(this.icon(K, '×', '#9aa0b0'));
      }

      // Clic: en OTRA zona → cambia de localidad; en la activa disponible → selecciona.
      g.on('click tap', () => {
        if (locked || (!activeLoc && this.focusLocalityId() !== seat.localityId)) {
          this.localityPick.emit(seat.localityId);
          return;
        }
        if (!taken) this.seatToggle.emit(seat.id);
      });
      const clickable = locked || !taken;
      g.on('mouseenter', () => this.setCursor(clickable ? 'pointer' : 'grab'));
      g.on('mouseleave', () => this.setCursor('grab'));
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

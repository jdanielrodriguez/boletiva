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

// Paleta alineada a la marca (mismos hex que la leyenda en styles.scss).
const COLORS = {
  available: '#35d07f', // = --pe-success
  selected: '#e14eca', // = --pe-accent (rosa de marca)
  taken: '#3a3f52',
  owned: '#3b82f6', // AZUL: asientos que el usuario YA compró
};
const PAD = 46; // margen (coords de mundo) al encuadrar un box

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Mapa de asientos con Konva/Canvas y CÁMARA (B0). Dibuja TODO el recinto en un
 * "mundo"; la cámara = transform del STAGE (scale + position) → se puede ARRASTRAR
 * desde cualquier punto (incluidas zonas vacías) y hacer zoom. La vista completa del
 * recinto = 100%; enfocar una localidad hace un tween cinematográfico (>100%);
 * también se puede alejar (<100%). `disabled` muestra un velo "no aplica" (pero un
 * clic en una zona igual la selecciona). Solo navegador (import dinámico de Konva).
 */
@Component({
  selector: 'app-seat-map',
  template: `
    <div class="seat-map-zoom" role="group" aria-label="Zoom del mapa">
      <button type="button" class="btn small icon-only" (click)="zoomOut()" data-testid="seat-zoom-out" aria-label="Alejar">−</button>
      <span class="seat-zoom-lvl" data-testid="seat-zoom-lvl">{{ displayZoom() }}%</span>
      <button type="button" class="btn small icon-only" (click)="zoomIn()" data-testid="seat-zoom-in" aria-label="Acercar">+</button>
      <button type="button" class="btn small icon-only" (click)="resetCamera()" data-testid="seat-zoom-reset" aria-label="Ver todo el recinto" title="Ver todo el recinto">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div class="seat-map-frame">
      @if (stageLabel()) {
        <div class="seat-stage" data-testid="seat-stage" aria-hidden="true"><span>{{ stageLabel() }}</span></div>
      }
      <div class="seat-map-viewport">
        <div #host class="seat-map-host"></div>
        @if (disabled() && disabledLabel()) {
          <div class="seat-map-veil" data-testid="seat-map-veil" aria-hidden="true">
            <span>{{ disabledLabel() }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    ':host { display: block; width: 100%; }',
    '.seat-map-frame { border-radius: 12px; background: var(--pe-bg); padding: 0.25rem; overflow: hidden; }',
    '.seat-map-viewport { position: relative; }',
    // Viewport de ALTO FIJO sin overflow: la cámara (pan/zoom) recorre el mundo.
    // touch-action: pan-y → en móvil UN dedo scrollea la PÁGINA (vertical); DOS dedos
    // los captura el JS (pan + pinch). En desktop el pan es con el mouse (drag).
    '.seat-map-host { display: block; width: 100%; height: clamp(320px, 60vh, 680px); overflow: hidden; touch-action: pan-y; cursor: grab; background: var(--pe-bg); }',
    '.seat-map-host:active { cursor: grabbing; }',
    // Velo oscuro cuando la zona activa no está en el mapa (general). No bloquea el
    // puntero (pointer-events:none) → un clic igual llega a los asientos (cambia zona).
    '.seat-map-veil { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; border-radius: 12px; background: rgba(10, 13, 19, 0.55); }',
    '.seat-map-veil span { padding: 0.5rem 1.1rem; border-radius: 999px; background: rgba(0,0,0,0.55); color: #fff; font-weight: 600; font-size: 0.85rem; letter-spacing: 0.02em; }',
    '.seat-map-zoom { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; }',
    '.seat-zoom-lvl { min-width: 3.6rem; text-align: center; font-variant-numeric: tabular-nums; color: var(--pe-text-muted, #6b6b76); }',
    '.seat-stage { display: flex; justify-content: center; margin: 0.15rem auto 0.6rem; }',
    '.seat-stage span { display: inline-block; min-width: 55%; text-align: center; padding: 0.4rem 1.5rem; border-radius: 8px; background: var(--pe-surface-2); color: var(--pe-text-muted, #6b6b76); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; box-shadow: inset 0 -3px 0 var(--pe-border); }',
  ],
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  readonly stageLabel = input<string | null>(null);
  /** CÁMARA: localidad a encuadrar (zoom). null = encuadra todo (100%). */
  readonly focusLocalityId = input<string | null>(null);
  /** BLOQUEO: solo esta localidad es seleccionable; las demás se atenúan (clic = cambia zona). */
  readonly selectableLocalityId = input<string | null>(null);
  /** Velo "no aplica" (zona general activa): mapa visible pero sin selección de asientos. */
  readonly disabled = input(false);
  readonly disabledLabel = input<string | null>(null);
  /** Duración del tween cinematográfico de cámara (ms). Configurable por el admin. */
  readonly cameraMs = input(900);
  readonly seatToggle = output<string>();
  /** Clic en una zona → id de su localidad (cambiar/enfocar). */
  readonly localityPick = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  /** Zoom mostrado (% relativo a la vista completa = 100%). Se fija al terminar el tween. */
  protected readonly displayZoom = signal(100);

  private readonly MIN_REL = 0.4; // se puede alejar hasta 40% de la vista completa
  private readonly MAX_REL = 6; // y acercar hasta 600%

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private farScale = 1; // escala de la vista completa (referencia 100%)
  private lastFocus: string | null | undefined = undefined;
  private lastDist = 0; // pinch: distancia previa entre 2 dedos
  private lastCenter: { x: number; y: number } | null = null;
  private cleanupWheel: (() => void) | null = null;

  constructor() {
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.build();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.host().nativeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.cleanupWheel?.();
    });
    effect(() => {
      this.seats();
      this.selected();
      this.selectableLocalityId();
      this.disabled();
      const focus = this.focusLocalityId();
      if (!this.stage) return;
      const focusChanged = this.lastFocus !== focus;
      this.lastFocus = focus;
      this.redraw();
      this.applyCamera(focusChanged); // anima solo al cambiar el foco
    });
  }

  private build(): void {
    if (!this.konva) return;
    const el = this.host().nativeElement;
    // En dispositivos táctiles NO se arrastra con un dedo (ese dedo scrollea la
    // página); el pan es con DOS dedos (custom). En desktop, drag con el mouse.
    const isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
    this.stage = new this.konva.Stage({
      container: el,
      width: this.vw(),
      height: this.vh(),
      draggable: !isTouch,
    });
    this.layer = new this.konva.Layer();
    this.stage.add(this.layer);
    this.lastFocus = this.focusLocalityId();
    this.redraw();
    this.applyCamera(false);
    this.installGestures(el);
  }

  /** Wheel (desktop): zoom hacia el cursor. Táctil: 2 dedos = pan + pinch (zoom). */
  private installGestures(el: HTMLElement): void {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // dentro del canvas la rueda hace ZOOM, no scroll de página
      const rect = el.getBoundingClientRect();
      this.zoomAtLocal(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    this.cleanupWheel = () => el.removeEventListener('wheel', onWheel);

    this.stage?.on('touchmove', (e) => {
      const touches = (e.evt as TouchEvent).touches;
      if (touches.length !== 2 || !this.stage) return;
      e.evt.preventDefault();
      const rect = el.getBoundingClientRect();
      const p1 = { x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top };
      const p2 = { x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (this.lastDist > 0 && this.lastCenter) {
        const old = this.stage.scaleX();
        const target = this.clampScale(old * (dist / this.lastDist));
        const wx = (center.x - this.stage.x()) / old;
        const wy = (center.y - this.stage.y()) / old;
        const dx = center.x - this.lastCenter.x;
        const dy = center.y - this.lastCenter.y;
        this.stage.scale({ x: target, y: target });
        this.stage.position({ x: center.x - wx * target + dx, y: center.y - wy * target + dy });
        this.stage.batchDraw();
        this.updateZoom();
      }
      this.lastDist = dist;
      this.lastCenter = center;
    });
    this.stage?.on('touchend', () => {
      this.lastDist = 0;
      this.lastCenter = null;
    });
  }

  private clampScale(s: number): number {
    return Math.max(this.farScale * this.MIN_REL, Math.min(this.farScale * this.MAX_REL, s));
  }

  /** Zoom manteniendo fijo el punto (lx,ly) del viewport. `animate` = tween cinematográfico. */
  private zoomAtLocal(lx: number, ly: number, factor: number, animate = false): void {
    if (!this.stage) return;
    const old = this.stage.scaleX();
    const target = this.clampScale(old * factor);
    const wx = (lx - this.stage.x()) / old;
    const wy = (ly - this.stage.y()) / old;
    const pos = { x: lx - wx * target, y: ly - wy * target };
    if (animate) {
      this.moveCamera(target, pos, true);
    } else {
      this.stage.scale({ x: target, y: target });
      this.stage.position(pos);
      this.stage.batchDraw();
      this.updateZoom();
    }
  }

  private onResize(): void {
    if (!this.stage) return;
    this.stage.size({ width: this.vw(), height: this.vh() });
    this.applyCamera(false);
  }

  private redraw(): void {
    this.layer?.destroyChildren();
    this.drawSeats();
  }

  private vw(): number {
    const el = this.host().nativeElement;
    return el.clientWidth || el.parentElement?.clientWidth || 320;
  }
  private vh(): number {
    return this.host().nativeElement.clientHeight || 420;
  }

  private boxOf(seats: SeatAvailabilityDto[]): Box | null {
    const pts = seats.filter((s) => s.x != null && s.y != null);
    if (pts.length === 0) return null;
    const xs = pts.map((s) => s.x as number);
    const ys = pts.map((s) => s.y as number);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  /** Escala que encuadra un box en el viewport (fit ambos ejes). */
  private fitScale(box: Box): number {
    const boxW = box.maxX - box.minX + PAD * 2;
    const boxH = box.maxY - box.minY + PAD * 2;
    return Math.min(this.vw() / boxW, this.vh() / boxH);
  }

  /** Posición del stage para centrar `box` a una `scale` dada. */
  private centerPos(box: Box, scale: number): { x: number; y: number } {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return { x: this.vw() / 2 - cx * scale, y: this.vh() / 2 - cy * scale };
  }

  /** Mueve la cámara al foco (localidad) o a la vista completa (100%); anima si procede. */
  private applyCamera(animate: boolean): void {
    if (!this.konva || !this.stage) return;
    const world = this.boxOf(this.seats());
    if (!world) return;
    this.farScale = this.fitScale(world); // referencia 100%

    const focusId = this.focusLocalityId();
    const focusBox = focusId ? this.boxOf(this.seats().filter((s) => s.localityId === focusId)) : null;
    const box = focusBox ?? world;
    // La vista completa va exacta al 100%; una localidad se acerca a su encuadre.
    const scale = focusBox ? this.fitScale(box) : this.farScale;
    const pos = this.centerPos(box, scale);
    this.moveCamera(scale, pos, animate);
  }

  private moveCamera(scale: number, pos: { x: number; y: number }, animate: boolean): void {
    if (!this.konva || !this.stage) return;
    const finish = () => this.updateZoom();
    if (animate) {
      new this.konva.Tween({
        node: this.stage,
        duration: Math.max(0, this.cameraMs()) / 1000,
        easing: this.konva.Easings.EaseInOut,
        scaleX: scale,
        scaleY: scale,
        x: pos.x,
        y: pos.y,
        onFinish: finish,
      }).play();
    } else {
      this.stage.scale({ x: scale, y: scale });
      this.stage.position(pos);
      this.stage.batchDraw();
      finish();
    }
  }

  /** Actualiza el % mostrado (relativo a la vista completa = 100%). */
  private updateZoom(): void {
    if (!this.stage || this.farScale <= 0) return;
    this.displayZoom.set(Math.round((this.stage.scaleX() / this.farScale) * 100));
  }

  /** Zoom manual alrededor del centro del viewport (mantiene el punto central). */
  private zoomBy(factor: number): void {
    if (!this.stage) return;
    const cur = this.stage.scaleX();
    const target = Math.max(this.farScale * this.MIN_REL, Math.min(this.farScale * this.MAX_REL, cur * factor));
    // Punto de mundo en el centro del viewport (para no “saltar”).
    const p = this.stage.position();
    const wx = (this.vw() / 2 - p.x) / cur;
    const wy = (this.vh() / 2 - p.y) / cur;
    const pos = { x: this.vw() / 2 - wx * target, y: this.vh() / 2 - wy * target };
    this.moveCamera(target, pos, true);
  }

  protected zoomIn(): void {
    this.zoomBy(1.35);
  }
  protected zoomOut(): void {
    this.zoomBy(1 / 1.35);
  }
  /** Botón reiniciar: vuelve a la vista completa del recinto (100%, donde inicia). */
  protected resetCamera(): void {
    const world = this.boxOf(this.seats());
    if (!world) return;
    this.farScale = this.fitScale(world);
    this.moveCamera(this.farScale, this.centerPos(world, this.farScale), true);
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const sel = this.selected();
    const activeLoc = this.selectableLocalityId();
    const allDisabled = this.disabled();

    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      const owned = !!(seat as { owned?: boolean }).owned;
      const taken = seat.status !== 'available';
      const chosen = sel.has(seat.id);
      // Bloqueada = mapa deshabilitado (zona general activa) o de OTRA localidad.
      const locked = allDisabled || (!!activeLoc && seat.localityId !== activeLoc);
      const color = owned
        ? COLORS.owned
        : taken
          ? COLORS.taken
          : chosen && !locked
            ? COLORS.selected
            : COLORS.available;

      const g = new K.Group({ x: seat.x as number, y: seat.y as number, opacity: locked && !owned ? 0.45 : 1 });
      g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: color }));
      g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: color }));
      if (owned) {
        g.add(this.icon(K, '✓', '#ffffff'));
      } else if (chosen && !taken && !locked) {
        g.add(this.icon(K, '✓', '#ffffff'));
      } else if (taken) {
        g.add(this.icon(K, '×', '#9aa0b0'));
      }

      // Clic: en OTRA zona (o mapa deshabilitado) → cambia de localidad; en la activa
      // disponible → selecciona. (El velo no bloquea: pointer-events:none.)
      g.on('click tap', () => {
        if (locked || (!activeLoc && this.focusLocalityId() !== seat.localityId)) {
          this.localityPick.emit(seat.localityId);
          return;
        }
        if (!taken) this.seatToggle.emit(seat.id);
      });
      // Doble clic/tap: acerca la cámara (cinematográfico) hacia el punto → ver las
      // mesas/asientos de la zona. (Zoom out con la rueda/pinch/reset vuelve a todo.)
      g.on('dblclick dbltap', () => {
        const p = this.stage?.getPointerPosition();
        if (p) this.zoomAtLocal(p.x, p.y, 2, true);
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

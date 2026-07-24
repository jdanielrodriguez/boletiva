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
import { ClickDelayService } from '../../core/ui/click-delay.service';

// Paleta alineada a la marca (mismos hex que la leyenda en styles.scss).
const COLORS = {
  available: '#35d07f', // = --pe-success
  selected: '#e14eca', // = --pe-accent (rosa de marca)
  taken: '#3a3f52', // VENDIDO (gris)
  reserved: '#f59e0b', // RESERVADO (ámbar) — vendido temporalmente por otro
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
 * Decoraciones del recinto (mismo espacio de coordenadas que los asientos) → se
 * dibujan en el CANVAS y por eso se anclan y mueven/zoomean con el mapa (el ESCENARIO
 * ya no queda flotando en el centro). Vienen de `SeatMap.layout` del evento.
 */
/** Región de una localidad SIN asientos (p.ej. General): un área clicable del mapa que
 *  selecciona la localidad (activa su input de cantidad) y se resalta al estar activa. */
export interface MapRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  active?: boolean;
  /** Si viene, la región se dibuja como banda CURVA (anillo) — p.ej. Generales en U. */
  arc?: { cx: number; cy: number; innerRadius: number; outerRadius: number; rotation: number; angle: number };
}

export interface MapDecorations {
  /** Barra del ESCENARIO (rect negro + texto). */
  stage?: { x: number; y: number; w: number; h: number; label?: string };
  /** Bloques sin asientos: FOH, PLATEA, torres de sonido, etc. */
  blocks?: { x: number; y: number; w: number; h: number; label?: string; fill?: string }[];
  /** Etiquetas de zona (TRIBUNA / PREFERENCIA / GENERAL 1 / MESAS…). rotation en grados. */
  labels?: { x: number; y: number; text: string; rotation?: number; size?: number }[];
  /** Puntos de primeros auxilios (cruz roja). */
  aids?: { x: number; y: number }[];
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
      <div class="seat-map-viewport">
        <div #host class="seat-map-host"></div>
        @if (disabled() && disabledLabel()) {
          <div class="seat-map-veil" data-testid="seat-map-veil" aria-hidden="true">
            <span>{{ disabledLabel() }}</span>
          </div>
        }
        @if (tip(); as t) {
          <div class="seat-tip" data-testid="seat-tip" [style.left.px]="t.x" [style.top.px]="t.y" aria-hidden="true">{{ t.text }}</div>
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
    // Tooltip del asiento (número + precio / estado). Sigue al cursor; no intercepta.
    '.seat-tip { position: absolute; transform: translate(-50%, -140%); pointer-events: none; z-index: 5; white-space: nowrap; padding: 0.3rem 0.6rem; border-radius: 8px; background: #10141c; color: #fff; font-size: 0.78rem; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,0.35); }',
    '.seat-map-zoom { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; }',
    '.seat-zoom-lvl { min-width: 3.6rem; text-align: center; font-variant-numeric: tabular-nums; color: var(--pe-text-muted, #6b6b76); }',
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
  /** Precio del comprador por localidad (id → "Q123.45") para el tooltip del asiento. */
  readonly priceByLocality = input<Record<string, string>>({});
  /** Decoraciones del recinto (escenario, FOH, PLATEA, etiquetas, primeros auxilios). */
  readonly decorations = input<MapDecorations | null>(null);
  /** Regiones de localidades SIN asientos (Generales): áreas clicables del mapa. */
  readonly regions = input<MapRegion[]>([]);
  /** Localidades que se dibujan como MESAS (círculos) en vez de sillas. */
  readonly tableLocalityIds = input<ReadonlySet<string>>(new Set<string>());
  /** Nombre por localidad (para las etiquetas de los bloques de zona en la vista lejana/LOD). */
  readonly localityNames = input<Record<string, string>>({});
  readonly seatToggle = output<string>();
  /** Clic en una zona → id de su localidad (cambiar/enfocar). */
  readonly localityPick = output<string>();
  /** Al alejar el zoom por debajo del overview estando enfocado → salir de la zona. */
  readonly exitFocus = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly clickDelay = inject(ClickDelayService);

  /** Zoom mostrado (% relativo a la vista completa = 100%). Se fija al terminar el tween. */
  protected readonly displayZoom = signal(100);
  /** Tooltip del asiento bajo el cursor (número + precio, o estado). */
  protected readonly tip = signal<{ text: string; x: number; y: number } | null>(null);

  private readonly MIN_REL = 0.4; // se puede alejar hasta 40% de la vista completa
  private readonly MAX_REL = 6; // y acercar hasta 600%

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private farScale = 1; // escala de la vista completa (referencia 100%)
  private lastFocus: string | null | undefined = undefined;
  private redrawRaf = 0; // handle del requestAnimationFrame para throttle del redraw en pan
  private holdTimer: ReturnType<typeof setTimeout> | null = null; // click sostenido → zoom a mesa
  private suppressFit = false; // auto-foco por zoom: enfoca SIN reencuadrar (mantiene el zoom)
  private fadeInNext = false; // al cambiar de foco → las mesas/sillas entran con fundido suave
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
      this.cancelHold();
      if (this.redrawRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.redrawRaf);
    });
    effect(() => {
      this.seats();
      this.selected();
      this.selectableLocalityId();
      this.disabled();
      this.decorations();
      this.regions();
      this.tableLocalityIds();
      this.localityNames();
      this.stageLabel();
      const focus = this.focusLocalityId();
      if (!this.stage) return;
      const focusChanged = this.lastFocus !== focus;
      this.lastFocus = focus;
      // Al ENTRAR/CAMBIAR a una zona enfocada, las mesas/sillas entran con fundido suave.
      if (focusChanged && focus != null) this.fadeInNext = true;
      this.redraw();
      // Reencuadra si cambia el foco (animado) o si NO hay foco (overview sigue los
      // datos). Con foco fijo (p.ej. al seleccionar un asiento) NO se mueve. Y el
      // auto-foco por zoom (suppressFit) NO reencuadra → mantiene el zoom que hiciste.
      if (focusChanged && !this.suppressFit) this.applyCamera(true);
      else if (focus == null && !focusChanged) this.applyCamera(false);
      this.suppressFit = false;
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

    // Pan (arrastre) → re-cullea (redibuja lo visible) en el próximo frame.
    this.stage?.on('dragmove', () => {
      this.cancelHold();
      this.scheduleRedraw();
    });

    // Punto de mundo bajo el cursor/dedo.
    const worldPoint = (): { wx: number; wy: number } | null => {
      if (!this.stage) return null;
      const p = this.stage.getPointerPosition();
      if (!p) return null;
      const s = this.stage.scaleX() || 1;
      return { wx: (p.x - this.stage.x()) / s, wy: (p.y - this.stage.y()) / s };
    };

    // Clic SOSTENIDO (~450ms sin moverse) → zoom a la mesa (o enfoca la localidad).
    this.stage?.on('mousedown touchstart', () => {
      const pt = worldPoint();
      if (!pt) return;
      this.cancelHold();
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        this.focusOrMesa(pt.wx, pt.wy);
      }, 450);
    });
    this.stage?.on('mouseup touchend mouseleave', () => this.cancelHold());

    // Doble clic/tap: zoom a la MESA bajo el punto (si hay zona enfocada) o enfoca la zona.
    this.stage?.on('dblclick dbltap', () => {
      const pt = worldPoint();
      if (pt) this.focusOrMesa(pt.wx, pt.wy);
    });

    // Clic en zona VACÍA (fondo, no una zona/asiento) con una GENERAL activa → salir:
    // quita el velo/mensaje y el input de cantidad hasta elegir otra zona o alejar el zoom.
    this.stage?.on('click tap', (e: Konva.KonvaEventObject<Event>) => {
      if (e.target === this.stage && this.disabled()) this.exitFocus.emit();
    });
  }

  private cancelHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  /** bbox por localidad (a partir de los asientos). */
  private localityBoxes(): Map<string, Box> {
    const m = new Map<string, Box>();
    for (const s of this.seats()) {
      if (s.x == null || s.y == null) continue;
      const b = m.get(s.localityId);
      if (!b) m.set(s.localityId, { minX: s.x, minY: s.y, maxX: s.x, maxY: s.y });
      else {
        b.minX = Math.min(b.minX, s.x as number);
        b.minY = Math.min(b.minY, s.y as number);
        b.maxX = Math.max(b.maxX, s.x as number);
        b.maxY = Math.max(b.maxY, s.y as number);
      }
    }
    return m;
  }

  /** Rectángulo VISIBLE del mundo (para culling), con margen. */
  private viewRect(): Box {
    const s = this.stage?.scaleX() || 1;
    const px = this.stage?.x() ?? 0;
    const py = this.stage?.y() ?? 0;
    const m = 60 / s; // margen en coords de mundo
    const x0 = -px / s - m;
    const y0 = -py / s - m;
    return { minX: x0, minY: y0, maxX: x0 + this.vw() / s + 2 * m, maxY: y0 + this.vh() / s + 2 * m };
  }
  private inView(x: number, y: number, v: Box): boolean {
    return x >= v.minX && x <= v.maxX && y >= v.minY && y <= v.maxY;
  }

  /** Redibuja en el próximo frame (throttle) — al hacer pan/zoom, para re-cullear. */
  private scheduleRedraw(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      this.redraw();
      return;
    }
    if (this.redrawRaf) return;
    this.redrawRaf = requestAnimationFrame(() => {
      this.redrawRaf = 0;
      this.redraw();
    });
  }

  /** bbox de la MESA (grupo localityId|row) que contiene (wx,wy), en la localidad enfocada. */
  private mesaBoxAt(wx: number, wy: number): Box | null {
    const focus = this.focusLocalityId();
    if (!focus) return null;
    const byRow = new Map<string, Box>();
    for (const s of this.seats()) {
      if (s.x == null || s.y == null || s.localityId !== focus) continue;
      const k = s.row ?? '';
      const b = byRow.get(k);
      if (!b) byRow.set(k, { minX: s.x, minY: s.y, maxX: s.x, maxY: s.y });
      else {
        b.minX = Math.min(b.minX, s.x as number);
        b.minY = Math.min(b.minY, s.y as number);
        b.maxX = Math.max(b.maxX, s.x as number);
        b.maxY = Math.max(b.maxY, s.y as number);
      }
    }
    const PADM = 14;
    for (const b of byRow.values()) {
      if (wx >= b.minX - PADM && wx <= b.maxX + PADM && wy >= b.minY - PADM && wy <= b.maxY + PADM) return b;
    }
    return null;
  }

  /** Localidad cuyo área (bbox + margen) contiene el punto de mundo (wx,wy), o null. */
  private localityAt(wx: number, wy: number): string | null {
    const PADH = 24;
    for (const [id, b] of this.localityBoxes()) {
      if (wx >= b.minX - PADH && wx <= b.maxX + PADH && wy >= b.minY - PADH && wy <= b.maxY + PADH) return id;
    }
    return null;
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
    this.tip.set(null); // el destroy de nodos no dispara mouseleave → limpia el tooltip
    this.layer?.destroyChildren();
    this.drawDecorations(); // debajo de los asientos
    this.drawRegions(); // regiones clicables (Generales sin asientos)
    // Los BLOQUES (cuadros) de zona se dibujan SIEMPRE: la localidad ENFOCADA se salta
    // (sus mesas la cubren) y las demás quedan como su cuadro (apagado si hay foco).
    this.drawZoneBlocks();
    if (this.focusLocalityId() != null) {
      const K = this.konva;
      const before = this.layer && K ? [...this.layer.getChildren()] : [];
      this.drawTables(); // mesas (centro) debajo de sus sillas — SOLO la enfocada
      this.drawSeats();
      // Fundido de entrada (una vez por cambio de foco): reagrupo lo recién dibujado y
      // subo su opacidad 0→1 con un tween suave (mismo tacto que el zoom). El re-cull del
      // pan NO fade (fadeInNext ya está en false).
      if (this.fadeInNext && K && this.layer) {
        this.fadeInNext = false;
        const fresh = [...this.layer.getChildren()].filter((n) => !before.includes(n));
        if (fresh.length) {
          // Cancela un redraw ya agendado (p.ej. el del zoom en el auto-foco): si no, el
          // rAF pendiente redibujaría a opacidad 1 y "pisaría" el fundido → aparición seca.
          if (this.redrawRaf && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.redrawRaf);
            this.redrawRaf = 0;
          }
          const group = new K.Group({ opacity: 0 });
          fresh.forEach((n) => n.moveTo(group));
          this.layer.add(group);
          new K.Tween({ node: group, opacity: 1, duration: 0.6, easing: K.Easings.EaseInOut }).play();
        }
      }
    }
  }

  /** Regiones de localidades SIN asientos (Generales): rect clicable que selecciona la
   *  localidad (activa su input) y se resalta al estar activa. */
  private drawRegions(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    for (const r of this.regions()) {
      const fill = r.active ? 'rgba(225,78,202,0.28)' : 'rgba(107,107,118,0.14)';
      const stroke = r.active ? '#e14eca' : '#b9b3a6';
      const strokeWidth = r.active ? 3 : 1.5;
      let labelX = r.x + r.w / 2;
      let labelY = r.y + r.h / 2;
      if (r.arc) {
        const a = r.arc;
        const shape = new K.Arc({
          x: a.cx, y: a.cy, innerRadius: a.innerRadius, outerRadius: a.outerRadius,
          angle: a.angle, rotation: a.rotation, fill, stroke, strokeWidth,
        });
        shape.on('click tap', () => this.localityPick.emit(r.id));
        shape.on('mouseenter', () => this.setCursor('pointer'));
        shape.on('mouseleave', () => this.setCursor('grab'));
        this.layer.add(shape);
        const mid = ((a.rotation + a.angle / 2) * Math.PI) / 180;
        const midR = (a.innerRadius + a.outerRadius) / 2;
        labelX = a.cx + midR * Math.cos(mid);
        labelY = a.cy + midR * Math.sin(mid);
      } else {
        const rect = new K.Rect({ x: r.x, y: r.y, width: r.w, height: r.h, cornerRadius: 12, fill, stroke, strokeWidth });
        rect.on('click tap', () => this.localityPick.emit(r.id));
        rect.on('mouseenter', () => this.setCursor('pointer'));
        rect.on('mouseleave', () => this.setCursor('grab'));
        this.layer.add(rect);
      }
      if (r.label) {
        this.layer.add(new K.Text({ x: labelX - 80, y: labelY - 12, width: 160, height: 24, text: r.label, align: 'center', verticalAlign: 'middle', fontSize: 18, fontStyle: 'bold', fill: '#1a1a2e', listening: false }));
      }
    }
  }

  /** CUADRO por localidad (bbox + nombre), como el overview de VivaTicket. Se dibuja
   *  SIEMPRE: la localidad ENFOCADA se salta (sus mesas la cubren); si hay foco, las demás
   *  quedan APAGADAS (menor opacidad). Clicable → enfoca esa localidad. */
  private drawZoneBlocks(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const names = this.localityNames();
    const focus = this.focusLocalityId();
    const boxes = new Map<string, Box>();
    for (const s of this.seats()) {
      if (s.x == null || s.y == null) continue;
      const b = boxes.get(s.localityId);
      if (!b) boxes.set(s.localityId, { minX: s.x, minY: s.y, maxX: s.x, maxY: s.y });
      else {
        b.minX = Math.min(b.minX, s.x as number);
        b.minY = Math.min(b.minY, s.y as number);
        b.maxX = Math.max(b.maxX, s.x as number);
        b.maxY = Math.max(b.maxY, s.y as number);
      }
    }
    const PADZ = 8; // el cuadro ciñe los asientos (padding chico) → no invade los huecos vecinos (FOH, columnas)
    for (const [id, b] of boxes) {
      if (id === focus) continue; // la zona enfocada se dibuja como mesas, no como cuadro
      const dim = focus != null; // hay una zona enfocada → las demás apagadas
      const g = new K.Group({ opacity: dim ? 0.4 : 1 });
      const rect = new K.Rect({
        x: b.minX - PADZ, y: b.minY - PADZ, width: b.maxX - b.minX + PADZ * 2, height: b.maxY - b.minY + PADZ * 2,
        cornerRadius: 8, fill: 'rgba(53,208,127,0.16)', stroke: '#35d07f', strokeWidth: 1.5,
      });
      rect.on('click tap', () => this.localityPick.emit(id));
      rect.on('mouseenter', () => this.setCursor('pointer'));
      rect.on('mouseleave', () => this.setCursor('grab'));
      g.add(rect);
      const name = names[id];
      if (name) {
        g.add(new K.Text({
          x: b.minX - PADZ, y: b.minY - PADZ, width: b.maxX - b.minX + PADZ * 2, height: b.maxY - b.minY + PADZ * 2,
          text: name, align: 'center', verticalAlign: 'middle', fontSize: 16, fontStyle: 'bold', fill: '#1a1a2e', listening: false,
        }));
      }
      this.layer.add(g);
    }
  }

  /** Dibuja la MESA (círculo central marrón) al centroide de cada grupo de sillas
   *  (mismo `localityId` + `row`) en las zonas de mesas → las sillas quedan alrededor. */
  private drawTables(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const tables = this.tableLocalityIds();
    if (tables.size === 0) return;
    // SOLO la localidad enfocada (culling por localidad); si no hay foco, ninguna mesa.
    const focus = this.focusLocalityId();
    if (!focus || !tables.has(focus)) return;
    const groups = new Map<string, Box>();
    for (const s of this.seats()) {
      if (s.x == null || s.y == null || s.localityId !== focus) continue;
      const key = `${s.localityId}|${s.row ?? ''}`;
      const b = groups.get(key);
      if (!b) groups.set(key, { minX: s.x, minY: s.y, maxX: s.x, maxY: s.y });
      else {
        b.minX = Math.min(b.minX, s.x as number);
        b.minY = Math.min(b.minY, s.y as number);
        b.maxX = Math.max(b.maxX, s.x as number);
        b.maxY = Math.max(b.maxY, s.y as number);
      }
    }
    const view = this.viewRect();
    for (const [key, b] of groups) {
      const cx = (b.minX + b.maxX) / 2;
      if (!this.inView(cx, (b.minY + b.maxY) / 2, view)) continue; // culling por viewport
      // MESA vertical oscura con el NÚMERO (como VivaTicket); los puntos (sillas) la
      // flanquean izquierda/derecha.
      this.layer.add(new K.Rect({ x: cx - 6, y: b.minY - 2, width: 12, height: b.maxY - b.minY + 4, cornerRadius: 5, fill: '#3a3f52', listening: false }));
      const num = (key.split('|')[1] ?? '').replace(/\D/g, '');
      if (num) {
        this.layer.add(new K.Text({ x: cx - 10, y: b.minY - 2, width: 20, height: b.maxY - b.minY + 4, text: num, align: 'center', verticalAlign: 'middle', fontSize: 8, fontStyle: 'bold', fill: '#ffffff', listening: false }));
      }
    }
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

  /** Caja del recinto completo = asientos ∪ decoraciones (escenario/bloques/etiquetas). */
  private worldBox(): Box | null {
    let b = this.boxOf(this.seats());
    const grow = (x: number, y: number, w = 0, h = 0) => {
      if (!b) b = { minX: x, minY: y, maxX: x + w, maxY: y + h };
      else {
        b.minX = Math.min(b.minX, x);
        b.minY = Math.min(b.minY, y);
        b.maxX = Math.max(b.maxX, x + w);
        b.maxY = Math.max(b.maxY, y + h);
      }
    };
    const d = this.decorations();
    if (d?.stage) grow(d.stage.x, d.stage.y, d.stage.w, d.stage.h);
    d?.blocks?.forEach((k) => grow(k.x, k.y, k.w, k.h));
    d?.labels?.forEach((l) => grow(l.x, l.y));
    d?.aids?.forEach((a) => grow(a.x, a.y));
    this.regions().forEach((r) => grow(r.x, r.y, r.w, r.h));
    return b;
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
    const world = this.worldBox();
    if (!world) return;
    this.farScale = this.fitScale(world); // referencia 100%

    const focusId = this.focusLocalityId();
    let focusBox = focusId ? this.boxOf(this.seats().filter((s) => s.localityId === focusId)) : null;
    // Localidad SIN asientos (General): enfoca su REGIÓN.
    if (focusId && !focusBox) {
      const reg = this.regions().find((r) => r.id === focusId);
      if (reg) focusBox = { minX: reg.x, minY: reg.y, maxX: reg.x + reg.w, maxY: reg.y + reg.h };
    }
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
    this.tip.set(null); // cualquier zoom cierra el tooltip (evita que se quede pegado)
    const rel = this.stage.scaleX() / this.farScale;
    this.displayZoom.set(Math.round(rel * 100));
    this.scheduleRedraw(); // re-cullea (viewport) tras el zoom
    const focused = this.focusLocalityId() != null;
    // SALIDA con umbral FIJO y BAJO (150%): igual para TODAS las zonas → el mismo zoom-out
    // suelta el foco (mesas→cuadros) en cualquiera. Queda por DEBAJO del encuadre de la zona
    // que menos acerca (Tribuna/Preferencia ~178%) → esas NO se cierran solas al entrar.
    // Histéresis con la entrada por auto-foco (250%). Sin recentrar (suppressFit).
    if (focused && rel < 1.5) {
      this.suppressFit = true;
      this.exitFocus.emit();
    } else if (!focused && rel >= 2.5) {
      // Pasaste el 250% sin foco → auto-enfoca la localidad bajo el CENTRO de la cámara
      // (igual que un doble clic), SIN reencuadrar (mantiene el zoom que ya hiciste).
      const cx = (this.vw() / 2 - this.stage.x()) / this.stage.scaleX();
      const cy = (this.vh() / 2 - this.stage.y()) / this.stage.scaleX();
      const loc = this.localityAt(cx, cy);
      if (loc) {
        this.suppressFit = true;
        this.localityPick.emit(loc);
      }
    }
  }

  /** Zoom (animado) para encuadrar un box (p.ej. una mesa). */
  private zoomToBox(box: Box): void {
    const scale = this.fitScale(box);
    this.moveCamera(scale, this.centerPos(box, scale), true);
  }

  /** Doble clic / clic sostenido: si hay zona enfocada → zoom a la MESA bajo el punto;
   *  si no, enfoca la localidad del punto. */
  private focusOrMesa(wx: number, wy: number): void {
    const mesa = this.mesaBoxAt(wx, wy);
    if (mesa) {
      this.zoomToBox(mesa);
      return;
    }
    const loc = this.localityAt(wx, wy);
    if (loc) this.localityPick.emit(loc);
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
    const world = this.worldBox();
    if (!world) return;
    this.farScale = this.fitScale(world);
    this.moveCamera(this.farScale, this.centerPos(world, this.farScale), true);
  }

  /** Dibuja escenario + bloques (FOH/PLATEA) + etiquetas + cruces de primeros auxilios
   *  en el mundo (se anclan y mueven/zoomean con el mapa). Debajo de los asientos. */
  private drawDecorations(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const d = this.decorations();

    // ESCENARIO: del layout, o (fallback) una barra centrada arriba de los asientos.
    let stage = d?.stage;
    if (!stage) {
      const b = this.boxOf(this.seats());
      if (b) {
        const w = (b.maxX - b.minX) * 0.5;
        stage = { x: (b.minX + b.maxX) / 2 - w / 2, y: b.minY - 90, w, h: 46, label: this.stageLabel() ?? undefined };
      }
    }
    if (stage) {
      this.layer.add(new K.Rect({ x: stage.x, y: stage.y, width: stage.w, height: stage.h, cornerRadius: 6, fill: '#0a0d13', listening: false }));
      this.layer.add(new K.Text({
        x: stage.x, y: stage.y, width: stage.w, height: stage.h, text: (stage.label ?? this.stageLabel() ?? 'ESCENARIO').toUpperCase(),
        align: 'center', verticalAlign: 'middle', fontSize: Math.min(30, stage.h * 0.55), fontStyle: 'bold', fill: '#ffffff', letterSpacing: 3, listening: false,
      }));
    }

    // Bloques sin asientos (FOH = navy; PLATEA/otros = gris) con su etiqueta.
    for (const k of d?.blocks ?? []) {
      this.layer.add(new K.Rect({ x: k.x, y: k.y, width: k.w, height: k.h, cornerRadius: 4, fill: k.fill ?? '#1e2a52', listening: false }));
      if (k.label) {
        this.layer.add(new K.Text({ x: k.x, y: k.y, width: k.w, height: k.h, text: k.label, align: 'center', verticalAlign: 'middle', fontSize: 13, fontStyle: 'bold', fill: '#e8ecf5', listening: false }));
      }
    }

    // Etiquetas de zona (TRIBUNA / PREFERENCIA / GENERAL / MESAS…), opcionalmente rotadas.
    for (const l of d?.labels ?? []) {
      this.layer.add(new K.Text({ x: l.x, y: l.y, text: l.text, rotation: l.rotation ?? 0, fontSize: l.size ?? 15, fontStyle: 'bold', fill: '#6b6b76', letterSpacing: 1, listening: false }));
    }

    // Cruces de primeros auxilios (cuadro blanco + cruz roja).
    for (const a of d?.aids ?? []) {
      this.layer.add(new K.Rect({ x: a.x - 9, y: a.y - 9, width: 18, height: 18, cornerRadius: 3, fill: '#ffffff', stroke: '#e11d48', strokeWidth: 1, listening: false }));
      this.layer.add(new K.Rect({ x: a.x - 6, y: a.y - 2, width: 12, height: 4, fill: '#e11d48', listening: false }));
      this.layer.add(new K.Rect({ x: a.x - 2, y: a.y - 6, width: 4, height: 12, fill: '#e11d48', listening: false }));
    }
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const sel = this.selected();
    const activeLoc = this.selectableLocalityId();
    const allDisabled = this.disabled();
    // SOLO la localidad enfocada + CULLING por viewport (miles de asientos no colapsan).
    const focus = this.focusLocalityId();
    const view = this.viewRect();

    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      if (focus && seat.localityId !== focus) continue; // solo la zona enfocada
      if (!this.inView(seat.x as number, seat.y as number, view)) continue; // culling
      const owned = !!(seat as { owned?: boolean }).owned;
      const reserved = seat.status === 'held'; // reservado por otro (temporal)
      const sold = seat.status !== 'available' && !reserved; // vendido (definitivo)
      const taken = reserved || sold;
      const chosen = sel.has(seat.id);
      // Bloqueada = mapa deshabilitado (zona general activa) o de OTRA localidad.
      const locked = allDisabled || (!!activeLoc && seat.localityId !== activeLoc);
      const color = owned
        ? COLORS.owned
        : sold
          ? COLORS.taken
          : reserved
            ? COLORS.reserved
            : chosen && !locked
              ? COLORS.selected
              : COLORS.available;

      const g = new K.Group({ x: seat.x as number, y: seat.y as number, opacity: locked && !owned ? 0.45 : 1 });
      const isTable = this.tableLocalityIds().has(seat.localityId);
      if (isTable) {
        // Zona de MESAS: la mesa (larga) la dibuja drawTables(); cada SILLA alrededor
        // es un PUNTO. Borde blanco = seleccionada.
        g.add(new K.Circle({ radius: 4, fill: color, stroke: chosen && !taken && !locked ? '#ffffff' : undefined, strokeWidth: chosen && !taken && !locked ? 2 : 0 }));
      } else {
        // SILLA pequeña MIRANDO al escenario (arriba): asiento + respaldo abajo. Más
        // chica que antes para que no se traslapen los iconos.
        g.add(new K.Rect({ x: -8, y: -6, width: 16, height: 11, cornerRadius: 4, fill: color }));
        g.add(new K.Rect({ x: -7, y: 6, width: 14, height: 4, cornerRadius: 2, fill: color }));
      }
      if (owned || (chosen && !taken && !locked)) {
        g.add(this.icon(K, '✓', '#ffffff'));
      } else if (taken) {
        g.add(this.icon(K, '×', '#9aa0b0'));
      }

      // Clic: en OTRA zona (o mapa deshabilitado) → cambia de localidad; en la activa
      // disponible → selecciona (+ velo breve de "procesando"). (El velo no bloquea.)
      g.on('click tap', () => {
        if (locked || (!activeLoc && this.focusLocalityId() !== seat.localityId)) {
          this.localityPick.emit(seat.localityId);
          return;
        }
        if (!taken) {
          const willSelect = !this.selected().has(seat.id);
          this.clickDelay.pulse(); // loader breve también al elegir asiento
          this.seatToggle.emit(seat.id);
          // Al SELECCIONAR una silla, centra la cámara en su MESA (no reencuadra la zona).
          if (willSelect && seat.row) {
            const mesa = this.mesaBoxAt(seat.x as number, seat.y as number);
            if (mesa) this.zoomToBox(mesa);
          }
        }
      });
      const clickable = locked || !taken;
      const tipText = this.tipText(seat, sold, reserved, owned);
      g.on('mouseenter', () => {
        this.setCursor(clickable ? 'pointer' : 'grab');
        const p = this.stage?.getPointerPosition();
        if (p) this.tip.set({ text: tipText, x: p.x, y: p.y });
      });
      g.on('mousemove', () => {
        const p = this.stage?.getPointerPosition();
        if (p) this.tip.update((t) => (t ? { ...t, x: p.x, y: p.y } : t));
      });
      g.on('mouseleave', () => {
        this.setCursor('grab');
        this.tip.set(null);
      });
      this.layer.add(g);
    }
    this.layer.draw();
  }

  private icon(K: typeof Konva, text: string, fill: string): Konva.Text {
    return new K.Text({
      text,
      x: -8,
      y: -8,
      width: 16,
      height: 16,
      align: 'center',
      verticalAlign: 'middle',
      fontSize: 11,
      fontStyle: 'bold',
      fill,
      listening: false,
    });
  }

  /** Texto del tooltip: MESA/FILA + ASIENTO (sin repetir la fila) + precio o estado.
   *  El label viene como `<fila>-<asiento>` (p.ej. "AD5-3") y la fila como `<pref><nº>`
   *  ("AD5"); mostramos "Mesa 5 · Asiento 3" (zona de mesas) o "Fila 12 · Asiento 3" (grada). */
  private tipText(seat: SeatAvailabilityDto, sold: boolean, reserved: boolean, owned: boolean): string {
    const seatNum = seat.label.includes('-') ? seat.label.slice(seat.label.lastIndexOf('-') + 1) : seat.label;
    const rowNum = (seat.row ?? '').replace(/^[A-Za-z]+/, '') || (seat.row ?? '');
    const unit = this.tableLocalityIds().has(seat.localityId) ? 'Mesa' : 'Fila';
    const where = seat.row ? `${unit} ${rowNum} · Asiento ${seatNum}` : seat.label;
    const label = `${seat.section ? seat.section + ' · ' : ''}${where}`;
    if (owned) return `${label} · Tuyo`;
    if (sold) return `${label} · Vendido`;
    if (reserved) return `${label} · Reservado`;
    const price = this.priceByLocality()[seat.localityId];
    return price ? `${label} · Q${price}` : label;
  }

  private setCursor(value: string): void {
    if (this.stage) this.stage.container().style.cursor = value;
  }
}

import {
  Component,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type Konva from 'konva';
import { PromoterEventsApi, SeatView, BulkSeatInput } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { collides, snapToGrid, SEAT_GRID } from './seat-collision';
import { buildTemplate, SEAT_TEMPLATES, type SeatTemplateId } from './seat-templates';
import {
  SEAT_GENERATORS,
  generateGrid,
  generateCurve,
  generateTables,
  generateLine,
  seatsAlongLine,
  type GeneratorId,
} from './seat-generators';

const PAD = 30;

/** Asiento del borrador editable (aún sin persistir). */
interface DraftSeat {
  label: string;
  section?: string;
  row?: string;
  x: number;
  y: number;
}

type EditMode = 'move' | 'add' | 'delete' | 'line';

/**
 * Editor de mapa de asientos (promotor): trabaja sobre un BORRADOR local editable
 * y lo persiste (bulk) al guardar. Ofrece (a) el generador de cuadrícula (filas ×
 * asientos), (b) herramientas de canvas DEBAJO del generador — mover (arrastrar con
 * snap), agregar (click), eliminar (click) y **Línea (click-arrastrar-soltar)** que
 * dibuja una fila de asientos siguiendo el trazo (los que caen encima de otro NO se
 * colocan; los demás sí), y (c) un menú general "Generar" (cuadrícula/mesas/curva/
 * línea + presets SVG) con BUSCADOR que se cierra al hacer click afuera. Un VISOR
 * prominente muestra el conteo. Render con Konva (browser-only). Bloqueado si `readonly`.
 */
@Component({
  selector: 'app-seat-editor',
  imports: [FormsModule, IconComponent, ConfirmDialogComponent],
  templateUrl: './seat-editor.component.html',
})
export class SeatEditorComponent {
  private readonly api = inject(PromoterEventsApi);
  private readonly toasts = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly elRef = inject(ElementRef<HTMLElement>);

  readonly localityId = input.required<string>();
  readonly readonly = input(false);
  /** Notifica al padre cuando cambió el aforo (para refrescar la localidad). */
  readonly changed = output<number>();

  /** Plantillas (presets SVG) con su icono ya saneado (contenido estático y seguro). */
  protected readonly templates: { id: SeatTemplateId; name: string; hint: string; safeIcon: SafeHtml }[] =
    SEAT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, hint: t.hint, safeIcon: this.sanitizer.bypassSecurityTrustHtml(t.icon) }));

  /** Generadores paramétricos del menú "Generar". */
  protected readonly generators = SEAT_GENERATORS;

  /** Asientos ya persistidos en el servidor (para saber qué borrar al guardar). */
  private readonly persisted = signal<SeatView[]>([]);
  /** Borrador editable en el canvas. */
  protected readonly draft = signal<DraftSeat[]>([]);
  protected readonly rows = signal(5);
  protected readonly cols = signal(10);
  protected readonly section = signal('');
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly mode = signal<EditMode>('move');
  protected readonly showGenerator = signal(false);
  protected readonly generatorSearch = signal('');
  /** Asientos por mesa (parámetro del generador "Mesas"). */
  protected readonly perTable = signal(8);

  /** Generadores filtrados por el buscador del menú. */
  protected readonly filteredGenerators = computed(() => {
    const q = this.generatorSearch().trim().toLowerCase();
    if (!q) return this.generators;
    return this.generators.filter((g) => `${g.name} ${g.hint}`.toLowerCase().includes(q));
  });
  /** Presets SVG filtrados por el buscador del menú. */
  protected readonly filteredTemplates = computed(() => {
    const q = this.generatorSearch().trim().toLowerCase();
    if (!q) return this.templates;
    return this.templates.filter((t) => `${t.name} ${t.hint}`.toLowerCase().includes(q));
  });

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  /** Estado del trazo de la herramienta "Línea". */
  private lineStart: { x: number; y: number } | null = null;
  private previewLine: Konva.Line | null = null;

  constructor() {
    effect(() => {
      const id = this.localityId();
      this.load(id);
    });
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.draw();
    });
    effect(() => {
      this.draft();
      this.mode();
      if (this.stage) this.draw();
    });
  }

  /** Cierra el menú "Generar" al hacer click fuera de su contenedor. */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(ev: Event): void {
    if (!this.showGenerator()) return;
    const wrap = this.elRef.nativeElement.querySelector('[data-testid="gen-wrap"]');
    if (wrap && !wrap.contains(ev.target as Node)) this.showGenerator.set(false);
  }

  private load(id: string): void {
    this.api.seats(id).subscribe({
      next: (s) => {
        this.persisted.set(s);
        this.draft.set(
          s
            .filter((seat) => seat.x != null && seat.y != null)
            .map((seat) => ({
              label: seat.label,
              section: seat.section ?? undefined,
              row: seat.row ?? undefined,
              x: seat.x as number,
              y: seat.y as number,
            })),
        );
        this.dirty.set(false);
      },
      error: () => {
        this.persisted.set([]);
        this.draft.set([]);
      },
    });
  }

  protected readonly seatCount = () => this.draft().length;

  // --- Modos / herramientas ---
  protected setMode(m: EditMode): void {
    if (this.readonly()) return;
    this.mode.set(m);
  }

  protected toggleGenerator(): void {
    this.showGenerator.update((v) => !v);
  }

  // --- Generación por cuadrícula (botón directo del formulario) ---
  protected generate(): void {
    if (this.readonly()) return;
    this.applyGenerator('grid');
  }

  /** Aplica un generador paramétrico usando los campos del formulario. */
  protected applyGenerator(id: GeneratorId): void {
    if (this.readonly()) return;
    let seats: BulkSeatInput[];
    let msg: string;
    switch (id) {
      case 'grid':
        seats = generateGrid(this.rows(), this.cols(), this.section());
        msg = 'Cuadrícula generada.';
        break;
      case 'curve':
        seats = generateCurve(this.rows(), this.cols(), this.section());
        msg = 'Curva generada.';
        break;
      case 'tables':
        seats = generateTables(this.rows(), this.perTable(), this.section());
        msg = `Mesas generadas (${this.perTable()} asientos por mesa).`;
        break;
      case 'line':
        seats = generateLine(this.cols(), this.section());
        msg = 'Línea generada.';
        break;
      default:
        return;
    }
    this.draft.set(seats.map((s) => ({ label: s.label, section: s.section, row: s.row, x: s.x as number, y: s.y as number })));
    this.dirty.set(true);
    this.showGenerator.set(false);
    this.toasts.info(`${msg} Ajusta y guarda la disposición.`);
  }

  // --- Plantillas (presets SVG) ---
  protected applyTemplate(id: SeatTemplateId): void {
    if (this.readonly()) return;
    const seats = buildTemplate(id, this.section());
    this.draft.set(seats.map((s) => ({ label: s.label, section: s.section, row: s.row, x: s.x as number, y: s.y as number })));
    this.dirty.set(true);
    this.showGenerator.set(false);
    this.toasts.info('Plantilla aplicada. Puedes editarla y luego guardar.');
  }

  /** Etiqueta única para un asiento nuevo agregado a mano. */
  private nextLabel(used: Set<string>, from: number): { label: string; n: number } {
    let n = from;
    let label = `L-${n}`;
    while (used.has(label)) label = `L-${++n}`;
    used.add(label);
    return { label, n };
  }

  // --- Persistencia (bulk) ---
  protected save(): void {
    if (this.readonly() || this.saving()) return;
    this.saving.set(true);
    const localityId = this.localityId();
    const draft = this.draft();
    const bulk: BulkSeatInput[] = draft.map((s) => ({
      label: s.label,
      section: s.section,
      row: s.row,
      x: s.x,
      y: s.y,
    }));
    const existingIds = this.persisted().map((s) => s.id);

    const doBulk = () => {
      if (bulk.length === 0) {
        this.saving.set(false);
        this.dirty.set(false);
        this.changed.emit(0);
        this.toasts.info('Disposición vaciada.');
        this.load(localityId);
        return;
      }
      this.api.bulkSeats(localityId, bulk).subscribe({
        next: (res) => {
          this.saving.set(false);
          this.dirty.set(false);
          this.toasts.success(`Disposición guardada (${res.capacity} asiento(s)).`);
          this.changed.emit(res.capacity);
          this.load(localityId);
        },
        error: () => {
          this.saving.set(false);
          this.toasts.error('No se pudo guardar la disposición.');
        },
      });
    };

    if (existingIds.length > 0) {
      this.api.deleteSeats(localityId, existingIds).subscribe({ next: doBulk, error: doBulk });
    } else {
      doBulk();
    }
  }

  // --- Confirmación de acciones destructivas ---
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }

  protected askClearAll(): void {
    if (this.readonly() || this.draft().length === 0) return;
    this.confirm.set({
      title: 'Vaciar el mapa de asientos',
      message: `¿Seguro que deseas eliminar los ${this.draft().length} asiento(s) de esta localidad? Deberás guardar para confirmar.`,
      confirmLabel: 'Vaciar',
      onConfirm: () => {
        this.draft.set([]);
        this.dirty.set(true);
      },
    });
  }

  // ---- Render Konva (solo navegador) --------------------------------------

  private extents(): { width: number; height: number } {
    const pts = this.draft();
    if (pts.length === 0) return { width: 420, height: 200 };
    const maxX = Math.max(...pts.map((s) => s.x));
    const maxY = Math.max(...pts.map((s) => s.y));
    return { width: Math.max(420, maxX + PAD * 2), height: Math.max(200, maxY + PAD * 2) };
  }

  private draw(): void {
    const el = this.host()?.nativeElement;
    if (!this.konva || !el) return;
    const K = this.konva;
    const { width, height } = this.extents();
    if (!this.stage) {
      this.stage = new K.Stage({ container: el, width, height });
      this.layer = new K.Layer();
      this.stage.add(this.layer);
      this.stage.on('click tap', (e) => {
        if (this.mode() === 'add' && e.target === this.stage) this.onCanvasAdd();
      });
      this.bindLineDrag();
    } else {
      this.stage.size({ width, height });
      this.layer?.destroyChildren();
      this.previewLine = null;
    }
    if (!this.layer) return;
    const editable = !this.readonly();
    const draggable = editable && this.mode() === 'move';
    this.draft().forEach((seat, index) => {
      const g = new K.Group({ x: seat.x, y: seat.y, draggable });
      g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: '#7b5cff' }));
      g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: '#7b5cff' }));
      if (editable) {
        g.on('mouseenter', () => this.setCursor(this.mode() === 'delete' ? 'not-allowed' : 'pointer'));
        g.on('mouseleave', () => this.setCursor('default'));
        g.on('click tap', (e) => {
          if (this.mode() === 'delete') {
            e.cancelBubble = true;
            this.onSeatDelete(index);
          }
        });
        if (draggable) g.on('dragend', () => this.onSeatDragEnd(index, g));
      }
      this.layer?.add(g);
    });
    this.layer.draw();
  }

  /** Herramienta "Línea": click-arrastrar-soltar dibuja una fila de asientos. */
  private bindLineDrag(): void {
    if (!this.stage) return;
    this.stage.on('mousedown touchstart', () => {
      if (this.readonly() || this.mode() !== 'line') return;
      const pos = this.stage?.getPointerPosition();
      if (pos) this.lineStart = { x: pos.x, y: pos.y };
    });
    this.stage.on('mousemove touchmove', () => {
      if (this.mode() !== 'line' || !this.lineStart || !this.layer || !this.konva) return;
      const pos = this.stage?.getPointerPosition();
      if (!pos) return;
      if (!this.previewLine) {
        this.previewLine = new this.konva.Line({ stroke: '#7b5cff', strokeWidth: 2, dash: [6, 4], listening: false });
        this.layer.add(this.previewLine);
      }
      this.previewLine.points([this.lineStart.x, this.lineStart.y, pos.x, pos.y]);
      this.layer.batchDraw();
    });
    this.stage.on('mouseup touchend', () => {
      if (this.mode() !== 'line' || !this.lineStart) return;
      const pos = this.stage?.getPointerPosition() ?? this.lineStart;
      this.onLineDraw(this.lineStart, { x: pos.x, y: pos.y });
      this.lineStart = null;
      this.previewLine?.destroy();
      this.previewLine = null;
    });
  }

  /** Coloca los asientos del trazo (los que colisionan se omiten uno a uno). */
  private onLineDraw(from: { x: number; y: number }, to: { x: number; y: number }): void {
    if (this.readonly()) return;
    const placed = seatsAlongLine(from, to, this.draft());
    if (placed.length === 0) {
      this.toasts.warning('No se colocó ningún asiento: el trazo choca con otros.');
      return;
    }
    const used = new Set(this.draft().map((s) => s.label));
    let n = this.draft().length;
    const newSeats: DraftSeat[] = placed.map((p) => {
      const { label, n: nn } = this.nextLabel(used, n + 1);
      n = nn;
      return { label, section: this.section() || undefined, x: p.x, y: p.y };
    });
    this.draft.update((list) => [...list, ...newSeats]);
    this.dirty.set(true);
  }

  /** Agrega un asiento en la posición del cursor (snap a cuadrícula, sin solaparse). */
  private onCanvasAdd(): void {
    const pos = this.stage?.getPointerPosition();
    if (!pos) return;
    const x = snapToGrid(pos.x);
    const y = snapToGrid(pos.y);
    if (collides(this.draft(), x, y)) {
      this.toasts.warning('Ahí ya hay un asiento; elige otro lugar.');
      return;
    }
    const used = new Set(this.draft().map((s) => s.label));
    const { label } = this.nextLabel(used, this.draft().length + 1);
    this.draft.update((list) => [...list, { label, section: this.section() || undefined, x, y }]);
    this.dirty.set(true);
  }

  private onSeatDelete(index: number): void {
    this.draft.update((list) => list.filter((_, i) => i !== index));
    this.dirty.set(true);
  }

  /** Al soltar un asiento: snap y rechaza (revierte) si colisiona con otro. */
  private onSeatDragEnd(index: number, group: Konva.Group): void {
    const x = snapToGrid(group.x());
    const y = snapToGrid(group.y());
    if (collides(this.draft(), x, y, { skipIndex: index })) {
      this.toasts.warning('No se puede soltar encima de otro asiento.');
      this.draw(); // revierte a la posición del modelo
      return;
    }
    this.draft.update((list) => list.map((s, i) => (i === index ? { ...s, x, y } : s)));
    this.dirty.set(true);
  }

  private setCursor(value: string): void {
    if (this.stage) this.stage.container().style.cursor = value;
  }

  protected readonly gridSize = SEAT_GRID;
}

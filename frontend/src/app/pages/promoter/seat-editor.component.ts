import {
  Component,
  ElementRef,
  afterNextRender,
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
import { buildGrid } from './seat-grid';
import { collides, snapToGrid, SEAT_GRID } from './seat-collision';
import { buildTemplate, SEAT_TEMPLATES, type SeatTemplateId } from './seat-templates';

const PAD = 30;

/** Asiento del borrador editable (aún sin persistir). */
interface DraftSeat {
  label: string;
  section?: string;
  row?: string;
  x: number;
  y: number;
}

type EditMode = 'move' | 'add' | 'delete';

/**
 * Editor de mapa de asientos (promotor): trabaja sobre un BORRADOR local editable
 * y lo persiste (bulk) al guardar. Ofrece (a) generar por filas×asientos, (b)
 * aplicar una PLANTILLA (Teatro/Estadio/Mesas/Filas) desde el desplegable "Agregar
 * plantilla", y (c) controles de canvas: mover (arrastrar con snap a cuadrícula),
 * agregar (click en vacío) y eliminar (click en asiento), SIEMPRE evitando
 * solapamientos (colisión). Render con Konva (browser-only). Bloqueado si `readonly`.
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

  readonly localityId = input.required<string>();
  readonly readonly = input(false);
  /** Notifica al padre cuando cambió el aforo (para refrescar la localidad). */
  readonly changed = output<number>();

  /** Plantillas con su icono SVG ya saneado (contenido estático y seguro). */
  protected readonly templates: { id: SeatTemplateId; name: string; hint: string; safeIcon: SafeHtml }[] =
    SEAT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, hint: t.hint, safeIcon: this.sanitizer.bypassSecurityTrustHtml(t.icon) }));

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
  protected readonly showTemplates = signal(false);

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;

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

  protected toggleTemplates(): void {
    this.showTemplates.update((v) => !v);
  }

  // --- Generación por cuadrícula ---
  protected generate(): void {
    if (this.readonly()) return;
    const grid = buildGrid({ rows: this.rows(), cols: this.cols(), section: this.section() });
    this.draft.set(grid.map((g) => ({ label: g.label, section: g.section, row: g.row, x: g.x as number, y: g.y as number })));
    this.dirty.set(true);
    this.toasts.info('Cuadrícula generada. Ajusta y guarda la disposición.');
  }

  // --- Plantillas ---
  protected applyTemplate(id: SeatTemplateId): void {
    if (this.readonly()) return;
    const seats = buildTemplate(id, this.section());
    this.draft.set(seats.map((s) => ({ label: s.label, section: s.section, row: s.row, x: s.x as number, y: s.y as number })));
    this.dirty.set(true);
    this.showTemplates.set(false);
    this.toasts.info('Plantilla aplicada. Puedes editarla y luego guardar.');
  }

  /** Etiqueta única para un asiento nuevo agregado a mano. */
  private nextLabel(): string {
    const used = new Set(this.draft().map((s) => s.label));
    let n = this.draft().length + 1;
    let label = `L-${n}`;
    while (used.has(label)) label = `L-${++n}`;
    return label;
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
    } else {
      this.stage.size({ width, height });
      this.layer?.destroyChildren();
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
    this.draft.update((list) => [
      ...list,
      { label: this.nextLabel(), section: this.section() || undefined, x, y },
    ]);
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

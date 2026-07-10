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
import type Konva from 'konva';
import { PromoterEventsApi, SeatView } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { buildGrid } from './seat-grid';

const PAD = 30;

/**
 * Editor de mapa de asientos (promotor): genera una cuadrícula de filas/asientos
 * con posición x/y para una localidad `seated` y la guarda vía los endpoints de
 * venues (bulk). Previsualiza con Konva (browser-only, import dinámico como el
 * mapa del comprador). La generación de la cuadrícula es una función PURA testeada
 * (seat-grid.spec); esta capa es la UI/render. Bloqueado si `readonly` (publicado).
 */
@Component({
  selector: 'app-seat-editor',
  imports: [FormsModule, IconComponent, ConfirmDialogComponent],
  templateUrl: './seat-editor.component.html',
})
export class SeatEditorComponent {
  private readonly api = inject(PromoterEventsApi);
  private readonly toasts = inject(ToastService);

  readonly localityId = input.required<string>();
  readonly readonly = input(false);
  /** Notifica al padre cuando cambió el aforo (para refrescar la localidad). */
  readonly changed = output<number>();

  protected readonly seats = signal<SeatView[]>([]);
  protected readonly rows = signal(5);
  protected readonly cols = signal(10);
  protected readonly section = signal('');
  protected readonly saving = signal(false);

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
      this.seats();
      if (this.stage) this.draw();
    });
  }

  private load(id: string): void {
    this.api.seats(id).subscribe({
      next: (s) => this.seats.set(s),
      error: () => this.seats.set([]),
    });
  }

  protected readonly seatCount = () => this.seats().length;

  protected generate(): void {
    if (this.readonly()) return;
    const grid = buildGrid({ rows: this.rows(), cols: this.cols(), section: this.section() });
    this.saving.set(true);
    this.api.bulkSeats(this.localityId(), grid).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toasts.success(`Se crearon ${res.created} asientos (aforo ${res.capacity}).`);
        this.changed.emit(res.capacity);
        this.load(this.localityId());
      },
      error: () => {
        this.saving.set(false);
        this.toasts.error('No se pudieron generar los asientos.');
      },
    });
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
    if (this.readonly() || this.seats().length === 0) return;
    this.confirm.set({
      title: 'Vaciar el mapa de asientos',
      message: `¿Seguro que deseas eliminar los ${this.seats().length} asiento(s) de esta localidad? Esta acción no se puede deshacer.`,
      confirmLabel: 'Vaciar',
      onConfirm: () => this.clearAll(),
    });
  }

  protected clearAll(): void {
    if (this.readonly()) return;
    const ids = this.seats().map((s) => s.id);
    if (ids.length === 0) return;
    this.saving.set(true);
    this.api.deleteSeats(this.localityId(), ids).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toasts.info('Asientos eliminados.');
        this.changed.emit(res.capacity);
        this.load(this.localityId());
      },
      error: () => {
        this.saving.set(false);
        this.toasts.error('No se pudieron eliminar los asientos.');
      },
    });
  }

  // ---- Render Konva (solo navegador) --------------------------------------

  private extents(): { width: number; height: number } {
    const pts = this.seats().filter((s) => s.x != null && s.y != null);
    if (pts.length === 0) return { width: 320, height: 120 };
    const maxX = Math.max(...pts.map((s) => s.x as number));
    const maxY = Math.max(...pts.map((s) => s.y as number));
    return { width: maxX + PAD, height: maxY + PAD };
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
    } else {
      this.stage.size({ width, height });
      this.layer?.destroyChildren();
    }
    if (!this.layer) return;
    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      const g = new K.Group({ x: seat.x, y: seat.y });
      g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: '#7b5cff' }));
      g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: '#7b5cff' }));
      this.layer.add(g);
    }
    this.layer.draw();
  }
}

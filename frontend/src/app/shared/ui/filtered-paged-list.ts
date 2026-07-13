import { Signal, computed, signal } from '@angular/core';

/** Entidad con estado de publicación (salón/plantilla) para el filtro por estado. */
export interface StatefulEntity {
  status: string;
  hidden?: boolean;
  disabled?: boolean;
}

/**
 * Estado REUTILIZABLE de una lista con buscador + filtro por estado + paginación
 * (homologación DRY). Encapsula el patrón idéntico de `halls-list` y
 * `templates-list`: señales de búsqueda/estado/página, los derivados
 * `filtered`/`totalPages`/`pageItems`/`hasFilter` y los setters que resetean a la
 * página 1. El componente instancia esto con el tamaño de página y un `matches`
 * (qué campos de texto busca) y le nutre `items`. NO cambia comportamiento: es la
 * misma lógica que vivía duplicada en ambos componentes.
 */
export class FilteredPagedList<T extends StatefulEntity> {
  /** Estados disponibles para el filtro (value interno → label en UI vía StatusLabelPipe). */
  readonly statusOptions = ['published', 'draft', 'hidden', 'disabled'];

  readonly items = signal<T[]>([]);
  readonly search = signal('');
  readonly statusFilter = signal('');
  readonly page = signal(1);

  readonly filtered: Signal<T[]>;
  readonly totalPages: Signal<number>;
  readonly pageItems: Signal<T[]>;
  /** True cuando hay filtro/búsqueda activo (distingue vacío-total de sin-resultados). */
  readonly hasFilter: Signal<boolean>;

  constructor(
    private readonly pageSize: number,
    /** Coincidencia de búsqueda por texto (el filtro por estado se aplica aparte). */
    private readonly matches: (item: T, query: string) => boolean,
  ) {
    this.filtered = computed(() => {
      const q = this.search().trim().toLowerCase();
      const st = this.statusFilter();
      return this.items().filter((it) => {
        if (st && this.displayState(it) !== st) return false;
        if (!q) return true;
        return this.matches(it, q);
      });
    });
    this.totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
    this.pageItems = computed(() => {
      const start = (this.page() - 1) * this.pageSize;
      return this.filtered().slice(start, start + this.pageSize);
    });
    this.hasFilter = computed(
      () => this.search().trim().length > 0 || this.statusFilter() !== '',
    );
  }

  /** Estado de display (prioridad: disabled > hidden > status). */
  displayState(e: T): string {
    if (e.disabled) return 'disabled';
    if (e.hidden) return 'hidden';
    return e.status;
  }

  goToPage(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.totalPages()));
  }
  setSearch(v: string): void {
    this.search.set(v);
    this.page.set(1);
  }
  setStatus(v: string): void {
    this.statusFilter.set(v);
    this.page.set(1);
  }
}

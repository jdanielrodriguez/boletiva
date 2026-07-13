import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import {
  type HasUnsavedChanges,
  promptDiscardChanges,
} from '../../core/guards/unsaved-changes.guard';
import type { SeatTemplateResponseDto } from '../../core/api/types';

/** Borrador editable de una plantilla de asientos. */
interface TemplateDraft {
  id: string | null;
  name: string;
  kind: string;
  paramsJson: string;
}

/**
 * Página de alta/edición de una PLANTILLA de asientos (v3.8 · G2). MISMA página en
 * dos modos: `nuevo` (formulario en blanco) y edición (con id → carga la plantilla).
 * Las built-in del sistema NO son editables (se bloquea el formulario). Al guardar
 * con éxito vuelve a la lista de plantillas.
 */
@Component({
  selector: 'app-template-edit-page',
  imports: [FormsModule, TranslatePipe, IconComponent, BackLinkComponent, ConfirmDialogComponent],
  templateUrl: './template-edit.page.html',
})
export class TemplateEditPage implements HasUnsavedChanges {
  private readonly templatesApi = inject(SeatTemplatesApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly templateId = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.templateId == null;

  protected readonly templateKinds = ['rows', 'theater', 'stadium', 'tables', 'grid', 'curve', 'line', 'custom'];

  protected readonly draft = signal<TemplateDraft | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  /** Si la plantilla cargada es del sistema, el formulario queda en solo-lectura. */
  protected readonly builtIn = signal(false);

  // --- Guard de cambios sin guardar ---
  private readonly savedSnapshot = signal('');
  private skipGuard = false;
  protected readonly confirm = signal<ConfirmRequest | null>(null);

  protected readonly heading = computed(() =>
    this.isNew ? 'config.templates.newPageTitle' : 'config.templates.editPageTitle',
  );

  constructor() {
    if (this.templateId) {
      this.loadTemplate(this.templateId);
    } else {
      this.draft.set({ id: null, name: '', kind: 'grid', paramsJson: '{"rows":5,"cols":10}' });
      this.savedSnapshot.set(JSON.stringify(this.draft()));
    }
  }

  hasUnsavedChanges(): boolean {
    return !this.skipGuard && !this.builtIn() && JSON.stringify(this.draft()) !== this.savedSnapshot();
  }
  confirmDiscard(): Observable<boolean> {
    return promptDiscardChanges(
      (req) => this.confirm.set(req),
      (k) => this.translate.instant(k),
    );
  }
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onCancel?.();
  }

  private loadTemplate(id: string): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.templatesApi.get(id).subscribe({
      next: (t: SeatTemplateResponseDto) => {
        this.loading.set(false);
        this.builtIn.set(!!t.isBuiltIn);
        this.draft.set({
          id: t.id,
          name: t.name,
          kind: t.kind,
          paramsJson: t.params ? JSON.stringify(t.params) : '',
        });
        this.savedSnapshot.set(JSON.stringify(this.draft()));
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
        this.toasts.error(this.translate.instant('config.templates.loadError'));
      },
    });
  }

  protected patch<K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, [key]: value });
  }

  protected save(): void {
    if (this.builtIn()) {
      this.toasts.warning(this.translate.instant('config.templates.builtInEditWarn'));
      return;
    }
    const d = this.draft();
    if (!d || d.name.trim().length < 2) {
      this.toasts.warning(this.translate.instant('config.templates.nameRequired'));
      return;
    }
    let params: Record<string, unknown> | undefined;
    if (d.paramsJson.trim()) {
      try {
        params = JSON.parse(d.paramsJson) as Record<string, unknown>;
      } catch {
        this.toasts.warning(this.translate.instant('config.templates.paramsJsonInvalid'));
        return;
      }
    }
    const body = { name: d.name.trim(), kind: d.kind as never, params };
    this.saving.set(true);
    const req = d.id ? this.templatesApi.update(d.id, body) : this.templatesApi.create(body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.skipGuard = true;
        this.toasts.success(this.translate.instant(d.id ? 'config.templates.updated' : 'config.templates.created'));
        void this.router.navigate(['/configuracion'], { queryParams: { tab: 'plantillas' } });
      },
      error: (err: { status?: number }) => {
        this.saving.set(false);
        this.toasts.error(
          this.translate.instant(
            err?.status === 409 ? 'config.templates.builtInSaveError' : 'config.templates.saveError',
          ),
        );
      },
    });
  }

  protected cancel(): void {
    this.skipGuard = true;
    void this.router.navigate(['/configuracion'], { queryParams: { tab: 'plantillas' } });
  }
}

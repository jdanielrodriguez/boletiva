import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Banner superior PERSISTENTE de impersonación de soporte (v3.8 · G2). Mientras el
 * token traiga `impersonatedBy`, se muestra una franja inequívoca "Estás viendo
 * como <promotor>" con un botón "Salir de la vista" que restaura la sesión admin.
 * Diseño llamativo (fondo de acento, alto contraste) para que NUNCA se confunda con
 * la sesión real del admin.
 */
@Component({
  selector: 'app-impersonation-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, IconComponent],
  template: `
    @if (impersonation.active()) {
      <div class="imp-banner" role="alert" data-testid="impersonation-banner">
        <span class="imp-eye" aria-hidden="true"><app-icon name="view" [size]="18" /></span>
        <span class="imp-text">{{ 'shell.impersonation.viewingAs' | translate: { name: name() } }}</span>
        <button type="button" class="imp-exit" [disabled]="leaving()" (click)="exit()" data-testid="impersonation-exit">
          <app-icon name="cancel" [size]="16" /> {{ 'shell.impersonation.exit' | translate }}
        </button>
      </div>
    }
  `,
  styles: [
    `
      .imp-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 0.6rem 0.9rem;
        padding: 0.55rem 1rem;
        background: var(--pe-accent, #e14eca);
        color: var(--pe-on-accent, #fff); /* AA en ambos temas (QA contraste) */
        font-weight: 700;
        font-size: 0.95rem;
        text-align: center;
      }
      .imp-eye {
        display: inline-flex;
        align-items: center;
      }
      .imp-text {
        flex: 0 1 auto;
      }
      .imp-exit {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border: 1.5px solid rgba(255, 255, 255, 0.85);
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
        font-weight: 700;
        border-radius: 999px;
        padding: 0.3rem 0.85rem;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .imp-exit:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.28);
      }
      .imp-exit:disabled {
        opacity: 0.6;
        cursor: default;
      }
    `,
  ],
})
export class ImpersonationBannerComponent {
  protected readonly impersonation = inject(ImpersonationService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly leaving = signal(false);

  /** Nombre visible del promotor impersonado (o su correo como respaldo). */
  protected readonly name = computed(() => {
    const u = this.impersonation.asUser();
    if (!u) return '';
    const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return full || u.email;
  });

  protected exit(): void {
    this.leaving.set(true);
    this.impersonation.stop().subscribe({
      next: () => {
        this.leaving.set(false);
        this.toasts.info(this.translate.instant('shell.impersonation.exited'));
        void this.router.navigateByUrl('/configuracion?tab=promotores');
      },
      error: () => {
        this.leaving.set(false);
        this.toasts.error(this.translate.instant('shell.impersonation.exitError'));
      },
    });
  }
}

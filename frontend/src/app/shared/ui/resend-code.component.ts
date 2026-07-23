import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Control ESTANDARIZADO de reenvío de código (F2). Encapsula el botón "Reenviar",
 * el cronómetro de cooldown (con barra de progreso que se vacía) y una línea de
 * estado accesible (role=status). Es la pieza que estaba inconsistente entre los
 * flujos de verificación: el login la tenía completa, el modal de compra-invitado
 * NO tenía reenvío, y el modal de verificación de correo reenviaba sin contador.
 *
 * El padre hace la llamada real (emite `resend`) y, según el resultado, arranca el
 * cooldown con `startCooldown()` (éxito o 429) o lo limpia con `reset()`. El OTP en
 * sí sigue siendo `app-otp-input` (ya compartido); esto solo estandariza el reenvío.
 *
 * Acepta contenido proyectado (`<ng-content>`) para acciones extra en la misma fila
 * (p.ej. "usar otra cuenta" en login o "cerrar sesión" en la verificación de correo).
 */
@Component({
  selector: 'app-resend-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, IconComponent],
  template: `
    @if (info() || cooldown() > 0) {
      <div class="resend-status" [class.resend-status--info]="info()" role="status" [attr.data-testid]="testId() + '-info'">
        @if (info(); as i) {
          <span class="resend-status-head"><app-icon name="refresh" [size]="16" /> {{ i }}</span>
        }
        @if (cooldown() > 0) {
          <div
            class="resend-progress"
            [attr.data-testid]="testId() + '-countdown'"
            [attr.aria-label]="'auth.resendCountdown' | translate: { s: cooldown() }"
          >
            <span class="resend-progress-bar" [style.width.%]="pct()"></span>
          </div>
        }
      </div>
    }
    <div class="twofa-actions">
      <button
        type="button"
        class="btn small twofa-btn"
        [disabled]="resending() || cooldown() > 0"
        (click)="onClick()"
        [attr.data-testid]="testId()"
      >
        <app-icon name="refresh" [size]="15" />
        @if (cooldown() > 0) {
          {{ 'auth.resendIn' | translate: { s: cooldown() } }}
        } @else if (resending()) {
          {{ resendingLabel() | translate }}
        } @else {
          {{ label() | translate }}
        }
      </button>
      <ng-content />
    </div>
  `,
})
export class ResendCodeComponent implements OnDestroy {
  /** ¿La petición de reenvío está en curso? (el padre lo controla). */
  readonly resending = input(false);
  /** Clave i18n del texto del botón en reposo. */
  readonly label = input('auth.resendCode');
  /** Clave i18n del texto del botón mientras reenvía. */
  readonly resendingLabel = input('auth.resendCode');
  /** Segundos por defecto del cooldown al llamar `startCooldown()` sin argumento. */
  readonly cooldownSeconds = input(60);
  /** Línea de estado (confirmación de reenvío o mensaje de límite). */
  readonly info = input<string | null>(null);
  /** Prefijo del `data-testid` (permite botones distintos por flujo). */
  readonly testId = input('resend');
  /** El usuario pidió reenviar (cooldown libre) → el padre hace la llamada. */
  readonly resend = output<void>();

  private readonly _cooldown = signal(0);
  private readonly _total = signal(60);
  /** Segundos restantes del cooldown vigente (0 = habilitado). */
  readonly cooldown = this._cooldown.asReadonly();
  /** % restante → ancho de la barra que se vacía (100→0). */
  readonly pct = computed(() =>
    this._total() > 0 ? Math.round((this._cooldown() / this._total()) * 100) : 0,
  );
  private timer: ReturnType<typeof setInterval> | null = null;

  protected onClick(): void {
    if (this.resending() || this._cooldown() > 0) return;
    this.resend.emit();
  }

  /** Arranca el cronómetro (el padre lo llama tras un reenvío OK o un 429). */
  startCooldown(seconds = this.cooldownSeconds()): void {
    this._total.set(seconds);
    this._cooldown.set(seconds);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const n = this._cooldown() - 1;
      this._cooldown.set(Math.max(0, n));
      if (n <= 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, 1000);
  }

  /** Detiene y limpia el cooldown (p.ej. al volver al paso anterior). */
  reset(): void {
    this._cooldown.set(0);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

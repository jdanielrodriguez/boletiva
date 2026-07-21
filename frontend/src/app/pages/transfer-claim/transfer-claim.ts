import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TransfersApi } from '../../core/api/transfers.api';
import { apiErrorMessage } from '../../core/http/api-error';

/**
 * Reclamar un boleto transferido (regalo): el destinatario verificado ingresa el
 * código que le compartieron. Al canjear se re-emite el boleto a su nombre (el
 * anterior queda inservible) y se le lleva a sus boletos activos.
 */
@Component({
  selector: 'app-transfer-claim',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './transfer-claim.html',
})
export class TransferClaim {
  private readonly transfersApi = inject(TransfersApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  protected readonly code = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly claimedSerial = signal<string | null>(null);

  protected claim(): void {
    const code = this.code().trim();
    if (!code) {
      this.error.set(this.translate.instant('transfer.msgEnterCode'));
      return;
    }
    this.working.set(true);
    this.error.set(null);
    this.transfersApi.claim(code).subscribe({
      next: (res) => {
        this.working.set(false);
        this.claimedSerial.set(res.serial);
      },
      error: (err) => {
        this.working.set(false);
        // Muestra el motivo real del backend (código inválido/canjeado/expirado/propio…).
        this.error.set(apiErrorMessage(err, this.translate.instant('transfer.msgClaimFailed')));
      },
    });
  }

  protected goToTickets(): void {
    void this.router.navigate(['/cuenta'], { queryParams: { s: 'activos' } });
  }
}

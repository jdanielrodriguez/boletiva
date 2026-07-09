import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TransfersApi } from '../../core/api/transfers.api';

/**
 * Reclamar un boleto transferido (regalo): el destinatario verificado ingresa el
 * código que le compartieron. Al canjear se re-emite el boleto a su nombre (el
 * anterior queda inservible) y se le lleva a sus boletos activos.
 */
@Component({
  selector: 'app-transfer-claim',
  imports: [FormsModule],
  templateUrl: './transfer-claim.html',
})
export class TransferClaim {
  private readonly transfersApi = inject(TransfersApi);
  private readonly router = inject(Router);

  protected readonly code = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly claimedSerial = signal<string | null>(null);

  protected claim(): void {
    const code = this.code().trim();
    if (!code) {
      this.error.set('Ingresa el código que te compartieron.');
      return;
    }
    this.working.set(true);
    this.error.set(null);
    this.transfersApi.claim(code).subscribe({
      next: (res) => {
        this.working.set(false);
        this.claimedSerial.set(res.serial);
      },
      error: () => {
        this.working.set(false);
        this.error.set('Código inválido, vencido o ya utilizado.');
      },
    });
  }

  protected goToTickets(): void {
    void this.router.navigate(['/cuenta'], { queryParams: { s: 'activos' } });
  }
}

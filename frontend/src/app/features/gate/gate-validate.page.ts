import {
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GateApi } from '../../core/api/gate.api';
import { GateDb } from '../../core/gate/gate-db';
import { parseQr, verifyTotp } from '../../core/gate/totp';
import { apiErrorMessage } from '../../core/http/api-error';

type Phase = 'loading' | 'welcome' | 'starting' | 'scanning' | 'cameraError' | 'invalid';
type ResultKind = 'ok' | 'used' | 'invalid';

interface ScanResult {
  kind: ResultKind;
  serial?: string;
  message: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * PWA de VALIDACIÓN en puerta (F4, offline-first / SafeTix). El validador abre su
 * magic-link (`/validar/:token`): se canjea por un gate-token, se descarga el
 * manifiesto (boletos + secreto TOTP) a IndexedDB y se valida ESCANEANDO el QR con la
 * cámara — SIN red: se recomputa el TOTP y se compara con el código del QR (un
 * screenshot caduca). Verde/ámbar/rojo hiper-evidente. Los check-ins se guardan en una
 * cola local y se drenan al endpoint de lote (RabbitMQ) cuando hay conexión.
 * La CÁMARA es obligatoria: si no hay o se niega el permiso, se muestra el error y un
 * botón de REINTENTAR hasta que se habilite.
 */
@Component({
  selector: 'app-gate-validate',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './gate-validate.page.html',
})
export class GateValidatePage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(GateApi);
  private readonly db = inject(GateDb);
  private readonly translate = inject(TranslateService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly phase = signal<Phase>('loading');
  protected readonly eventName = signal('');
  protected readonly validatorEmail = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly cameraError = signal<string | null>(null);
  protected readonly result = signal<ScanResult | null>(null);
  protected readonly ticketCount = signal(0);
  protected readonly pending = signal(0);
  protected readonly online = signal(true);
  protected readonly manualSupported = signal(true); // BarcodeDetector disponible
  protected readonly manualCode = signal('');

  private token = '';
  private eventId = '';
  private gateToken = '';
  private stream?: MediaStream;
  private detector?: BarcodeDetectorLike;
  private scanTimer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!isPlatformBrowser(this.platformId)) return; // SSR: no cámara ni IndexedDB
    this.online.set(navigator.onLine);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.peek();
  }

  // ---- Canje del magic-link ----

  private peek(): void {
    if (!this.token) {
      this.phase.set('invalid');
      return;
    }
    this.api.peek(this.token).subscribe({
      next: (res) => {
        this.eventName.set(res.eventName);
        this.validatorEmail.set(res.email);
        this.phase.set('welcome');
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, this.translate.instant('gate.linkInvalid')));
        this.phase.set('invalid');
      },
    });
  }

  /** Empieza: canjea el token, descarga el manifiesto y arranca la cámara. */
  protected start(): void {
    this.phase.set('starting');
    this.error.set(null);
    this.api.claim(this.token).subscribe({
      next: (res) => {
        this.gateToken = res.gateToken;
        this.eventId = res.gateEventId;
        this.eventName.set(res.event.name);
        this.downloadManifest();
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, this.translate.instant('gate.claimFailed')));
        this.phase.set('invalid');
      },
    });
  }

  private downloadManifest(): void {
    this.api.manifest(this.eventId, this.gateToken).subscribe({
      next: async (m) => {
        await this.db.saveManifest(
          this.eventId,
          m.tickets.map((t) => ({ serial: t.serial, status: t.status, totpSecret: t.totpSecret })),
          { expiresAt: m.expiresAt, gateToken: this.gateToken, eventName: this.eventName() },
        );
        this.ticketCount.set((await this.db.ticketCount()) ?? m.tickets.length);
        this.pending.set((await this.db.queueCount()) ?? 0);
        void this.startCamera();
      },
      error: async (err) => {
        // Sin red pero con manifiesto ya guardado antes → seguimos offline.
        const meta = await this.db.getMeta(this.eventId);
        if (meta) {
          this.ticketCount.set((await this.db.ticketCount()) ?? 0);
          void this.startCamera();
        } else {
          this.error.set(apiErrorMessage(err, this.translate.instant('gate.manifestFailed')));
          this.phase.set('invalid');
        }
      },
    });
  }

  // ---- Cámara (obligatoria: error + reintentar hasta habilitar) ----

  protected async startCamera(): Promise<void> {
    this.cameraError.set(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set(this.translate.instant('gate.cameraUnsupported'));
      this.phase.set('cameraError');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.phase.set('scanning');
      // El <video> aparece en esta fase; espera al próximo tick para adjuntar el stream.
      setTimeout(() => this.attachAndScan(), 0);
    } catch {
      // Permiso denegado, cámara ocupada o inexistente → error + botón reintentar.
      this.cameraError.set(this.translate.instant('gate.cameraDenied'));
      this.phase.set('cameraError');
    }
  }

  /** Botón "Reintentar": vuelve a pedir permiso/cámara. */
  protected retryCamera(): void {
    void this.startCamera();
  }

  private attachAndScan(): void {
    const el = this.video()?.nativeElement;
    if (!el || !this.stream) return;
    el.srcObject = this.stream;
    void el.play().catch(() => undefined);

    const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike })
      .BarcodeDetector;
    if (Detector) {
      this.detector = new Detector({ formats: ['qr_code'] });
      this.manualSupported.set(true);
      this.scanTimer = setInterval(() => void this.tick(el), 350);
    } else {
      // Sin BarcodeDetector (p.ej. Safari): la cámara se ve, pero se valida por
      // entrada MANUAL del contenido del QR (respaldo). Se documenta como follow-up.
      this.manualSupported.set(false);
    }
  }

  private async tick(el: HTMLVideoElement): Promise<void> {
    if (this.busy || !this.detector || el.readyState < 2) return;
    try {
      const codes = await this.detector.detect(el);
      if (codes.length) await this.validate(codes[0].rawValue);
    } catch {
      // frame ilegible; siguiente tick
    }
  }

  // ---- Validación OFFLINE (TOTP contra el manifiesto en IndexedDB) ----

  protected async validateManual(): Promise<void> {
    const v = this.manualCode().trim();
    if (v) {
      this.manualCode.set('');
      await this.validate(v);
    }
  }

  private async validate(payload: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const parsed = parseQr(payload);
      if (!parsed) return this.show({ kind: 'invalid', message: this.translate.instant('gate.resultBadFormat') });
      const ticket = await this.db.getTicket(parsed.serial);
      if (!ticket) {
        return this.show({ kind: 'invalid', serial: parsed.serial, message: this.translate.instant('gate.resultUnknown') });
      }
      if (ticket.status === 'used') {
        return this.show({ kind: 'used', serial: parsed.serial, message: this.translate.instant('gate.resultUsed') });
      }
      if (ticket.status !== 'valid') {
        return this.show({ kind: 'invalid', serial: parsed.serial, message: this.translate.instant('gate.resultRevoked') });
      }
      const okTotp = await verifyTotp(ticket.totpSecret, parsed.code);
      if (!okTotp) {
        return this.show({ kind: 'invalid', serial: parsed.serial, message: this.translate.instant('gate.resultBadCode') });
      }
      // Válido → marca usado LOCAL (evita doble check-in en esta puerta) + encola.
      await this.db.setStatus(parsed.serial, 'used');
      await this.db.enqueue({ serial: parsed.serial, at: new Date().toISOString() });
      this.pending.set((await this.db.queueCount()) ?? 0);
      this.show({ kind: 'ok', serial: parsed.serial, message: this.translate.instant('gate.resultOk') });
      void this.flush();
    } finally {
      // Pequeña pausa para que el operador lea el resultado antes de re-escanear.
      setTimeout(() => (this.busy = false), 1200);
    }
  }

  private show(r: ScanResult): void {
    this.result.set(r);
    setTimeout(() => this.result.set(null), 1800);
  }

  // ---- Ingest por lote (RabbitMQ) al reconectar ----

  private async flush(): Promise<void> {
    if (!this.online() || !this.gateToken) return;
    const queued = await this.db.allQueued();
    if (!queued.length) return;
    this.api
      .batchCheckin(this.eventId, queued.map((q) => ({ serial: q.serial, checkedInAt: q.at })), this.gateToken)
      .subscribe({
        next: async () => {
          // Idempotente en backend → limpiar la cola tras subir es seguro.
          await this.db.clearQueue();
          this.pending.set(0);
        },
        error: () => undefined, // se reintenta en el próximo evento online / check-in
      });
  }

  private readonly onOnline = (): void => {
    this.online.set(true);
    void this.flush();
  };
  private readonly onOffline = (): void => this.online.set(false);

  ngOnDestroy(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }
}

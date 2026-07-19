import {
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GateApi } from '../../core/api/gate.api';
import { GateDb, type QueuedCheckin } from '../../core/gate/gate-db';
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
  // Escaneo AUTOMÁTICO disponible (BarcodeDetector nativo o jsQR). Si es false, la única
  // vía es la entrada MANUAL del contenido del QR (respaldo).
  protected readonly manualSupported = signal(true);
  protected readonly manualCode = signal('');

  private token = '';
  private eventId = '';
  private gateToken = '';
  private stream?: MediaStream;
  private detector?: BarcodeDetectorLike;
  private jsqr?: (data: Uint8ClampedArray, w: number, h: number, opts?: { inversionAttempts?: string }) => { data: string } | null;
  private canvas?: HTMLCanvasElement;
  private scanTimer?: ReturnType<typeof setInterval>;
  private busy = false;
  /** Stream ya adjuntado al <video> (evita re-adjuntar el mismo; permite re-adjuntar tras reintentar). */
  private attachedStream?: MediaStream;
  /** Un solo drenaje de la cola a la vez (evita subir el mismo lote en paralelo). */
  private flushing = false;
  private audioCtx?: AudioContext;
  /** Tamaño de lote al drenar la cola offline (evita payloads gigantes en 3G). */
  private static readonly FLUSH_CHUNK = 200;

  constructor() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!isPlatformBrowser(this.platformId)) return; // SSR: no cámara ni IndexedDB
    this.online.set(navigator.onLine);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    // Adjuntar el stream al <video> de forma RACE-FREE: en zoneless, el <video> (viewChild)
    // se crea en el CD que dispara `phase='scanning'`, que puede ocurrir DESPUÉS de un
    // setTimeout(0). El effect corre cuando el elemento YA existe → adjunta sin carrera.
    effect(() => {
      const el = this.video()?.nativeElement;
      if (this.phase() === 'scanning' && el && this.stream && this.attachedStream !== this.stream) {
        this.attachedStream = this.stream;
        void this.attachAndScan();
      }
    });
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
      // El <video> aparece en esta fase; el `effect` del constructor adjunta el stream en
      // cuanto el elemento existe (race-free en zoneless).
      this.phase.set('scanning');
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

  private async attachAndScan(): Promise<void> {
    const el = this.video()?.nativeElement;
    if (!el || !this.stream) return;
    el.srcObject = this.stream;
    void el.play().catch(() => undefined);

    const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike })
      .BarcodeDetector;
    if (Detector) {
      // Ruta nativa (Chrome/Android): decodifica el frame directamente.
      this.detector = new Detector({ formats: ['qr_code'] });
      this.manualSupported.set(true);
      this.scanTimer = setInterval(() => void this.tick(el), 350);
      return;
    }
    // Sin BarcodeDetector (p.ej. Safari/Firefox) → jsQR sobre un canvas oculto: se sigue
    // escaneando AUTOMÁTICAMENTE con la cámara (import dinámico, solo navegador). La
    // entrada manual queda como respaldo si jsQR tampoco cargara.
    try {
      this.jsqr = (await import('jsqr')).default as typeof this.jsqr;
      this.canvas = document.createElement('canvas');
      this.manualSupported.set(true);
      this.scanTimer = setInterval(() => void this.tickJsqr(el), 350);
    } catch {
      this.manualSupported.set(false);
    }
  }

  /** Escaneo nativo con BarcodeDetector. */
  private async tick(el: HTMLVideoElement): Promise<void> {
    if (this.busy || !this.detector || el.readyState < 2) return;
    try {
      const codes = await this.detector.detect(el);
      if (codes.length) await this.validate(codes[0].rawValue);
    } catch {
      // frame ilegible; siguiente tick
    }
  }

  /** Escaneo con jsQR: dibuja el frame en un canvas y decodifica el QR (Safari/Firefox). */
  private async tickJsqr(el: HTMLVideoElement): Promise<void> {
    if (this.busy || !this.jsqr || !this.canvas || el.readyState < 2) return;
    const w = el.videoWidth;
    const h = el.videoHeight;
    if (!w || !h) return;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    this.canvas.width = w;
    this.canvas.height = h;
    ctx.drawImage(el, 0, 0, w, h);
    try {
      const img = ctx.getImageData(0, 0, w, h);
      const code = this.jsqr(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) await this.validate(code.data);
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
    this.feedback(r.kind); // color + vibración + sonido: el operador NO necesita leer
    setTimeout(() => this.result.set(null), 1800);
  }

  /**
   * Feedback SOBERANO por color (pantalla completa) + vibración + sonido, para validar en
   * puerta sin leer texto: ok = pulso corto/tono agudo; used(ámbar) = doble pulso; rojo =
   * pulso largo/tono grave. Best-effort (si no hay soporte, el color manda).
   */
  private feedback(kind: ResultKind): void {
    try {
      const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
      nav.vibrate?.(kind === 'ok' ? 120 : kind === 'used' ? [90, 60, 90] : 400);
    } catch {
      /* sin soporte de vibración */
    }
    this.beep(kind);
  }

  private beep(kind: ResultKind): void {
    try {
      const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctx = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx ??= new Ctx();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = kind === 'ok' ? 880 : kind === 'used' ? 620 : 200;
      osc.type = kind === 'invalid' ? 'sawtooth' : 'sine';
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      /* audio no disponible */
    }
  }

  // ---- Ingest por lote (RabbitMQ) al reconectar — resiliente / idempotente ----

  /**
   * Drena la cola offline SIN bloquear el escáner: corre async y el escaneo sigue
   * encolando en paralelo (el boleto 501 se valida mientras suben los primeros 500).
   * Sube en LOTES y borra SOLO lo confirmado POR ID (idempotente) → si se encolan nuevos
   * check-ins durante el drenaje NO se pierden. Un fallo (3G intermitente) corta el ciclo
   * y se reintenta en el próximo `online`/check-in. Un solo flush a la vez (`flushing`).
   */
  private async flush(): Promise<void> {
    if (this.flushing || !this.online() || !this.gateToken) return;
    this.flushing = true;
    try {
      for (;;) {
        if (!this.online()) break;
        const batch = (await this.db.allQueued()).slice(0, GateValidatePage.FLUSH_CHUNK);
        if (!batch.length) break;
        const ok = await this.uploadBatch(batch);
        if (!ok) break; // red inestable → se reintenta luego (cero pérdida)
        await this.db.deleteQueued(batch.map((q) => q.id).filter((x): x is number => x != null));
        this.pending.set((await this.db.queueCount()) ?? 0);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Sube un lote; resuelve true si el backend lo aceptó (idempotente), false si falló. */
  private uploadBatch(batch: QueuedCheckin[]): Promise<boolean> {
    return new Promise((resolve) => {
      this.api
        .batchCheckin(
          this.eventId,
          batch.map((q) => ({ serial: q.serial, checkedInAt: q.at })),
          this.gateToken,
        )
        .subscribe({ next: () => resolve(true), error: () => resolve(false) });
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
    void this.audioCtx?.close().catch(() => undefined);
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }
}

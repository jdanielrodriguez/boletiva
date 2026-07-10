import { Injectable, computed, signal } from '@angular/core';

/** Desbloqueo activo de un evento (token + expiración en epoch ms). */
interface Unlock {
  token: string;
  expiresAt: number;
}

/**
 * Estado del desbloqueo de edición para ADMIN no-dueño (v3.5). Guarda el token de
 * desbloqueo por `eventId` (con su expiración de 5 min) de forma que sobreviva a la
 * navegación entre tabs y a entrar/salir del editor de asientos (servicio raíz, una
 * sola instancia). El interceptor adjunta el token como header `x-edit-unlock` en
 * las mutaciones del evento activo; el promotor DUEÑO nunca fija token → nunca se
 * envía y el backend lo ignora igual.
 */
@Injectable({ providedIn: 'root' })
export class EditUnlockStore {
  /** Tokens por evento (persisten entre vistas mientras no expiren). */
  private readonly unlocks = signal<Record<string, Unlock>>({});
  /** Evento cuyo editor está abierto (contexto que usa el interceptor). */
  private readonly currentEventId = signal<string>('');

  /** Fija el evento en edición (lo llaman el editor de evento y el de asientos). */
  setCurrentEvent(eventId: string): void {
    this.currentEventId.set(eventId);
  }
  clearCurrentEvent(): void {
    this.currentEventId.set('');
  }

  /** Registra el token recibido tras verificar el OTP. */
  setUnlock(eventId: string, token: string, expiresAt: string): void {
    const exp = new Date(expiresAt).getTime();
    this.unlocks.update((u) => ({ ...u, [eventId]: { token, expiresAt: exp } }));
  }

  /** Descarta el desbloqueo de un evento (p.ej. al re-bloquear manualmente). */
  clearUnlock(eventId: string): void {
    this.unlocks.update((u) => {
      const next = { ...u };
      delete next[eventId];
      return next;
    });
  }

  /** ¿El evento tiene un desbloqueo vigente (no expirado)? Reactivo con `tick`. */
  isUnlocked(eventId: string): boolean {
    this.tick();
    this.clock();
    const u = this.unlocks()[eventId];
    return !!u && u.expiresAt > Date.now();
  }

  /** Epoch ms de expiración del desbloqueo del evento (o null). */
  expiresAt(eventId: string): number | null {
    const u = this.unlocks()[eventId];
    return u ? u.expiresAt : null;
  }

  /** Token a enviar en el header para el evento activo (o null si no aplica/expiró). */
  readonly headerToken = computed<string | null>(() => {
    this.tick();
    this.clock();
    const id = this.currentEventId();
    if (!id) return null;
    const u = this.unlocks()[id];
    return u && u.expiresAt > Date.now() ? u.token : null;
  });

  /**
   * Señal-reloj que se actualiza sola: permite que `isUnlocked`/`headerToken` se
   * recomputen al expirar el token sin depender de un timer por componente.
   */
  private readonly clock = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick(): void {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => this.clock.set(Date.now()), 1000);
  }
}

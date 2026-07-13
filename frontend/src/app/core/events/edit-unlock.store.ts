import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Desbloqueo activo de un evento (token + expiración en epoch ms). */
interface Unlock {
  token: string;
  expiresAt: number;
}

/** Prefijo de la clave por evento en sessionStorage. */
const STORAGE_PREFIX = 'pe_edit_unlock:';

/**
 * Estado del desbloqueo de edición para ADMIN no-dueño (v3.5). Guarda el token de
 * desbloqueo por `eventId` (con su expiración de 5 min) de forma que sobreviva a la
 * navegación entre tabs y a entrar/salir del editor de asientos (servicio raíz, una
 * sola instancia). El interceptor adjunta el token como header `x-edit-unlock` en
 * las mutaciones del evento activo; el promotor DUEÑO nunca fija token → nunca se
 * envía y el backend lo ignora igual.
 *
 * v3.13 · W4: además persiste en **sessionStorage** (una clave por evento) para
 * sobrevivir a un F5 con el tiempo corriendo, sin sobrevivir al cierre de la
 * pestaña (token de vida corta, aceptable). Al arrancar rehidrata los desbloqueos
 * NO vencidos y descarta los expirados; SSR-safe (solo toca sessionStorage en el
 * navegador).
 */
@Injectable({ providedIn: 'root' })
export class EditUnlockStore {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Tokens por evento (persisten entre vistas mientras no expiren). */
  private readonly unlocks = signal<Record<string, Unlock>>(this.rehydrate());
  /** Evento cuyo editor está abierto (contexto que usa el interceptor). */
  private readonly currentEventId = signal<string>('');

  /** Fija el evento en edición (lo llaman el editor de evento y el de asientos). */
  setCurrentEvent(eventId: string): void {
    this.currentEventId.set(eventId);
  }
  clearCurrentEvent(): void {
    this.currentEventId.set('');
  }

  /** Registra el token recibido tras verificar el OTP (y lo persiste). */
  setUnlock(eventId: string, token: string, expiresAt: string): void {
    const exp = new Date(expiresAt).getTime();
    this.unlocks.update((u) => ({ ...u, [eventId]: { token, expiresAt: exp } }));
    this.persist(eventId, { token, expiresAt: exp });
  }

  /** Descarta el desbloqueo de un evento (p.ej. al re-bloquear manualmente). */
  clearUnlock(eventId: string): void {
    this.unlocks.update((u) => {
      const next = { ...u };
      delete next[eventId];
      return next;
    });
    this.forget(eventId);
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

  /**
   * Milisegundos restantes del desbloqueo del evento (0 si no hay o expiró).
   * REACTIVO: lee el `clock` interno para que los `computed` que lo consuman
   * (p.ej. el temporizador del candado) se recomputen cada segundo.
   */
  remainingMs(eventId: string): number {
    this.tick();
    this.clock();
    const u = this.unlocks()[eventId];
    if (!u) return 0;
    return Math.max(0, u.expiresAt - Date.now());
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

  // --- Persistencia en sessionStorage (SSR-safe) -------------------------------

  private persist(eventId: string, u: Unlock): void {
    if (!this.isBrowser) return;
    try {
      sessionStorage.setItem(STORAGE_PREFIX + eventId, JSON.stringify(u));
    } catch {
      /* almacenamiento no disponible: se sigue con el estado en memoria */
    }
  }

  private forget(eventId: string): void {
    if (!this.isBrowser) return;
    try {
      sessionStorage.removeItem(STORAGE_PREFIX + eventId);
    } catch {
      /* noop */
    }
  }

  /** Lee de sessionStorage los desbloqueos NO vencidos; purga los expirados. */
  private rehydrate(): Record<string, Unlock> {
    if (!this.isBrowser) return {};
    const out: Record<string, Unlock> = {};
    try {
      const now = Date.now();
      // Recolecta las claves ANTES de modificar (removeItem desplaza los índices).
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const eventId = key.slice(STORAGE_PREFIX.length);
        const raw = sessionStorage.getItem(key);
        const u = raw ? (JSON.parse(raw) as Unlock) : null;
        if (u && typeof u.token === 'string' && typeof u.expiresAt === 'number' && u.expiresAt > now) {
          out[eventId] = u;
        } else {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      return out;
    }
    return out;
  }
}

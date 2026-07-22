import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Clave del identificador estable de dispositivo (persiste ENTRE sesiones). */
const DEVICE_ID_KEY = 'pe_device_id';

/**
 * Identidad ESTABLE de este navegador para la confianza de dispositivo del 2FA.
 *
 * Se guarda en `localStorage` (NO en cookie, por preferencia y porque persiste aunque
 * cierres sesión) y se envía como header `X-Device-Id`, que el backend prioriza sobre
 * la cookie/UA. Así, tras pasar el 2FA (o verificar el correo) una vez, un logout+login
 * desde el MISMO navegador reconoce el dispositivo y NO vuelve a pedir el código.
 *
 * NO es un secreto de sesión: conocerlo no da acceso (sigue haciendo falta la
 * contraseña) y el backend avisa por correo de cada dispositivo nuevo. Por eso vivir
 * en localStorage es un riesgo aceptable (a diferencia del refresh token, que va en
 * cookie httpOnly). NUNCA se borra al cerrar sesión: es la memoria del "este navegador".
 *
 * SSR-safe: en el servidor no hay localStorage → devuelve null y no se envía header
 * (el backend cae a su fallback); la identidad real se fija en el navegador.
 */
@Injectable({ providedIn: 'root' })
export class DeviceIdService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private cached: string | null = null;

  /** Id estable del navegador (lo crea la 1ª vez). Null en SSR. */
  get(): string | null {
    if (!this.isBrowser) return null;
    if (this.cached) return this.cached;
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = this.generate();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      this.cached = id;
      return id;
    } catch {
      // localStorage bloqueado (modo privado estricto) → sin id persistente.
      return null;
    }
  }

  private generate(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    // Fallback si randomUUID no está disponible.
    return 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PublicConfigStore } from '../config/public-config.store';

/** API mínima de grecaptcha v3 que usamos (inyectada por el script de Google). */
interface Grecaptcha {
  ready(cb: () => void): void;
  execute(siteKey: string, opts: { action: string }): Promise<string>;
}

/**
 * reCAPTCHA v3 en el cliente. Si hay `recaptchaSiteKey` en la config pública, carga
 * el script de Google (una sola vez) y expone `execute(action)` que devuelve el
 * token a mandar al backend en el header `x-captcha-token`.
 *
 * Filosofía del proyecto: si NO hay site key (dev/test/no configurado), `execute`
 * resuelve `''` → el backend OMITE la verificación y el flujo sigue funcionando.
 * SSR-safe: en el servidor nunca toca el DOM ni `window` y resuelve `''`.
 */
@Injectable({ providedIn: 'root' })
export class RecaptchaService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly config = inject(PublicConfigStore);

  /** Promesa de carga del script (memoizada): se dispara a lo sumo una vez. */
  private scriptLoad?: Promise<void>;

  /**
   * Genera un token para la acción dada. Resuelve `''` (sin bloquear) si no hay
   * site key o no estamos en el navegador. Nunca rechaza: un fallo del captcha
   * degrada a token vacío → el backend decide (omite si no está configurado).
   */
  async execute(action: string): Promise<string> {
    const siteKey = this.config.recaptchaSiteKey();
    if (!siteKey || !isPlatformBrowser(this.platformId)) return '';
    try {
      await this.load(siteKey);
      const grecaptcha = (globalThis as { grecaptcha?: Grecaptcha }).grecaptcha;
      if (!grecaptcha) return '';
      await new Promise<void>((resolve) => grecaptcha.ready(() => resolve()));
      return await grecaptcha.execute(siteKey, { action });
    } catch {
      return '';
    }
  }

  /** Inserta el <script> de reCAPTCHA v3 una sola vez y resuelve al cargar. */
  private load(siteKey: string): Promise<void> {
    if (this.scriptLoad) return this.scriptLoad;
    this.scriptLoad = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar reCAPTCHA'));
      document.head.appendChild(script);
    });
    return this.scriptLoad;
  }
}

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  LOCALE_BY_LANG,
  SUPPORTED_LANGS,
  type Lang,
} from './i18n.types';

/**
 * Fachada de i18n sobre `TranslateService` (ngx-translate). Runtime: cambia de
 * idioma sin recompilar. SSR-safe: el diccionario carga síncrono (loader inline)
 * y el servidor SIEMPRE renderiza el idioma por defecto (`es`) → las páginas
 * públicas siguen siendo cacheables en el edge. En el navegador, tras la
 * hidratación, se aplica la preferencia guardada (localStorage/cookie).
 *
 * `lang` y `locale` son signals → los consumidores (pipe de fecha, selector de
 * banderas) reaccionan sin zone.js.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly translate = inject(TranslateService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  /** Idioma activo (signal). Default: español. */
  readonly lang = signal<Lang>(DEFAULT_LANG);

  /** Código de locale de Angular del idioma activo (`es-GT` / `en-US`). */
  readonly locale = computed(() => LOCALE_BY_LANG[this.lang()]);

  readonly supported = SUPPORTED_LANGS;

  /**
   * Arranque. Fija SIEMPRE el idioma por defecto (`es`) tanto en SSR como en el
   * PRIMER render del navegador → la hidratación calza exactamente (mismo HTML) y
   * no hay warning ni FOUC. La preferencia del usuario se aplica DESPUÉS de la
   * hidratación con `hydratePreference()`.
   */
  init(): void {
    this.translate.addLangs([...SUPPORTED_LANGS]);
    this.translate.setFallbackLang(DEFAULT_LANG);
    this.apply(DEFAULT_LANG, false);
  }

  /**
   * Aplica la preferencia persistida. Debe llamarse SOLO en el navegador y tras
   * la hidratación (p.ej. `afterNextRender`) para no romper el calce del SSR.
   */
  hydratePreference(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const stored = this.readStored();
    if (stored && stored !== this.lang()) this.apply(stored, false);
  }

  /** Cambia el idioma y persiste la preferencia (solo navegador). */
  use(lang: Lang): void {
    this.apply(lang, true);
  }

  private apply(lang: Lang, persist: boolean): void {
    const next = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
    this.translate.use(next);
    this.lang.set(next);
    if (isPlatformBrowser(this.platformId)) {
      this.document.documentElement.lang = next;
      if (persist) this.persist(next);
    }
  }

  private readStored(): Lang | null {
    try {
      const fromLs = this.window()?.localStorage?.getItem(LANG_STORAGE_KEY);
      if (fromLs && SUPPORTED_LANGS.includes(fromLs as Lang)) return fromLs as Lang;
      const fromCookie = this.readCookie(LANG_STORAGE_KEY);
      if (fromCookie && SUPPORTED_LANGS.includes(fromCookie as Lang)) return fromCookie as Lang;
    } catch {
      /* almacenamiento no disponible (modo privado, etc.) → default */
    }
    return null;
  }

  private persist(lang: Lang): void {
    try {
      this.window()?.localStorage?.setItem(LANG_STORAGE_KEY, lang);
      // Cookie de 1 año para que el SSR pueda leerla en el futuro si se decide
      // variar el render por idioma (hoy el SSR usa el default).
      this.document.cookie = `${LANG_STORAGE_KEY}=${lang};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      /* sin persistencia disponible → se pierde entre sesiones, no rompe */
    }
  }

  private readCookie(name: string): string | null {
    const match = this.document.cookie?.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private window(): (Window & typeof globalThis) | null {
    return this.document.defaultView;
  }
}

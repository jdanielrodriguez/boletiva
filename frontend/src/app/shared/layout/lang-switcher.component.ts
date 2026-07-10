import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Lang } from '../../core/i18n/i18n.types';

/**
 * Selector de idioma con BANDERAS (para el header, disponible con o sin sesión):
 * Guatemala 🇬🇹 = español (es-GT), EE. UU. 🇺🇸 = inglés (en-US). Un click cambia el
 * idioma al instante y persiste la preferencia. El idioma activo se resalta.
 *
 * Las banderas son SVG INLINE (no emoji): los emoji de bandera NO renderizan en
 * Windows ni en muchos Linux (aparecen como letras o cuadros). El SVG garantiza
 * que la bandera se vea igual en todas las plataformas. Se acompaña del código
 * corto (ES/EN) por accesibilidad y claridad.
 */
@Component({
  selector: 'app-lang-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="lang-switcher" role="group" [attr.aria-label]="'shell.language' | translate" data-testid="lang-switcher">
      <button
        type="button"
        class="lang-flag"
        [class.active]="i18n.lang() === 'es'"
        [attr.aria-pressed]="i18n.lang() === 'es'"
        [attr.aria-label]="'shell.langEs' | translate"
        [title]="'shell.langEs' | translate"
        (click)="setLang('es')"
        data-testid="lang-es"
      >
        <!-- Bandera de Guatemala: celeste | blanco | celeste -->
        <svg class="flag" viewBox="0 0 24 16" aria-hidden="true">
          <rect width="24" height="16" fill="#fff" />
          <rect width="8" height="16" fill="#4997d0" />
          <rect x="16" width="8" height="16" fill="#4997d0" />
        </svg>
        <span class="lang-code">{{ 'shell.langEsShort' | translate }}</span>
      </button>
      <button
        type="button"
        class="lang-flag"
        [class.active]="i18n.lang() === 'en'"
        [attr.aria-pressed]="i18n.lang() === 'en'"
        [attr.aria-label]="'shell.langEn' | translate"
        [title]="'shell.langEn' | translate"
        (click)="setLang('en')"
        data-testid="lang-en"
      >
        <!-- Bandera de EE. UU. (simplificada): franjas + cantón azul -->
        <svg class="flag" viewBox="0 0 24 16" aria-hidden="true">
          <rect width="24" height="16" fill="#fff" />
          <g fill="#b22234">
            <rect width="24" height="1.6" y="0" />
            <rect width="24" height="1.6" y="3.2" />
            <rect width="24" height="1.6" y="6.4" />
            <rect width="24" height="1.6" y="9.6" />
            <rect width="24" height="1.6" y="12.8" />
          </g>
          <rect width="11" height="8.8" fill="#3c3b6e" />
        </svg>
        <span class="lang-code">{{ 'shell.langEnShort' | translate }}</span>
      </button>
    </div>
  `,
  styles: [
    `
      .lang-switcher {
        display: inline-flex;
        gap: 0.3rem;
        align-items: center;
      }
      .lang-flag {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 0.5rem;
        padding: 0.2rem 0.4rem;
        cursor: pointer;
        line-height: 1;
        opacity: 0.55;
        transition: opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .lang-flag:hover {
        opacity: 0.85;
      }
      .lang-flag.active {
        opacity: 1;
        border-color: rgba(123, 92, 255, 0.6);
        background: rgba(123, 92, 255, 0.12);
      }
      .flag {
        width: 22px;
        height: 15px;
        border-radius: 2px;
        display: block;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
      }
      .lang-code {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: currentColor;
      }
    `,
  ],
})
export class LangSwitcherComponent {
  protected readonly i18n = inject(I18nService);

  setLang(lang: Lang): void {
    this.i18n.use(lang);
  }
}

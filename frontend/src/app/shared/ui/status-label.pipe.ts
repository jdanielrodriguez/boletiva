import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Muestra el estado con Primera Letra Mayúscula y traducido (v3.7). Busca
 * `common.statuses.<value>`; si no existe, capitaliza el valor crudo. NO cambia el
 * value interno del filtro/badge — solo el texto que ve el usuario.
 */
@Pipe({ name: 'statusLabel', standalone: true, pure: false })
export class StatusLabelPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    if (!raw) return '';
    const key = 'common.statuses.' + raw;
    const translated = this.translate.instant(key);
    if (translated && translated !== key) return translated as string;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
}

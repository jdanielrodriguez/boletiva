import { formatDate } from '@angular/common';
import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';
import { EVENT_TIME_ZONE } from './i18n.types';

/**
 * Formatea fechas con el LOCALE ACTIVO (es-GT / en-US) y, por defecto, en la
 * ZONA HORARIA DE GUATEMALA (`America/Guatemala`). Las fechas del backend vienen
 * en UTC/ISO; este pipe garantiza que la hora mostrada sea la de GT (no la del
 * navegador ni UTC crudo), en el idioma correcto.
 *
 * Es **impuro** para reaccionar al cambio de idioma en runtime (zoneless): lee
 * `i18n.locale()` (signal) en cada evaluación.
 *
 * Uso: `{{ evento.startsAt | localizedDate:'EEE d MMM y, HH:mm' }}`.
 * Para fechas sin hora del evento (p.ej. creación de registros) pasar
 * `timezone` propio o dejar el default GT (consistente para todo el producto).
 */
@Pipe({ name: 'localizedDate', pure: false })
export class LocalizedDatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(
    value: string | number | Date | null | undefined,
    format = 'mediumDate',
    timezone: string = EVENT_TIME_ZONE,
  ): string {
    if (value === null || value === undefined || value === '') return '';
    try {
      return formatDate(value, format, this.i18n.locale(), timezone);
    } catch {
      return '';
    }
  }
}

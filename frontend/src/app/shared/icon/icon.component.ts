import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Nombres de icono disponibles (SVG inline, trazo). */
export type IconName =
  | 'edit'
  | 'delete'
  | 'publish'
  | 'save'
  | 'disk'
  | 'cancel'
  | 'suspend'
  | 'history'
  | 'reactivate'
  | 'revoke'
  | 'default'
  | 'seats'
  | 'add'
  | 'invite'
  | 'unlock'
  | 'view'
  | 'accounts'
  | 'search'
  | 'maintenance'
  | 'activate'
  | 'close'
  | 'back'
  | 'hide'
  | 'lock'
  | 'alert'
  | 'help'
  | 'draft'
  | 'banner';

/**
 * Icono SVG inline reutilizable (trazo, hereda `currentColor`). Se usa dentro de
 * los botones de acción con su propio `aria-label`/`title`, por eso el `<svg>` va
 * marcado `aria-hidden`. Un `@switch` por nombre evita inyectar HTML (sanitizer).
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="app-icon"
  >
    @switch (name()) {
      @case ('edit') {
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      }
      @case ('delete') {
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      }
      @case ('publish') {
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      }
      @case ('save') {
        <path d="M20 6L9 17l-5-5" />
      }
      @case ('disk') {
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      }
      @case ('cancel') {
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      }
      @case ('close') {
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      }
      @case ('suspend') {
        <path d="M10 15V9" />
        <path d="M14 15V9" />
        <circle cx="12" cy="12" r="9" />
      }
      @case ('history') {
        <path d="M12 7v5l3 2" />
        <circle cx="12" cy="12" r="9" />
      }
      @case ('reactivate') {
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v5h-5" />
      }
      @case ('revoke') {
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6" />
        <path d="M15 9l-6 6" />
      }
      @case ('default') {
        <path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z" />
      }
      @case ('seats') {
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      }
      @case ('add') {
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      }
      @case ('invite') {
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      }
      @case ('unlock') {
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 7.5-2" />
      }
      @case ('view') {
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      }
      @case ('accounts') {
        <path d="M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
      }
      @case ('search') {
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      }
      @case ('maintenance') {
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
      }
      @case ('activate') {
        <path d="M12 2v10" />
        <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
      }
      @case ('banner') {
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="M21 15l-5-4-4 3-2-1.5L3 17" />
      }
      @case ('back') {
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      }
      @case ('hide') {
        <path d="M17.9 17.9A10.4 10.4 0 0 1 12 19C5.5 19 2 12 2 12a18.5 18.5 0 0 1 5.1-5.9" />
        <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        <path d="M2 2l20 20" />
      }
      @case ('lock') {
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      }
      @case ('alert') {
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      }
      @case ('help') {
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      }
      @case ('draft') {
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      }
    }
  </svg>`,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(16);
}

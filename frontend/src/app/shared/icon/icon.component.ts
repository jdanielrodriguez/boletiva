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
  | 'eraser'
  | 'chart'
  | 'chat'
  | 'banner'
  | 'user'
  | 'ticket'
  | 'card'
  | 'wallet'
  | 'gear'
  | 'bell'
  | 'book'
  | 'logout'
  | 'refresh'
  | 'download'
  | 'calendar'
  | 'pin'
  | 'copy'
  | 'chevron-right'
  | 'sun'
  | 'moon';

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
      @case ('eraser') {
        <path d="m7 21-4.3-4.3a1.7 1.7 0 0 1 0-2.4l9.6-9.6a1.7 1.7 0 0 1 2.4 0l5.6 5.6a1.7 1.7 0 0 1 0 2.4L13 21" />
        <path d="M22 21H7" />
        <path d="m5 11 9 9" />
      }
      @case ('chart') {
        <path d="M3 3v18h18" />
        <path d="M7 14l3-4 3 3 5-7" />
      }
      @case ('chat') {
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6a8.5 8.5 0 0 1-.9-3.9A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
      }
      @case ('user') {
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      }
      @case ('ticket') {
        <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
        <path d="M13 7v2M13 15v2" />
      }
      @case ('card') {
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      }
      @case ('wallet') {
        <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8" />
        <circle cx="17" cy="13" r="1.2" />
      }
      @case ('gear') {
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      }
      @case ('bell') {
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      }
      @case ('book') {
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      }
      @case ('logout') {
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      }
      @case ('refresh') {
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 4v5h-5" />
      }
      @case ('download') {
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      }
      @case ('calendar') {
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M3 10h18" />
      }
      @case ('pin') {
        <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      }
      @case ('copy') {
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      }
      @case ('chevron-right') {
        <path d="M9 18l6-6-6-6" />
      }
      @case ('sun') {
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      }
      @case ('moon') {
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      }
    }
  </svg>`,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(16);
}

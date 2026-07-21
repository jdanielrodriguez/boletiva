import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard, verifiedEmailGuard } from './core/auth/guards';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/catalog/catalog').then((m) => m.Catalog),
    title: 'Eventos — Boletiva',
  },
  {
    // Selección ABIERTA (e-commerce): cualquiera busca/elige sin sesión. El login
    // se exige al RESERVAR (paso hacia el pago) — ver PurchasePage.reserve().
    path: 'eventos/:slug/comprar',
    loadComponent: () => import('./features/purchase/purchase.page').then((m) => m.PurchasePage),
    title: 'Comprar — Boletiva',
  },
  {
    path: 'eventos/:slug',
    loadComponent: () => import('./pages/event-detail/event-detail').then((m) => m.EventDetail),
  },
  {
    path: 'reserva/:token',
    loadComponent: () => import('./pages/reservation/reservation.page').then((m) => m.ReservationPage),
    title: 'Reserva — Boletiva',
  },
  {
    path: 'checkout/:orderId',
    loadComponent: () => import('./features/checkout/checkout.page').then((m) => m.CheckoutPage),
    canActivate: [authGuard, verifiedEmailGuard],
    title: 'Pago — Boletiva',
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    canActivate: [guestGuard],
    title: 'Iniciar sesión — Boletiva',
  },
  {
    path: 'verificar-correo',
    loadComponent: () => import('./pages/verify-email/verify-email').then((m) => m.VerifyEmail),
    title: 'Verifica tu correo — Boletiva',
  },
  {
    // PWA de validación en puerta (magic-link del validador). Público: se autentica
    // con el gate-token que devuelve el canje, no con sesión.
    path: 'validar/:token',
    loadComponent: () => import('./features/gate/gate-validate.page').then((m) => m.GateValidatePage),
    title: 'Validar boletos — Boletiva',
  },
  {
    path: 'recuperar',
    loadComponent: () => import('./pages/password/recover').then((m) => m.PasswordRecover),
    canActivate: [guestGuard],
    title: 'Recuperar contraseña — Boletiva',
  },
  {
    // El enlace del correo apunta a /reset-password?token=; /restablecer es alias en español.
    path: 'reset-password',
    loadComponent: () => import('./pages/password/reset').then((m) => m.PasswordReset),
    canActivate: [guestGuard],
    title: 'Restablecer contraseña — Boletiva',
  },
  {
    path: 'restablecer',
    loadComponent: () => import('./pages/password/reset').then((m) => m.PasswordReset),
    canActivate: [guestGuard],
    title: 'Restablecer contraseña — Boletiva',
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.Forbidden),
    title: 'Sin permiso — Boletiva',
  },
  {
    path: 'terminos',
    loadComponent: () => import('./pages/static/terms').then((m) => m.Terms),
    title: 'Términos y condiciones — Boletiva',
  },
  {
    // Sin guestGuard: con ?token= debe poder ACTIVAR el rol aunque haya sesión
    // (invitación a cuenta existente). El propio componente redirige a /cuenta si
    // entra un usuario logueado sin token.
    path: 'registro',
    loadComponent: () => import('./pages/static/register').then((m) => m.Register),
    title: 'Crear cuenta — Boletiva',
  },
  {
    path: 'transferencias/reclamar',
    loadComponent: () => import('./pages/transfer-claim/transfer-claim').then((m) => m.TransferClaim),
    canActivate: [authGuard, verifiedEmailGuard],
    title: 'Reclamar boleto — Boletiva',
  },
  {
    path: 'promotor',
    loadComponent: () => import('./pages/promoter/promoter-panel').then((m) => m.PromoterPanel),
    canActivate: [roleGuard('promoter', 'admin')],
    title: 'Panel del promotor — Boletiva',
  },
  {
    path: 'promotor/dashboard',
    loadComponent: () =>
      import('./pages/promoter/promoter-dashboard.page').then((m) => m.PromoterDashboardPage),
    canActivate: [roleGuard('promoter', 'admin')],
    title: 'Dashboard del promotor — Boletiva',
  },
  {
    path: 'promotor/eventos/nuevo',
    loadComponent: () => import('./pages/promoter/event-edit.page').then((m) => m.EventEditPage),
    canActivate: [roleGuard('promoter', 'admin')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Nuevo evento — Boletiva',
  },
  {
    path: 'promotor/eventos/:id/editar',
    loadComponent: () => import('./pages/promoter/event-edit.page').then((m) => m.EventEditPage),
    canActivate: [roleGuard('promoter', 'admin')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Editar evento — Boletiva',
  },
  {
    path: 'promotor/eventos/:eventId/localidades/:localityId/asientos',
    loadComponent: () =>
      import('./pages/promoter/seat-manager.page').then((m) => m.SeatManagerPage),
    canActivate: [roleGuard('promoter', 'admin')],
    title: 'Administrar asientos — Boletiva',
  },
  {
    path: 'conviertete-en-promotor',
    loadComponent: () =>
      import('./pages/promoter/become-promoter.page').then((m) => m.BecomePromoterPage),
    // Sin guards: es una landing de PLANES abierta a visitantes; el propio
    // componente decide (logueado → aplica; sin sesión → registro en un paso).
    title: 'Conviértete en promotor — Boletiva',
  },
  {
    path: 'cuenta',
    loadComponent: () => import('./pages/static/account').then((m) => m.Account),
    canActivate: [authGuard],
    title: 'Mi cuenta — Boletiva',
  },
  {
    path: 'cuenta/transaccion/:orderId',
    loadComponent: () =>
      import('./pages/account/transaction-detail').then((m) => m.TransactionDetail),
    canActivate: [authGuard],
    title: 'Transacción — Boletiva',
  },
  {
    path: 'configuracion',
    loadComponent: () => import('./pages/config/config.page').then((m) => m.ConfigPage),
    canActivate: [roleGuard('admin', 'advisor')],
    title: 'Configuración — Boletiva',
  },
  {
    // B3: chat de soporte (promotor premium ↔ asesor/admin). El contenido se auto-gatea
    // por `chat.enabled` + rol/beneficios; el backend es la autoridad.
    path: 'soporte',
    loadComponent: () => import('./pages/support/support-chat.page').then((m) => m.SupportChatPage),
    canActivate: [authGuard, verifiedEmailGuard],
    title: 'Soporte — Boletiva',
  },
  {
    // B2: el admin llega aquí desde el enlace del correo para aprobar el desbloqueo del asesor.
    path: 'admin/asesor-desbloqueo',
    loadComponent: () =>
      import('./pages/config/advisor-unlock-approve.page').then((m) => m.AdvisorUnlockApprovePage),
    canActivate: [roleGuard('admin')],
    title: 'Desbloqueo de asesor — Boletiva',
  },
  {
    // T5: tab de admin para enviar notificaciones a un promotor o a todos.
    path: 'admin/notificaciones',
    loadComponent: () => import('./pages/admin/admin-notifications.page').then((m) => m.AdminNotificationsPage),
    canActivate: [roleGuard('admin')],
    title: 'Enviar notificaciones — Boletiva',
  },
  {
    // T7e: admin invita asesores.
    path: 'admin/asesores',
    loadComponent: () => import('./pages/admin/admin-advisors.page').then((m) => m.AdminAdvisorsPage),
    canActivate: [roleGuard('admin')],
    title: 'Asesores — Boletiva',
  },
  {
    // T7e: onboarding de asesor por token (nuevo → fija contraseña; existente → confirma).
    path: 'asesor/fijar-password',
    loadComponent: () => import('./pages/advisor/advisor-onboarding.page').then((m) => m.AdvisorOnboardingPage),
    title: 'Activar cuenta de asesor — Boletiva',
  },
  {
    path: 'asesor/confirmar',
    loadComponent: () => import('./pages/advisor/advisor-onboarding.page').then((m) => m.AdvisorOnboardingPage),
    title: 'Confirmar rol de asesor — Boletiva',
  },
  {
    // La LISTA de salones vive en `/configuracion?tab=salones` (v3.9 · B1). Aquí
    // solo quedan las páginas de creación/edición.
    path: 'configuracion/salones/nuevo',
    loadComponent: () => import('./pages/config/hall-edit.page').then((m) => m.HallEditPage),
    canActivate: [roleGuard('admin', 'advisor')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Nuevo salón — Boletiva',
  },
  {
    path: 'configuracion/salones/:id/editar',
    loadComponent: () => import('./pages/config/hall-edit.page').then((m) => m.HallEditPage),
    canActivate: [roleGuard('admin', 'advisor')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Editar salón — Boletiva',
  },
  {
    path: 'configuracion/salones/:id/dashboard',
    loadComponent: () =>
      import('./pages/config/hall-dashboard.page').then((m) => m.HallDashboardPage),
    canActivate: [roleGuard('admin', 'advisor')],
    title: 'Dashboard de salón — Boletiva',
  },
  {
    // La LISTA de plantillas vive en `/configuracion?tab=plantillas` (v3.9 · B1).
    // Aquí solo quedan las páginas de creación/edición.
    path: 'configuracion/plantillas/nuevo',
    loadComponent: () => import('./pages/config/template-edit.page').then((m) => m.TemplateEditPage),
    canActivate: [roleGuard('admin', 'advisor')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Nueva plantilla — Boletiva',
  },
  {
    path: 'configuracion/plantillas/:id/editar',
    loadComponent: () => import('./pages/config/template-edit.page').then((m) => m.TemplateEditPage),
    canActivate: [roleGuard('admin', 'advisor')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Editar plantilla — Boletiva',
  },
  {
    path: 'configuracion/plantillas/:id/dashboard',
    loadComponent: () =>
      import('./pages/config/template-dashboard.page').then((m) => m.TemplateDashboardPage),
    canActivate: [roleGuard('admin', 'advisor')],
    title: 'Dashboard de plantilla — Boletiva',
  },
  {
    path: 'configuracion/promotores/:id/historial',
    loadComponent: () =>
      import('./pages/config/promoter-history.page').then((m) => m.PromoterHistoryPage),
    canActivate: [roleGuard('admin', 'advisor')],
    title: 'Historial del promotor — Boletiva',
  },
  {
    path: 'configuracion/rentabilidad',
    loadComponent: () => import('./pages/config/profitability.page').then((m) => m.ProfitabilityPage),
    canActivate: [roleGuard('admin', 'advisor')],
    title: 'Rentabilidad por evento — Boletiva',
  },
  {
    path: 'cuenta/configuracion',
    loadComponent: () => import('./pages/static/account').then((m) => m.Account),
    canActivate: [authGuard],
    title: 'Configuraciones — Boletiva',
  },
  { path: '**', redirectTo: '' },
];

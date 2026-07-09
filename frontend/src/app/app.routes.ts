import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard, verifiedEmailGuard } from './core/auth/guards';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/catalog/catalog').then((m) => m.Catalog),
    title: 'Eventos — Pasa Eventos',
  },
  {
    // Selección ABIERTA (e-commerce): cualquiera busca/elige sin sesión. El login
    // se exige al RESERVAR (paso hacia el pago) — ver PurchasePage.reserve().
    path: 'eventos/:slug/comprar',
    loadComponent: () => import('./features/purchase/purchase.page').then((m) => m.PurchasePage),
    title: 'Comprar — Pasa Eventos',
  },
  {
    path: 'eventos/:slug',
    loadComponent: () => import('./pages/event-detail/event-detail').then((m) => m.EventDetail),
  },
  {
    path: 'reserva/:token',
    loadComponent: () => import('./pages/reservation/reservation.page').then((m) => m.ReservationPage),
    title: 'Reserva — Pasa Eventos',
  },
  {
    path: 'checkout/:orderId',
    loadComponent: () => import('./features/checkout/checkout.page').then((m) => m.CheckoutPage),
    canActivate: [authGuard, verifiedEmailGuard],
    title: 'Pago — Pasa Eventos',
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    canActivate: [guestGuard],
    title: 'Iniciar sesión — Pasa Eventos',
  },
  {
    path: 'verificar-correo',
    loadComponent: () => import('./pages/verify-email/verify-email').then((m) => m.VerifyEmail),
    title: 'Verifica tu correo — Pasa Eventos',
  },
  {
    path: 'recuperar',
    loadComponent: () => import('./pages/password/recover').then((m) => m.PasswordRecover),
    canActivate: [guestGuard],
    title: 'Recuperar contraseña — Pasa Eventos',
  },
  {
    // El enlace del correo apunta a /reset-password?token=; /restablecer es alias en español.
    path: 'reset-password',
    loadComponent: () => import('./pages/password/reset').then((m) => m.PasswordReset),
    canActivate: [guestGuard],
    title: 'Restablecer contraseña — Pasa Eventos',
  },
  {
    path: 'restablecer',
    loadComponent: () => import('./pages/password/reset').then((m) => m.PasswordReset),
    canActivate: [guestGuard],
    title: 'Restablecer contraseña — Pasa Eventos',
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.Forbidden),
    title: 'Sin permiso — Pasa Eventos',
  },
  {
    path: 'terminos',
    loadComponent: () => import('./pages/static/terms').then((m) => m.Terms),
    title: 'Términos y condiciones — Pasa Eventos',
  },
  {
    path: 'registro',
    loadComponent: () => import('./pages/static/register').then((m) => m.Register),
    canActivate: [guestGuard],
    title: 'Crear cuenta — Pasa Eventos',
  },
  {
    path: 'transferencias/reclamar',
    loadComponent: () => import('./pages/transfer-claim/transfer-claim').then((m) => m.TransferClaim),
    canActivate: [authGuard, verifiedEmailGuard],
    title: 'Reclamar boleto — Pasa Eventos',
  },
  {
    path: 'promotor',
    loadComponent: () => import('./pages/promoter/promoter-panel').then((m) => m.PromoterPanel),
    canActivate: [roleGuard('promoter', 'admin')],
    title: 'Panel del promotor — Pasa Eventos',
  },
  {
    path: 'promotor/eventos/:id/editar',
    loadComponent: () => import('./pages/promoter/event-edit.page').then((m) => m.EventEditPage),
    canActivate: [roleGuard('promoter', 'admin')],
    title: 'Editar evento — Pasa Eventos',
  },
  {
    path: 'cuenta',
    loadComponent: () => import('./pages/static/account').then((m) => m.Account),
    canActivate: [authGuard],
    title: 'Mi cuenta — Pasa Eventos',
  },
  {
    path: 'configuracion',
    loadComponent: () => import('./pages/config/config.page').then((m) => m.ConfigPage),
    canActivate: [roleGuard('admin')],
    title: 'Configuración — Pasa Eventos',
  },
  {
    path: 'cuenta/configuracion',
    loadComponent: () => import('./pages/static/account').then((m) => m.Account),
    canActivate: [authGuard],
    title: 'Configuraciones — Pasa Eventos',
  },
  { path: '**', redirectTo: '' },
];

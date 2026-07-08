import { Routes } from '@angular/router';
import { authGuard, verifiedEmailGuard } from './core/auth/guards';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/catalog/catalog').then((m) => m.Catalog),
    title: 'Eventos — Pasa Eventos',
  },
  {
    path: 'eventos/:slug/comprar',
    loadComponent: () => import('./features/purchase/purchase.page').then((m) => m.PurchasePage),
    canActivate: [authGuard, verifiedEmailGuard],
    title: 'Comprar — Pasa Eventos',
  },
  {
    path: 'eventos/:slug',
    loadComponent: () => import('./pages/event-detail/event-detail').then((m) => m.EventDetail),
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
    title: 'Iniciar sesión — Pasa Eventos',
  },
  {
    path: 'verificar-correo',
    loadComponent: () => import('./pages/verify-email/verify-email').then((m) => m.VerifyEmail),
    title: 'Verifica tu correo — Pasa Eventos',
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.Forbidden),
    title: 'Sin permiso — Pasa Eventos',
  },
  { path: '**', redirectTo: '' },
];

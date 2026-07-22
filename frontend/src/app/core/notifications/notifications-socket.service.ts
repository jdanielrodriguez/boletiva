import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { TokenStore } from '../auth/token-store.service';
import type { AppNotification } from '../api/notifications.api';

/** Cliente socket.io de notificaciones (T5, namespace `/notifications`). SSR-safe. */
@Injectable({ providedIn: 'root' })
export class NotificationsSocketService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly tokens = inject(TokenStore);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socket: any = null;
  private connected = false;
  /** Notificación nueva recibida en vivo. */
  readonly notification$ = new Subject<AppNotification>();
  /** Contador de no-leídos actualizado. */
  readonly unread$ = new Subject<number>();

  /** Conecta una vez (idempotente). Requiere token y navegador. */
  async connect(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.connected) return;
    const token = this.tokens.getAccessToken();
    if (!token) return;
    this.connected = true;
    const origin = new URL(this.apiBaseUrl, 'http://localhost').origin;
    const { io } = await import('socket.io-client');
    this.socket = io(`${origin}/notifications`, { auth: { token }, transports: ['websocket', 'polling'], autoConnect: true });
    this.socket.on('notification', (n: AppNotification) => this.notification$.next(n));
    this.socket.on('unread', (u: { count: number }) => this.unread$.next(u.count));
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }
}

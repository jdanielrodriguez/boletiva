import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { TokenStore } from '../auth/token-store.service';
import type { ChatMessage } from '../api/chat.api';

/** Cliente socket.io de soporte (T1; namespace `/support`). SSR-safe: solo en el navegador. */
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly tokens = inject(TokenStore);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socket: any = null;
  /** Ref-count: la conexión se mantiene mientras haya ≥1 consumidor (página + burbuja). */
  private refs = 0;
  /** Mensaje nuevo recibido en vivo. */
  readonly message$ = new Subject<ChatMessage>();
  /** Aviso a agentes de actividad en un ticket. */
  readonly activity$ = new Subject<{ ticketId: string }>();

  /**
   * Toma una referencia a la conexión (la abre si es la primera). Cada consumidor
   * (SupportChatPage, burbuja global) debe hacer `release()` al terminar. Evita que
   * la página, al destruirse, corte la conexión que la burbuja global necesita viva.
   */
  async acquire(): Promise<void> {
    this.refs++;
    await this.connect();
  }

  /** Libera una referencia; desconecta solo cuando ya nadie la usa. */
  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0) this.disconnect();
  }

  /** Abre la conexión (idempotente). Requiere token de acceso y navegador. */
  async connect(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.socket) return;
    const token = this.tokens.getAccessToken();
    if (!token) return;
    const origin = new URL(this.apiBaseUrl, 'http://localhost').origin;
    const { io } = await import('socket.io-client');
    this.socket = io(`${origin}/support`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    this.socket.on('message', (m: ChatMessage) => this.message$.next(m));
    this.socket.on('ticket-activity', (a: { ticketId: string }) => this.activity$.next(a));
  }

  joinThread(ticketId: string): void {
    this.socket?.emit('join-ticket', { ticketId });
  }
  leaveThread(ticketId: string): void {
    this.socket?.emit('leave-ticket', { ticketId });
  }
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

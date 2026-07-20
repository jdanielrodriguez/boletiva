import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { TokenStore } from '../auth/token-store.service';
import type { ChatMessage } from '../api/chat.api';

/** Cliente socket.io del chat (B3). SSR-safe: solo conecta en el navegador. */
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly tokens = inject(TokenStore);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socket: any = null;
  /** Mensaje nuevo recibido en vivo. */
  readonly message$ = new Subject<ChatMessage>();
  /** Aviso a agentes de actividad en un hilo. */
  readonly activity$ = new Subject<{ threadId: string }>();

  /** Abre la conexión (idempotente). Requiere token de acceso y navegador. */
  async connect(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.socket) return;
    const token = this.tokens.getAccessToken();
    if (!token) return;
    const origin = new URL(this.apiBaseUrl, 'http://localhost').origin;
    const { io } = await import('socket.io-client');
    this.socket = io(`${origin}/chat`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    this.socket.on('message', (m: ChatMessage) => this.message$.next(m));
    this.socket.on('thread-activity', (a: { threadId: string }) => this.activity$.next(a));
  }

  joinThread(threadId: string): void {
    this.socket?.emit('join-thread', { threadId });
  }
  leaveThread(threadId: string): void {
    this.socket?.emit('leave-thread', { threadId });
  }
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

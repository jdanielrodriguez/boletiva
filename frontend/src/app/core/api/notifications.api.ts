import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload?: unknown;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
}

export interface NotificationPreference {
  id: string;
  type: string;
  channel: 'inapp' | 'email';
  enabled: boolean;
}

/**
 * SDK de notificaciones (T5). Cada usuario gestiona LAS SUYAS (listar/marcar/preferencias);
 * el admin puede ENVIAR a un promotor o a todos. La entrega en vivo va por socket
 * (NotificationsSocketService).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly api = inject(ApiClient);

  list(cursor?: string, limit = 20): Observable<NotificationPage> {
    const p = new URLSearchParams();
    if (cursor) p.set('cursor', cursor);
    p.set('limit', String(limit));
    return this.api.get<NotificationPage>(`/notifications?${p.toString()}`);
  }
  unreadCount(): Observable<{ count: number }> {
    return this.api.get<{ count: number }>('/notifications/unread-count');
  }
  read(id: string): Observable<{ ok: boolean; unread: number }> {
    return this.api.post<{ ok: boolean; unread: number }>(`/notifications/read/${id}`, {});
  }
  readAll(): Observable<{ ok: boolean; unread: number }> {
    return this.api.post<{ ok: boolean; unread: number }>('/notifications/read-all', {});
  }
  preferences(): Observable<NotificationPreference[]> {
    return this.api.get<NotificationPreference[]>('/notifications/preferences');
  }
  setPreference(type: string, channel: 'inapp' | 'email', enabled: boolean): Observable<NotificationPreference> {
    return this.api.patch<NotificationPreference>('/notifications/preferences', { type, channel, enabled });
  }
  adminSend(input: { promoterId?: string; all?: boolean; title: string; body: string }): Observable<{ sent: number }> {
    return this.api.post<{ sent: number }>('/notifications/admin/send', input);
  }
}

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Estado del ticket (T1). El backend maneja la máquina completa; el front distingue
 *  sobre todo "closed" para bloquear la escritura. */
export type SupportStatus =
  | 'new'
  | 'open'
  | 'awaiting_promoter'
  | 'awaiting_support'
  | 'resolved'
  | 'closed'
  | 'suspended'
  | 'reopened';

export interface ChatThread {
  id: string;
  promoterId: string;
  subject: string;
  status: SupportStatus;
  category?: string;
  priority?: string;
  assignedToId: string | null;
  lastMessageAt: string;
  createdAt: string;
  archived?: boolean;
  promoter?: { id: string; firstName: string; lastName: string | null; email: string };
}

export interface ChatMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: string;
  body: string;
  internalNote?: boolean;
  createdAt: string;
}

/**
 * SDK de tickets de soporte (T1; evoluciona el chat B3). Historial + ciclo de vida por
 * REST (/support/tickets); la entrega en vivo va por socket.io (ChatSocketService). El
 * promotor abre tickets y escribe; asesor/admin atienden. UI rica (bandeja/SLA) = T3.
 */
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly api = inject(ApiClient);

  createThread(subject: string, message: string): Observable<ChatThread> {
    return this.api.post<ChatThread>('/support/tickets', { subject, message });
  }
  listThreads(): Observable<ChatThread[]> {
    return this.api.get<ChatThread[]>('/support/tickets');
  }
  getMessages(ticketId: string): Observable<{ ticket: ChatThread; messages: ChatMessage[] }> {
    return this.api.get<{ ticket: ChatThread; messages: ChatMessage[] }>(`/support/tickets/${ticketId}/messages`);
  }
  postMessage(ticketId: string, body: string): Observable<ChatMessage> {
    return this.api.post<ChatMessage>(`/support/tickets/${ticketId}/messages`, { body });
  }
  close(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/close`, {});
  }
  reopen(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/reopen`, {});
  }
  assign(ticketId: string, assignedToId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/assign`, { assignedToId });
  }
}

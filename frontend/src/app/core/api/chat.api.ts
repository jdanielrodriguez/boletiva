import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface ChatThread {
  id: string;
  promoterId: string;
  subject: string;
  status: 'open' | 'closed';
  assignedToId: string | null;
  answered: boolean;
  lastMessageAt: string;
  createdAt: string;
  promoter?: { id: string; firstName: string; lastName: string | null; email: string };
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderRole: string;
  body: string;
  createdAt: string;
}

/**
 * SDK del chat de soporte (B3). Historial + ruteo por REST; la entrega en vivo va
 * por socket.io (ChatSocketService). El promotor premium abre hilos y escribe;
 * asesor/admin responden y (admin) reasignan.
 */
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly api = inject(ApiClient);

  createThread(subject: string, message: string): Observable<ChatThread> {
    return this.api.post<ChatThread>('/chat/threads', { subject, message });
  }
  listThreads(): Observable<ChatThread[]> {
    return this.api.get<ChatThread[]>('/chat/threads');
  }
  getMessages(threadId: string): Observable<{ thread: ChatThread; messages: ChatMessage[] }> {
    return this.api.get<{ thread: ChatThread; messages: ChatMessage[] }>(`/chat/threads/${threadId}/messages`);
  }
  postMessage(threadId: string, body: string): Observable<ChatMessage> {
    return this.api.post<ChatMessage>(`/chat/threads/${threadId}/messages`, { body });
  }
  close(threadId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/chat/threads/${threadId}/close`, {});
  }
  reopen(threadId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/chat/threads/${threadId}/reopen`, {});
  }
  assign(threadId: string, assignedToId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/chat/threads/${threadId}/assign`, { assignedToId });
  }
}

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
  contextType?: string;
  contextId?: string;
  firstResponseDueAt?: string;
  resolveDueAt?: string;
  firstRespondedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  csatScore?: number;
  lastMessageAt: string;
  createdAt: string;
  archived?: boolean;
  promoter?: { id: string; firstName: string; lastName: string | null; email: string };
}

export type SupportPriority = 'low' | 'medium' | 'high' | 'urgent';
export type SupportCategory = 'billing' | 'payments_settlement' | 'event' | 'technical' | 'account' | 'other';

export interface SupportAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string;
}

export interface ChatMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: string;
  body: string;
  internalNote?: boolean;
  attachments?: SupportAttachment[];
  createdAt: string;
}

/** Adjunto ya subido, listo para enviarse con el mensaje. */
export interface UploadedAttachment {
  key: string;
  filename: string;
  mime: string;
  size: number;
}

export interface SupportAgent {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  isAdmin: boolean;
}

export interface SupportMetrics {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  unassigned: number;
  slaBreach: { firstResponse: number; resolution: number };
  csat: { avg: number | null; count: number };
  resolvedTotal: number;
}

export interface SupportMacro {
  id: string;
  title: string;
  body: string;
  lang: string;
  category: SupportCategory | null;
}

/** Filtros de la cola del agente. */
export interface QueueFilters {
  status?: SupportStatus;
  priority?: SupportPriority;
  category?: SupportCategory;
  unassigned?: boolean;
  mine?: boolean;
}

export interface QueuePage {
  items: ChatThread[];
  nextCursor: string | null;
}

/**
 * SDK de tickets de soporte (T1; evoluciona el chat B3). Historial + ciclo de vida por
 * REST (/support/tickets); la entrega en vivo va por socket.io (ChatSocketService). El
 * promotor abre tickets y escribe; asesor/admin atienden. UI rica (bandeja/SLA) = T3.
 */
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly api = inject(ApiClient);

  createThread(
    subject: string,
    message: string,
    opts: { category?: SupportCategory; priority?: SupportPriority } = {},
  ): Observable<ChatThread> {
    return this.api.post<ChatThread>('/support/tickets', { subject, message, ...opts });
  }
  listThreads(
    archived = false,
    filters: { status?: string; search?: string } = {},
  ): Observable<ChatThread[]> {
    const params = new URLSearchParams();
    if (archived) params.set('archived', 'true');
    if (filters.status) params.set('status', filters.status);
    if (filters.search?.trim()) params.set('search', filters.search.trim());
    const q = params.toString();
    return this.api.get<ChatThread[]>(`/support/tickets${q ? `?${q}` : ''}`);
  }
  getMessages(ticketId: string): Observable<{ ticket: ChatThread; messages: ChatMessage[] }> {
    return this.api.get<{ ticket: ChatThread; messages: ChatMessage[] }>(`/support/tickets/${ticketId}/messages`);
  }
  postMessage(
    ticketId: string,
    body: string,
    internalNote = false,
    attachments: UploadedAttachment[] = [],
  ): Observable<ChatMessage> {
    return this.api.post<ChatMessage>(`/support/tickets/${ticketId}/messages`, { body, internalNote, attachments });
  }
  presignAttachment(ticketId: string, filename: string, mime: string): Observable<{ key: string; uploadUrl: string }> {
    return this.api.post<{ key: string; uploadUrl: string }>(`/support/tickets/${ticketId}/attachments/presign`, { filename, mime });
  }
  metrics(): Observable<SupportMetrics> {
    return this.api.get<SupportMetrics>('/support/metrics');
  }
  listAgents(): Observable<SupportAgent[]> {
    return this.api.get<SupportAgent[]>('/support/agents');
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

  // --- Ciclo de vida (agente salvo archive/rate = promotor) ---
  take(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/take`, {});
  }
  resolve(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/resolve`, {});
  }
  suspend(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/suspend`, {});
  }
  resume(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/resume`, {});
  }
  setPriority(ticketId: string, priority: SupportPriority): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/priority`, { priority });
  }
  setCategory(ticketId: string, category: SupportCategory): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/category`, { category });
  }
  archive(ticketId: string): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/archive`, {});
  }
  rate(ticketId: string, score: number): Observable<ChatThread> {
    return this.api.post<ChatThread>(`/support/tickets/${ticketId}/rate`, { score });
  }

  // --- Cola del agente (filtros + keyset) ---
  queue(filters: QueueFilters = {}, cursor?: string, limit = 20): Observable<QueuePage> {
    const p = new URLSearchParams();
    if (filters.status) p.set('status', filters.status);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.category) p.set('category', filters.category);
    if (filters.unassigned) p.set('unassigned', 'true');
    if (filters.mine) p.set('mine', 'true');
    if (cursor) p.set('cursor', cursor);
    p.set('limit', String(limit));
    return this.api.get<QueuePage>(`/support/queue?${p.toString()}`);
  }

  // --- Macros (respuestas rápidas) ---
  listMacros(lang?: string, category?: SupportCategory): Observable<SupportMacro[]> {
    const p = new URLSearchParams();
    if (lang) p.set('lang', lang);
    if (category) p.set('category', category);
    const qs = p.toString();
    return this.api.get<SupportMacro[]>(`/support/macros${qs ? `?${qs}` : ''}`);
  }
  createMacro(input: { title: string; body: string; lang?: string; category?: SupportCategory }): Observable<SupportMacro> {
    return this.api.post<SupportMacro>('/support/macros', input);
  }
  deleteMacro(id: string): Observable<{ deleted: boolean }> {
    return this.api.delete<{ deleted: boolean }>(`/support/macros/${id}`);
  }
}

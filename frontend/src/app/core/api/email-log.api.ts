import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface EmailLogItem {
  id: string;
  recipient: string;
  type: string;
  subject: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}
export interface EmailLogPage {
  items: EmailLogItem[];
  nextCursor: string | null;
}
export interface EmailLogFilters {
  search?: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

/** SDK del registro de correos (admin). Filtros + búsqueda server-side (keyset). */
@Injectable({ providedIn: 'root' })
export class EmailLogApi {
  private readonly api = inject(ApiClient);

  list(f: EmailLogFilters = {}): Observable<EmailLogPage> {
    const p = new URLSearchParams();
    if (f.search) p.set('search', f.search);
    if (f.type) p.set('type', f.type);
    if (f.status) p.set('status', f.status);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (f.cursor) p.set('cursor', f.cursor);
    const q = p.toString();
    return this.api.get<EmailLogPage>(`/admin/email-log${q ? `?${q}` : ''}`);
  }
}

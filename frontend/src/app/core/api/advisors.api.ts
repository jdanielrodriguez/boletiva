import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface AdvisorRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: 'active' | 'inactive' | 'pending';
  disabled: boolean;
  forced: boolean;
  createdAt: string;
}

/** SDK de gestión de asesores (admin): lista + deshabilitar/habilitar/eliminar/notificar. */
@Injectable({ providedIn: 'root' })
export class AdvisorsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<AdvisorRow[]> {
    return this.api.get<AdvisorRow[]>('/advisors');
  }
  disable(id: string): Observable<{ id: string; disabled: boolean }> {
    return this.api.post(`/advisors/${id}/disable`, {});
  }
  enable(id: string): Observable<{ id: string; enabled: boolean }> {
    return this.api.post(`/advisors/${id}/enable`, {});
  }
  remove(id: string): Observable<{ id: string; removed: boolean }> {
    return this.api.delete(`/advisors/${id}`);
  }
  notify(id: string, title: string, body: string): Observable<{ id: string; notified: boolean }> {
    return this.api.post(`/advisors/${id}/notify`, { title, body });
  }
}

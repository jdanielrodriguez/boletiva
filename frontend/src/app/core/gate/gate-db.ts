import { Injectable } from '@angular/core';

/** Boleto tal como se guarda del manifiesto (secreto TOTP en claro = SafeTix). */
export interface GateTicket {
  serial: string;
  status: string; // valid | used | revoked | transferred
  totpSecret: string;
}

/** Un check-in pendiente de subir (cola offline → ingest por RabbitMQ al reconectar). */
export interface QueuedCheckin {
  serial: string;
  at: string; // ISO
}

const DB = 'pe-gate';
const VERSION = 1;
const S_TICKETS = 'tickets';
const S_QUEUE = 'queue';
const S_META = 'meta';

/**
 * Persistencia OFFLINE-FIRST de la puerta (IndexedDB). Guarda el manifiesto SafeTix
 * (boletos + secreto TOTP), la cola local de check-ins pendientes de subir y metadatos
 * (evento, expiración, gate-token). Sobrevive recargas y pérdida de red: el validador
 * escanea contra IndexedDB sin conexión y los check-ins se drenan al endpoint de lote
 * (RabbitMQ) cuando vuelve el internet. SSR-safe: sin `indexedDB` resuelve no-ops.
 */
@Injectable({ providedIn: 'root' })
export class GateDb {
  private dbp?: Promise<IDBDatabase | null>;

  private open(): Promise<IDBDatabase | null> {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(S_TICKETS)) db.createObjectStore(S_TICKETS, { keyPath: 'serial' });
        if (!db.objectStoreNames.contains(S_QUEUE)) db.createObjectStore(S_QUEUE, { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains(S_META)) db.createObjectStore(S_META, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return this.dbp;
  }

  private tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    return this.open().then(
      (db) =>
        new Promise<T | null>((resolve) => {
          if (!db) return resolve(null);
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
        }),
    );
  }

  /** Reemplaza el manifiesto guardado del evento (boletos + metadatos). */
  async saveManifest(
    eventId: string,
    tickets: GateTicket[],
    meta: { expiresAt: string; gateToken: string; eventName: string },
  ): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const t = db.transaction([S_TICKETS, S_META], 'readwrite');
      const ts = t.objectStore(S_TICKETS);
      ts.clear();
      for (const tk of tickets) ts.put(tk);
      t.objectStore(S_META).put({ key: `event:${eventId}`, eventId, ...meta });
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    });
  }

  getTicket(serial: string): Promise<GateTicket | null> {
    return this.tx<GateTicket>(S_TICKETS, 'readonly', (s) => s.get(serial));
  }

  async setStatus(serial: string, status: string): Promise<void> {
    const tk = await this.getTicket(serial);
    if (!tk) return;
    await this.tx(S_TICKETS, 'readwrite', (s) => s.put({ ...tk, status }));
  }

  getMeta(eventId: string): Promise<{ expiresAt: string; gateToken: string; eventName: string } | null> {
    return this.tx(S_META, 'readonly', (s) => s.get(`event:${eventId}`)) as Promise<{
      expiresAt: string;
      gateToken: string;
      eventName: string;
    } | null>;
  }

  ticketCount(): Promise<number | null> {
    return this.tx<number>(S_TICKETS, 'readonly', (s) => s.count());
  }

  async enqueue(item: QueuedCheckin): Promise<void> {
    await this.tx(S_QUEUE, 'readwrite', (s) => s.add(item));
  }

  queueCount(): Promise<number | null> {
    return this.tx<number>(S_QUEUE, 'readonly', (s) => s.count());
  }

  /** Devuelve todos los check-ins encolados (para subirlos en lote). */
  async allQueued(): Promise<QueuedCheckin[]> {
    const rows = await this.tx<QueuedCheckin[]>(S_QUEUE, 'readonly', (s) => s.getAll());
    return rows ?? [];
  }

  /** Vacía la cola (tras un ingest exitoso; el endpoint es idempotente). */
  async clearQueue(): Promise<void> {
    await this.tx(S_QUEUE, 'readwrite', (s) => s.clear());
  }
}

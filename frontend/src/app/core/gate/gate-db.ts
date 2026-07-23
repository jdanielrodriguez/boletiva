import { Injectable } from '@angular/core';

/** Boleto tal como se guarda del manifiesto (secreto TOTP en claro = SafeTix). */
export interface GateTicket {
  serial: string;
  status: string; // valid | used | revoked | transferred
  totpSecret: string;
}

/** Un check-in pendiente de subir (cola offline → ingest por RabbitMQ al reconectar). */
export interface QueuedCheckin {
  /** Clave autoincremental de IndexedDB (presente al leer con allQueued). */
  id?: number;
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
    meta: { expiresAt: string; gateToken: string; eventName: string; maxSeq: number },
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

  /**
   * Aplica un DELTA de sincronización (pull incremental por `since`): actualiza (upsert) el
   * estado y el secreto TOTP de los boletos cambiados —revocados/transferidos/usados desde la
   * última descarga— y avanza `maxSeq`/`expiresAt` SIN borrar el resto. Así un boleto
   * reembolsado deja de dar verde aunque el manifiesto inicial lo trajera como válido (QA).
   */
  async applyDelta(
    eventId: string,
    tickets: GateTicket[],
    patch: { maxSeq: number; expiresAt: string },
  ): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const t = db.transaction([S_TICKETS, S_META], 'readwrite');
      const ts = t.objectStore(S_TICKETS);
      for (const tk of tickets) ts.put(tk); // overwrite por serial (keyPath)
      const metaStore = t.objectStore(S_META);
      const getReq = metaStore.get(`event:${eventId}`);
      getReq.onsuccess = () => {
        const prev = (getReq.result as Record<string, unknown>) ?? { key: `event:${eventId}`, eventId };
        metaStore.put({ ...prev, ...patch });
      };
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

  getMeta(
    eventId: string,
  ): Promise<{ expiresAt: string; gateToken: string; eventName: string; maxSeq?: number } | null> {
    return this.tx(S_META, 'readonly', (s) => s.get(`event:${eventId}`)) as Promise<{
      expiresAt: string;
      gateToken: string;
      eventName: string;
      maxSeq?: number;
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

  /** Vacía la cola completa (solo para reset; el drenaje normal borra por id). */
  async clearQueue(): Promise<void> {
    await this.tx(S_QUEUE, 'readwrite', (s) => s.clear());
  }

  /**
   * Borra SOLO los check-ins ya confirmados por su id (idempotente). Clave para no
   * perder datos: si se encolan nuevos check-ins MIENTRAS se drena un lote, un
   * `clear()` los borraría; borrar por id elimina únicamente lo que ya se subió.
   */
  async deleteQueued(ids: number[]): Promise<void> {
    const valid = ids.filter((id): id is number => typeof id === 'number');
    if (!valid.length) return;
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const t = db.transaction(S_QUEUE, 'readwrite');
      const s = t.objectStore(S_QUEUE);
      for (const id of valid) s.delete(id);
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    });
  }
}

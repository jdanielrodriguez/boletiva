import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

/**
 * Prueba de carga del on-sale: spike de VUs que reservan (hold) y compran
 * (commit) asientos de un pool CONTENDIDO. Demuestra que bajo alta concurrencia:
 *  - no hay errores 5xx (el commit siempre responde 201/409/503, nunca 500),
 *  - solo se vende cada asiento UNA vez (verificación posterior en Postgres),
 *  - latencias dentro de umbral (p95 hold<500ms, p95 checkout<2500ms).
 *
 * Parámetros por entorno:
 *   VUS       (default 200)    usuarios virtuales pico
 *   DURATION  (default 20s)    meseta del pico
 *   HOT       (default 500)    tamaño del pool contendido (fuerza colisiones)
 *
 * Ejecutar (staging real): VUS=10000 DURATION=5s make load-test
 */
const VUS = Number(__ENV.VUS || 200);
const DURATION = __ENV.DURATION || '20s';

// El manifiesto lo genera prisma/seed-stadium.ts (mismo directorio).
const manifest = JSON.parse(open('./stadium.manifest.json'));
const HOT = Math.min(Number(__ENV.HOT || 500), manifest.seatIds.length);

// Cargar seatIds una sola vez y compartirlos entre VUs (eficiente en memoria).
const seatPool = new SharedArray('seats', () => manifest.seatIds.slice(0, HOT));

const holdDur = new Trend('hold_duration', true);
const checkoutDur = new Trend('checkout_duration', true);
const checkoutOk = new Counter('checkout_ok');
const conflicts = new Counter('checkout_conflict');
const serverErrors = new Counter('server_errors');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: VUS }, // subida rápida (spike)
        { duration: DURATION, target: VUS }, // meseta
        { duration: '5s', target: 0 }, // bajada
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    server_errors: ['count==0'], // CERO 5xx
    hold_duration: ['p(95)<500'],
    checkout_duration: ['p(95)<2500'],
    checks: ['rate>0.99'],
  },
};

// Login del pool con dispositivo confiable (sin 2FA). Devuelve tokens.
export function setup() {
  const tokens = [];
  for (const b of manifest.buyers) {
    const res = http.post(
      `${manifest.baseUrl}/auth/login`,
      JSON.stringify({ email: b.email, password: 'Password123' }),
      { headers: { 'Content-Type': 'application/json', 'X-Device-Id': b.deviceId } },
    );
    const token = res.json('tokens.accessToken');
    if (token) tokens.push(token);
  }
  if (tokens.length === 0) throw new Error('setup: no se obtuvo ningún token de login');
  return { tokens };
}

export default function (data) {
  const token = data.tokens[Math.floor(Math.random() * data.tokens.length)];
  const seatId = seatPool[Math.floor(Math.random() * seatPool.length)];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const body = JSON.stringify({ seatIds: [seatId] });
  const base = `${manifest.baseUrl}/events/${manifest.eventId}`;

  const hold = http.post(`${base}/holds`, body, { headers });
  holdDur.add(hold.timings.duration);

  const co = http.post(`${base}/orders`, body, { headers });
  checkoutDur.add(co.timings.duration);

  if (co.status === 201) checkoutOk.add(1);
  else if (co.status === 409) conflicts.add(1);
  else if (co.status >= 500) serverErrors.add(1);

  check(co, { 'checkout sin 5xx': (r) => r.status < 500 });
}

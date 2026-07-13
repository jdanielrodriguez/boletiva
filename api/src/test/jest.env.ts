// Setup de entorno para los tests (se ejecuta antes de cargar los módulos).
//
// Fuerza NODE_ENV=test ANTES de que se cargue la configuración (config lee
// process.env al importar los módulos). El contenedor corre con NODE_ENV=development
// y jest NO lo sobreescribe si ya está definido → sin esto, `env !== 'test'` deja
// ACTIVO el auto-confirm con jitter del simulador (`PAYMENT_SIMULATOR_AUTO_CONFIRM`),
// que a los 1.5–4s dispara un `payment.succeeded` diferido: éste re-ejecuta `fulfill`
// sobre órdenes ya reembolsadas y las resucita a `paid` → flaky cross-suite en las
// e2e de reembolsos. El auto-confirm debe estar SIEMPRE OFF en test (intención
// documentada); forzar el env aquí lo garantiza en cualquier entorno de ejecución.
process.env.NODE_ENV = 'test';
// Fuerza las colas en modo INLINE: los jobs corren síncronos → E2E deterministas
// y sin workers de BullMQ dejando handles abiertos. En dev/prod queda async.
process.env.QUEUE_INLINE = process.env.QUEUE_INLINE ?? 'true';
// Ingest de validación (RabbitMQ) también inline en tests: aplicación síncrona,
// sin consumidor AMQP dejando handles abiertos.
process.env.RABBIT_INLINE = process.env.RABBIT_INLINE ?? 'true';

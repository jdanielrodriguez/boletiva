// Setup de entorno para los tests (se ejecuta antes de cargar los módulos).
// Fuerza las colas en modo INLINE: los jobs corren síncronos → E2E deterministas
// y sin workers de BullMQ dejando handles abiertos. En dev/prod queda async.
process.env.QUEUE_INLINE = process.env.QUEUE_INLINE ?? 'true';
// Ingest de validación (RabbitMQ) también inline en tests: aplicación síncrona,
// sin consumidor AMQP dejando handles abiertos.
process.env.RABBIT_INLINE = process.env.RABBIT_INLINE ?? 'true';

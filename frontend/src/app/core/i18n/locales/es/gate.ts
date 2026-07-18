/** PWA de validación en puerta (F4). Español. */
export const gate = {
  invalidTitle: 'Enlace no válido',
  linkInvalid: 'El enlace de validación no es válido o venció. Pide al organizador que te reenvíe el acceso.',
  welcomeTitle: 'Validación en puerta',
  welcomeAs: 'Ingresaste como <strong>{{email}}</strong>.',
  welcomeHint: 'Vas a escanear los boletos con la cámara. Funciona sin internet una vez cargado el evento.',
  start: 'Comenzar',
  preparing: 'Preparando el evento…',
  claimFailed: 'No se pudo abrir el validador. Reintenta o pide un nuevo enlace.',
  manifestFailed: 'No se pudo descargar la lista de boletos. Revisa tu conexión e intenta de nuevo.',
  // Cámara (obligatoria)
  cameraNeededTitle: 'Necesitamos la cámara',
  cameraDenied: 'No se pudo acceder a la cámara. Concede el permiso para escanear los boletos.',
  cameraUnsupported: 'Este dispositivo/navegador no permite usar la cámara. Prueba en Chrome.',
  cameraNeededHint: 'Habilita la cámara en el navegador y toca Reintentar. Es indispensable para validar.',
  retryCamera: 'Reintentar',
  // Escaneo
  online: 'En línea',
  offline: 'Sin conexión',
  pending: '{{n}} por sincronizar',
  loaded: '{{n}} boletos cargados',
  manualHint: 'Tu navegador no puede escanear automáticamente. Escribe el contenido del QR:',
  validate: 'Validar',
  // Resultados
  resultOk: 'ACCESO VÁLIDO',
  resultUsed: 'YA VALIDADO',
  resultUnknown: 'BOLETO DESCONOCIDO',
  resultRevoked: 'BOLETO NO VÁLIDO',
  resultBadCode: 'CÓDIGO INVÁLIDO',
  resultBadFormat: 'QR NO RECONOCIDO',
};

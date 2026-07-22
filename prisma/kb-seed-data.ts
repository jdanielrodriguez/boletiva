import { SupportCategory } from '@prisma/client';

export interface KbSeedArticle {
  slug: string;
  question: string;
  answerHtml: string;
  category: SupportCategory;
  tags: string[];
  visibility?: 'public' | 'internal';
  sortOrder?: number;
}

/**
 * Artículos iniciales de la Base de Conocimientos (FAQ público, T6).
 * HTML restringido a la whitelist de `sanitizeRichHtml`
 * (h2,h3,h4,p,br,strong,b,em,i,u,s,ul,ol,li,blockquote,code,pre,a,hr).
 * Idempotente por `slug` al sembrar.
 */
export const KB_SEED_ARTICLES: KbSeedArticle[] = [
  // ---------- Categoría: event (evento, compra, asientos, puerta) ----------
  {
    slug: 'como-compro-boletos-en-boletiva',
    question: '¿Cómo compro boletos en Boletiva?',
    category: 'event',
    tags: ['compra', 'boletos', 'checkout', 'asientos'],
    sortOrder: 1,
    answerHtml:
      '<h3>Comprar es rápido y seguro</h3>' +
      '<p>Comprar tus boletos toma menos de dos minutos. Solo sigue estos pasos:</p>' +
      '<ol>' +
      '<li>Entra al evento que te interesa y toca <strong>Comprar</strong>.</li>' +
      '<li>Elige tus <strong>asientos en el mapa</strong> o la <strong>cantidad</strong> en localidades de admisión general.</li>' +
      '<li>Revisa el desglose (precio del boleto, cuota por servicio e IVA) y elige tu método de pago.</li>' +
      '<li>Confirma el pago. Verás el estado <em>en vivo</em> hasta que se acredite.</li>' +
      '</ol>' +
      '<p>Al finalizar, tus boletos con <strong>QR dinámico</strong> quedan guardados en <em>Mi cuenta</em> y te llegan también por correo. Todos los precios están en <strong>quetzales (Q)</strong>.</p>',
  },
  {
    slug: 'cuanto-tiempo-tengo-para-pagar-reserva',
    question: '¿Cuánto tiempo tengo para completar mi compra?',
    category: 'event',
    tags: ['reserva', 'tiempo', 'hold', 'asientos'],
    sortOrder: 2,
    answerHtml:
      '<p>Cuando eliges tus asientos, los <strong>reservamos temporalmente</strong> para que nadie más los tome mientras pagas. Verás una <strong>cuenta regresiva</strong> en pantalla.</p>' +
      '<h3>Qué debes saber</h3>' +
      '<ul>' +
      '<li>La reserva dura <strong>10 minutos</strong>. Si el tiempo se agota, los asientos se liberan automáticamente y vuelven a estar disponibles para todos.</li>' +
      '<li>No te preocupes: <em>no se cobra nada</em> hasta que confirmes el pago.</li>' +
      '<li>Si se vence, solo vuelve a empezar y elige de nuevo.</li>' +
      '</ul>' +
      '<p>Este mecanismo evita la doble venta y garantiza que el asiento que ves disponible sea realmente tuyo al pagar.</p>',
  },
  {
    slug: 'como-elijo-asientos-en-el-mapa',
    question: '¿Cómo elijo mis asientos en el mapa?',
    category: 'event',
    tags: ['mapa', 'asientos', 'localidad', 'admision-general'],
    sortOrder: 3,
    answerHtml:
      '<p>Los eventos con asiento numerado muestran un <strong>mapa interactivo</strong>. Puedes acercar, alejar y moverte por el recinto para ver la ubicación exacta.</p>' +
      '<ul>' +
      '<li>Toca un asiento <strong>disponible</strong> para seleccionarlo; toca de nuevo para soltarlo.</li>' +
      '<li>Cada localidad muestra su <strong>precio final para el comprador</strong>, ya con la cuota de servicio e IVA incluidos.</li>' +
      '<li>En eventos de <strong>admisión general</strong> no eliges silla: solo indicas la <strong>cantidad</strong> de boletos.</li>' +
      '</ul>' +
      '<p>La disponibilidad se actualiza <em>en tiempo real</em>, así que verás al instante si alguien más toma un asiento.</p>',
  },
  {
    slug: 'que-pasa-si-el-evento-se-cancela-o-cambia',
    question: '¿Qué pasa si el evento se cancela o cambia de fecha?',
    category: 'event',
    tags: ['cancelacion', 'reprogramacion', 'evento', 'reembolso'],
    sortOrder: 4,
    answerHtml:
      '<h3>Estás protegido</h3>' +
      '<p>Si el organizador <strong>cancela</strong> un evento, el importe de tus boletos se acredita a tu <strong>billetera de Boletiva</strong>, listo para usarlo en otra compra o para solicitar su retiro.</p>' +
      '<p>Si el evento se <strong>reprograma</strong>, tus boletos siguen siendo válidos para la nueva fecha sin que hagas nada. Te avisaremos por correo con los detalles.</p>' +
      '<p>Ante cualquier duda, escríbenos desde <em>Soporte</em> y con gusto te ayudamos.</p>',
  },
  {
    slug: 'que-son-las-cortesias-o-boletos-de-invitacion',
    question: '¿Qué son las cortesías o boletos de invitación?',
    category: 'event',
    tags: ['cortesias', 'invitacion', 'gratis'],
    sortOrder: 5,
    answerHtml:
      '<p>Las <strong>cortesías</strong> son boletos que el organizador entrega sin costo, por ejemplo a invitados o prensa.</p>' +
      '<ul>' +
      '<li>Recibirás un <strong>enlace de un solo uso</strong> para reclamar tu cortesía.</li>' +
      '<li>Al reclamarla, el boleto se emite a tu nombre con su <strong>QR dinámico</strong>, igual que un boleto comprado.</li>' +
      '<li>El enlace tiene <strong>vigencia limitada</strong>, así que actívalo cuanto antes.</li>' +
      '</ul>' +
      '<p>Una vez emitida, la cortesía aparece en <em>Mis boletos</em> y se valida en la puerta como cualquier otra.</p>',
  },
  {
    slug: 'como-se-valida-mi-boleto-en-la-puerta',
    question: '¿Cómo se valida mi boleto en la entrada del evento?',
    category: 'event',
    tags: ['puerta', 'validacion', 'ingreso', 'qr'],
    sortOrder: 6,
    answerHtml:
      '<h3>En la puerta, solo muestra tu QR</h3>' +
      '<p>El personal de acceso escanea el <strong>código QR</strong> de tu boleto desde la app de Boletiva o desde tu billetera digital.</p>' +
      '<ul>' +
      '<li>El QR es <strong>dinámico</strong>: cambia constantemente, por lo que una captura de pantalla <strong>no funciona</strong>.</li>' +
      '<li>La validación funciona <strong>sin internet</strong>, así que la fila avanza rápido aunque la señal sea débil.</li>' +
      '<li>Cada boleto se marca como usado en el <strong>primer escaneo</strong>; no se puede ingresar dos veces con el mismo.</li>' +
      '</ul>' +
      '<p>Te recomendamos llevar tu teléfono con batería y el brillo de pantalla alto para agilizar el escaneo.</p>',
  },

  // ---------- Categoría: payments_settlement (pagos, cuotas, liquidación) ----------
  {
    slug: 'que-medios-de-pago-aceptan',
    question: '¿Qué medios de pago aceptan?',
    category: 'payments_settlement',
    tags: ['pago', 'tarjeta', 'cuotas', 'billetera'],
    sortOrder: 1,
    answerHtml:
      '<h3>Varias formas de pagar</h3>' +
      '<p>En Boletiva puedes pagar con:</p>' +
      '<ul>' +
      '<li><strong>Tarjeta de crédito o débito</strong> (Visa y Mastercard).</li>' +
      '<li><strong>Pago en cuotas</strong> con Visacuotas y Mastercuotas.</li>' +
      '<li><strong>Saldo de tu billetera</strong> de Boletiva, solo o combinado con tarjeta.</li>' +
      '</ul>' +
      '<p>Todos los pagos se procesan con <strong>Recurrente</strong>, nuestra pasarela certificada. Los montos están en <strong>quetzales (Q)</strong>.</p>',
  },
  {
    slug: 'pago-en-cuotas-sin-recargo',
    question: '¿El pago en cuotas tiene recargo?',
    category: 'payments_settlement',
    tags: ['cuotas', 'visacuotas', 'mastercuotas', 'recargo'],
    sortOrder: 2,
    answerHtml:
      '<h3>Cuotas sin costo extra para ti</h3>' +
      '<p>No. Cuando eliges <strong>Visacuotas</strong> o <strong>Mastercuotas</strong>, pagas exactamente el <strong>mismo precio</strong> que si pagaras de contado.</p>' +
      '<p>En Guatemala está <strong>prohibido cobrar recargo</strong> por diferir el pago, así que el costo del financiamiento nunca se traslada al comprador.</p>' +
      '<ul>' +
      '<li>Al pagar, elige el número de cuotas disponible (por ejemplo 3, 6, 12 o 18).</li>' +
      '<li>El total del boleto es idéntico en todos los plazos.</li>' +
      '<li>Los intereses o condiciones del diferido los define tu banco emisor.</li>' +
      '</ul>',
  },
  {
    slug: 'por-que-el-precio-tiene-cuota-de-servicio',
    question: '¿Por qué el precio incluye una cuota por servicio?',
    category: 'payments_settlement',
    tags: ['precio', 'cuota-servicio', 'iva', 'desglose'],
    sortOrder: 3,
    answerHtml:
      '<p>Queremos ser <strong>totalmente transparentes</strong> con lo que pagas. El precio que ves se compone de:</p>' +
      '<ul>' +
      '<li><strong>Precio del boleto</strong>: lo que define el organizador.</li>' +
      '<li><strong>Cuota por servicio</strong>: cubre el procesamiento del pago y la plataforma.</li>' +
      '<li><strong>IVA</strong>: el impuesto de ley (12%).</li>' +
      '</ul>' +
      '<p>Verás el <strong>total final</strong> desde el inicio, sin sorpresas al final. La cuota por servicio puede variar levemente según el método de pago que elijas, y siempre te lo indicamos antes de confirmar.</p>',
  },
  {
    slug: 'puedo-pagar-con-billetera-y-tarjeta-a-la-vez',
    question: '¿Puedo pagar una parte con mi billetera y el resto con tarjeta?',
    category: 'payments_settlement',
    tags: ['billetera', 'pago-mixto', 'tarjeta', 'saldo'],
    sortOrder: 4,
    answerHtml:
      '<h3>Sí, con pago mixto</h3>' +
      '<p>Si tu <strong>saldo de billetera</strong> no alcanza para cubrir toda la compra, puedes combinarlo con tarjeta:</p>' +
      '<ul>' +
      '<li>Aplicamos primero tu saldo disponible.</li>' +
      '<li>El resto se cobra a la <strong>tarjeta</strong> que elijas.</li>' +
      '</ul>' +
      '<p>Si tu saldo cubre el total, la compra se <strong>confirma al instante</strong> sin pasar por la pasarela. Todo el proceso es automático: solo elige <em>usar billetera</em> al pagar.</p>',
  },
  {
    slug: 'cuando-recibe-su-dinero-el-organizador',
    question: '¿Cuándo recibe su dinero el organizador del evento?',
    category: 'payments_settlement',
    tags: ['liquidacion', 'promotor', 'pago', 'organizador'],
    sortOrder: 5,
    answerHtml:
      '<p>Si eres <strong>organizador (promotor)</strong>, el dinero de tus ventas se acumula en tu <strong>saldo liquidable</strong> dentro de Boletiva.</p>' +
      '<ul>' +
      '<li>Cada venta registra tu <strong>neto</strong> (precio del boleto menos las comisiones acordadas) en el libro contable.</li>' +
      '<li>Puedes solicitar el <strong>retiro</strong> de tu saldo desde tu panel; un administrador lo aprueba y liquida.</li>' +
      '<li>Todo movimiento queda registrado de forma <strong>inalterable</strong> para tu total trazabilidad.</li>' +
      '</ul>' +
      '<p>Consulta tus ingresos y el detalle por evento en la sección de <em>facturación</em> de tu panel.</p>',
  },

  // ---------- Categoría: billing (facturación, FEL, NIT/CF, reembolsos, retiros) ----------
  {
    slug: 'como-facturo-mi-compra-fel',
    question: '¿Cómo obtengo mi factura (FEL)?',
    category: 'billing',
    tags: ['factura', 'fel', 'nit', 'comprobante'],
    sortOrder: 1,
    answerHtml:
      '<h3>Factura electrónica automática</h3>' +
      '<p>Boletiva emite <strong>Factura Electrónica en Línea (FEL)</strong> por tus compras, conforme a la SAT de Guatemala.</p>' +
      '<ul>' +
      '<li>Al pagar, ingresa tu <strong>NIT</strong> y el nombre de facturación.</li>' +
      '<li>Si no colocas NIT, la factura se emite a <strong>Consumidor Final (CF)</strong>.</li>' +
      '<li>Recibirás la factura por <strong>correo</strong> y podrás consultarla en <em>Mi cuenta</em>.</li>' +
      '</ul>' +
      '<p>Los datos fiscales quedan asociados a esa compra para tu respaldo.</p>',
  },
  {
    slug: 'que-significa-cf-consumidor-final',
    question: '¿Qué significa facturar a CF (Consumidor Final)?',
    category: 'billing',
    tags: ['cf', 'consumidor-final', 'nit', 'factura'],
    sortOrder: 2,
    answerHtml:
      '<p><strong>CF</strong> significa <em>Consumidor Final</em>. Es la opción que se usa cuando no necesitas la factura a nombre de una persona o empresa específica.</p>' +
      '<ul>' +
      '<li>Si dejas el campo de NIT vacío o escribes <strong>CF</strong>, la factura se emite a Consumidor Final.</li>' +
      '<li>Si necesitas la factura con tus datos fiscales, ingresa tu <strong>NIT</strong> y el <strong>nombre</strong> correspondiente.</li>' +
      '</ul>' +
      '<p>Puedes guardar tu NIT en tu perfil para que aparezca <strong>precargado</strong> en tus próximas compras.</p>',
  },
  {
    slug: 'como-funcionan-los-reembolsos',
    question: '¿Cómo funcionan los reembolsos?',
    category: 'billing',
    tags: ['reembolso', 'devolucion', 'billetera', 'cancelacion'],
    sortOrder: 3,
    answerHtml:
      '<h3>Reembolsos a tu billetera</h3>' +
      '<p>Cuando corresponde un reembolso (por ejemplo, un evento cancelado), el importe se acredita a tu <strong>billetera de Boletiva</strong>.</p>' +
      '<p>Desde ahí puedes:</p>' +
      '<ul>' +
      '<li><strong>Usarlo</strong> en tu próxima compra de boletos.</li>' +
      '<li><strong>Solicitar su retiro</strong> a tu cuenta bancaria.</li>' +
      '</ul>' +
      '<p>El boleto reembolsado queda <strong>anulado</strong> de inmediato y ya no sirve para ingresar. Para casos especiales, escríbenos desde <em>Soporte</em>.</p>',
  },
  {
    slug: 'como-retiro-el-saldo-de-mi-billetera',
    question: '¿Cómo retiro el saldo de mi billetera?',
    category: 'billing',
    tags: ['retiro', 'billetera', 'saldo', 'banco'],
    sortOrder: 4,
    answerHtml:
      '<h3>Retirar tu saldo</h3>' +
      '<p>Puedes pasar el saldo de tu billetera a tu cuenta bancaria en unos pasos:</p>' +
      '<ol>' +
      '<li>Ve a tu <strong>billetera</strong> y toca <em>Solicitar retiro</em>.</li>' +
      '<li>Indica el <strong>monto</strong> y tus datos bancarios.</li>' +
      '<li>Un administrador <strong>revisa y aprueba</strong> la solicitud, y luego se realiza el pago.</li>' +
      '</ol>' +
      '<p>El retiro tiene una pequeña <strong>comisión</strong> que se muestra antes de confirmar. Puedes cancelar una solicitud mientras siga <em>pendiente</em> y el saldo se reintegra.</p>',
  },
  {
    slug: 'necesito-cambiar-los-datos-de-mi-factura',
    question: '¿Puedo cambiar los datos de una factura ya emitida?',
    category: 'billing',
    tags: ['factura', 'correccion', 'datos-fiscales', 'nit'],
    sortOrder: 5,
    answerHtml:
      '<p>Una factura FEL ya <strong>certificada por la SAT</strong> no puede editarse directamente. Si detectas un error en el NIT o el nombre:</p>' +
      '<ul>' +
      '<li>Escríbenos desde <em>Soporte</em> lo antes posible con el <strong>número de orden</strong> y los datos correctos.</li>' +
      '<li>Evaluaremos emitir la <strong>corrección</strong> según lo que permita la normativa vigente.</li>' +
      '</ul>' +
      '<p>Para evitarlo, revisa siempre tu <strong>NIT y nombre</strong> antes de confirmar el pago. Guardar tus datos fiscales en el perfil ayuda a que siempre salgan correctos.</p>',
  },

  // ---------- Categoría: technical (boletos dinámicos, QR, wallet, offline) ----------
  {
    slug: 'que-es-un-boleto-dinamico-con-qr-rotativo',
    question: '¿Qué es un boleto dinámico y por qué el QR cambia?',
    category: 'technical',
    tags: ['qr', 'dinamico', 'seguridad', 'boleto'],
    sortOrder: 1,
    answerHtml:
      '<h3>Tu boleto es imposible de clonar</h3>' +
      '<p>Cada boleto de Boletiva lleva un <strong>QR dinámico</strong> que se regenera constantemente, parecido a los códigos de una app de autenticación.</p>' +
      '<ul>' +
      '<li>Una <strong>captura de pantalla</strong> caduca en segundos y no sirve en la puerta.</li>' +
      '<li>El código está <strong>firmado criptográficamente</strong>, por lo que no puede falsificarse.</li>' +
      '<li>Se valida <strong>sin conexión a internet</strong>, así que el ingreso es rápido incluso sin señal.</li>' +
      '</ul>' +
      '<p>Esto protege tanto al comprador como al organizador contra la reventa fraudulenta y las entradas duplicadas.</p>',
  },
  {
    slug: 'puedo-guardar-mi-boleto-en-google-o-apple-wallet',
    question: '¿Puedo guardar mi boleto en Google Wallet o Apple Wallet?',
    category: 'technical',
    tags: ['wallet', 'google-wallet', 'apple-wallet', 'pase'],
    sortOrder: 2,
    answerHtml:
      '<p>Sí. Además de verlos en la app, puedes agregar tus boletos a tu billetera digital:</p>' +
      '<ul>' +
      '<li><strong>Google Wallet</strong> en Android.</li>' +
      '<li><strong>Apple Wallet</strong> en iPhone.</li>' +
      '</ul>' +
      '<p>El pase guardado también muestra el <strong>QR dinámico</strong> y se actualiza automáticamente. Así tienes tu entrada a mano incluso sin abrir la aplicación.</p>' +
      '<p>Busca el botón <em>Agregar a la billetera</em> en el detalle de cada boleto.</p>',
  },
  {
    slug: 'como-descargo-el-pdf-de-mi-boleto',
    question: '¿Cómo descargo el PDF o la imagen de mi boleto?',
    category: 'technical',
    tags: ['pdf', 'descarga', 'boleto', 'qr'],
    sortOrder: 3,
    answerHtml:
      '<p>Desde <em>Mis boletos</em>, abre el boleto que quieras y elige <strong>Descargar</strong>. Generamos:</p>' +
      '<ul>' +
      '<li>Un <strong>PDF</strong> con los datos del evento y el QR.</li>' +
      '<li>Una <strong>imagen</strong> del código QR.</li>' +
      '</ul>' +
      '<blockquote>Recuerda que el QR es dinámico: para entrar, la forma más segura es mostrar el boleto desde la <strong>app</strong> o tu <strong>billetera digital</strong>, no una captura estática.</blockquote>',
  },
  {
    slug: 'no-me-llego-el-correo-con-mis-boletos',
    question: 'No me llegó el correo con mis boletos, ¿qué hago?',
    category: 'technical',
    tags: ['correo', 'boletos', 'no-llego', 'problema'],
    sortOrder: 4,
    answerHtml:
      '<h3>Primero, no te preocupes</h3>' +
      '<p>Tus boletos <strong>siempre</strong> quedan disponibles en <em>Mi cuenta &gt; Mis boletos</em>, aunque el correo se demore.</p>' +
      '<p>Si aún así no ves el correo:</p>' +
      '<ol>' +
      '<li>Revisa las carpetas de <strong>spam</strong> o <em>promociones</em>.</li>' +
      '<li>Verifica que tu <strong>correo</strong> esté bien escrito en tu perfil.</li>' +
      '<li>Confirma que el pago aparezca como <strong>pagado</strong> en tu historial.</li>' +
      '</ol>' +
      '<p>Si todo está correcto y sigues sin verlos, escríbenos desde <em>Soporte</em> con tu número de orden.</p>',
  },
  {
    slug: 'la-pagina-no-carga-o-el-pago-se-queda-pendiente',
    question: 'La página no carga bien o mi pago se queda "pendiente"',
    category: 'technical',
    tags: ['error', 'pendiente', 'navegador', 'soporte'],
    sortOrder: 5,
    answerHtml:
      '<p>Un pago puede quedar unos instantes en <strong>pendiente</strong> mientras el banco lo confirma; la pantalla se actualiza <em>sola</em> cuando se acredita. Espera unos segundos antes de reintentar para no duplicar el cobro.</p>' +
      '<h3>Si la página falla</h3>' +
      '<ul>' +
      '<li>Actualiza y prueba con la <strong>última versión</strong> de tu navegador (Chrome, Safari, Edge).</li>' +
      '<li>Desactiva bloqueadores o extensiones que interfieran.</li>' +
      '<li>Revisa tu <strong>conexión a internet</strong>.</li>' +
      '</ul>' +
      '<p>Si el problema continúa, escríbenos desde <em>Soporte</em> describiendo qué pasó y con qué dispositivo.</p>',
  },

  // ---------- Categoría: account (cuenta, 2FA, transferencias, ser promotor) ----------
  {
    slug: 'como-creo-mi-cuenta',
    question: '¿Cómo creo mi cuenta en Boletiva?',
    category: 'account',
    tags: ['registro', 'cuenta', 'correo', 'verificacion'],
    sortOrder: 1,
    answerHtml:
      '<h3>Crear tu cuenta es gratis</h3>' +
      '<p>Puedes registrarte de varias formas:</p>' +
      '<ul>' +
      '<li>Con tu <strong>correo y contraseña</strong>.</li>' +
      '<li>Con un <strong>enlace mágico</strong> o código enviado a tu correo (sin contraseña).</li>' +
      '<li>Con tu cuenta de <strong>Google</strong>.</li>' +
      '</ul>' +
      '<p>Para comprar, crear eventos o transferir boletos necesitas <strong>verificar tu correo</strong>. Mientras tanto, puedes explorar el catálogo libremente. Al registrarte aceptas nuestros <strong>Términos y Condiciones</strong>.</p>',
  },
  {
    slug: 'que-es-la-verificacion-en-dos-pasos-2fa',
    question: '¿Qué es la verificación en dos pasos (2FA) y por qué la piden?',
    category: 'account',
    tags: ['2fa', 'seguridad', 'codigo', 'totp'],
    sortOrder: 2,
    answerHtml:
      '<h3>Una capa extra de seguridad</h3>' +
      '<p>La <strong>verificación en dos pasos (2FA)</strong> protege tu cuenta pidiendo un código adicional al iniciar sesión desde un <strong>dispositivo nuevo</strong>.</p>' +
      '<ul>' +
      '<li>Puedes recibir el código por <strong>correo</strong>.</li>' +
      '<li>O usar una <strong>app de autenticación</strong> (TOTP), configurándola con un código QR desde <em>Mi cuenta</em>.</li>' +
      '</ul>' +
      '<p>Los dispositivos que ya verificaste quedan como <strong>de confianza</strong> y no vuelven a pedirte el código. Así, aunque alguien conozca tu contraseña, no podrá entrar sin ese segundo factor.</p>',
  },
  {
    slug: 'olvide-mi-contrasena',
    question: 'Olvidé mi contraseña, ¿cómo la recupero?',
    category: 'account',
    tags: ['contrasena', 'recuperar', 'reset', 'acceso'],
    sortOrder: 3,
    answerHtml:
      '<p>Recuperar el acceso es sencillo:</p>' +
      '<ol>' +
      '<li>En la pantalla de inicio de sesión, toca <strong>¿Olvidaste tu contraseña?</strong></li>' +
      '<li>Ingresa tu <strong>correo</strong> y te enviaremos un enlace para restablecerla.</li>' +
      '<li>Crea una <strong>contraseña nueva</strong> y vuelve a ingresar.</li>' +
      '</ol>' +
      '<p>Por seguridad, el enlace <strong>caduca</strong> tras un tiempo. Si no lo recibes, revisa spam o solicita uno nuevo. También puedes entrar con un <em>enlace mágico</em> sin contraseña.</p>',
  },
  {
    slug: 'como-transfiero-un-boleto-a-otra-persona',
    question: '¿Cómo transfiero un boleto a otra persona?',
    category: 'account',
    tags: ['transferencia', 'regalo', 'boleto', 'codigo'],
    sortOrder: 4,
    answerHtml:
      '<h3>Regala o cede tus boletos con seguridad</h3>' +
      '<p>Desde <em>Mis boletos</em> puedes transferir un boleto así:</p>' +
      '<ol>' +
      '<li>Elige el boleto y toca <strong>Transferir</strong>.</li>' +
      '<li>Te damos un <strong>código de transferencia</strong> que se muestra una sola vez.</li>' +
      '<li>Compártelo con la otra persona (que también debe tener cuenta verificada).</li>' +
      '<li>Al reclamarlo, el boleto se <strong>re-emite</strong> a su nombre y el QR anterior <strong>deja de servir</strong>.</li>' +
      '</ol>' +
      '<p>Cada movimiento queda registrado en una <strong>bitácora inalterable</strong>. El organizador puede definir un <strong>límite</strong> de transferencias por boleto.</p>',
  },
  {
    slug: 'como-me-convierto-en-promotor-organizador',
    question: '¿Cómo me convierto en promotor para vender mis eventos?',
    category: 'account',
    tags: ['promotor', 'organizador', 'vender', 'eventos'],
    sortOrder: 5,
    answerHtml:
      '<h3>Vende tus eventos con Boletiva</h3>' +
      '<p>Cualquier usuario puede solicitar ser <strong>promotor (organizador)</strong>:</p>' +
      '<ol>' +
      '<li>Entra a la sección <strong>Conviértete en promotor</strong> y elige un plan.</li>' +
      '<li>Completa tu solicitud; un <strong>administrador</strong> la revisa y aprueba.</li>' +
      '<li>Al aprobarse, tendrás acceso al <strong>panel de promotor</strong> para crear eventos, definir localidades y precios, y ver tus ventas.</li>' +
      '</ol>' +
      '<p>Puedes empezar en <strong>modo de pruebas</strong> para conocer la plataforma antes de vender de verdad. ¿Dudas? Escríbenos desde <em>Soporte</em>.</p>',
  },
  {
    slug: 'como-administro-mis-dispositivos-de-confianza',
    question: '¿Cómo veo y administro mis dispositivos de confianza?',
    category: 'account',
    tags: ['dispositivos', 'seguridad', 'sesiones', '2fa'],
    sortOrder: 6,
    answerHtml:
      '<p>Boletiva lleva registro de los dispositivos desde los que inicias sesión, para avisarte si hay un acceso <strong>desconocido</strong>.</p>' +
      '<ul>' +
      '<li>Desde <em>Mi cuenta</em> puedes ver la <strong>lista de dispositivos</strong> reconocidos.</li>' +
      '<li>Puedes <strong>revocar</strong> cualquiera que no reconozcas; en su próximo intento se le pedirá 2FA de nuevo.</li>' +
      '<li>Recibirás un <strong>correo de aviso</strong> cada vez que se use un dispositivo nuevo.</li>' +
      '</ul>' +
      '<p>Si ves actividad sospechosa, revoca el dispositivo y cambia tu contraseña de inmediato.</p>',
  },

  // ---------- Categoría: other (general, soporte, privacidad, idioma) ----------
  {
    slug: 'que-es-boletiva',
    question: '¿Qué es Boletiva?',
    category: 'other',
    tags: ['boletiva', 'plataforma', 'boletos', 'eventos'],
    sortOrder: 1,
    answerHtml:
      '<h3>La boletera de nueva generación</h3>' +
      '<p><strong>Boletiva</strong> es una plataforma guatemalteca para <strong>comprar y vender boletos</strong> de eventos: conciertos, teatro, deportes y más.</p>' +
      '<p>Nos diferencia la tecnología:</p>' +
      '<ul>' +
      '<li>Boletos con <strong>QR dinámico</strong> imposibles de clonar.</li>' +
      '<li>Validación <strong>offline</strong> y rápida en la puerta.</li>' +
      '<li><strong>Precios transparentes</strong> en quetzales, sin cargos escondidos.</li>' +
      '<li><strong>Billetera interna</strong>, transferencias seguras y facturación FEL.</li>' +
      '</ul>' +
      '<p>Nuestra misión es que comprar tu entrada sea tan emocionante como el evento mismo.</p>',
  },
  {
    slug: 'como-contacto-a-soporte',
    question: '¿Cómo contacto al equipo de soporte?',
    category: 'other',
    tags: ['soporte', 'ayuda', 'contacto', 'ticket'],
    sortOrder: 2,
    answerHtml:
      '<h3>Estamos para ayudarte</h3>' +
      '<p>Puedes abrir un <strong>ticket de soporte</strong> desde la sección <em>Soporte</em> de tu cuenta. Cuéntanos qué necesitas y te responderemos lo antes posible.</p>' +
      '<p>Para agilizar tu caso, incluye:</p>' +
      '<ul>' +
      '<li>El <strong>número de orden</strong> o del boleto involucrado.</li>' +
      '<li>Una descripción clara de lo que sucede.</li>' +
      '<li>Capturas de pantalla si aplica.</li>' +
      '</ul>' +
      '<p>Antes de escribir, revisa estas <strong>preguntas frecuentes</strong>: quizás encuentres la respuesta al instante.</p>',
  },
  {
    slug: 'es-seguro-comprar-en-boletiva',
    question: '¿Es seguro comprar y pagar en Boletiva?',
    category: 'other',
    tags: ['seguridad', 'pago', 'privacidad', 'confianza'],
    sortOrder: 3,
    answerHtml:
      '<h3>Tu seguridad es prioridad</h3>' +
      '<p>Sí. Protegemos tu compra y tus datos con varias capas:</p>' +
      '<ul>' +
      '<li>Pagos procesados por <strong>Recurrente</strong>, pasarela certificada; Boletiva <strong>no almacena</strong> los datos de tu tarjeta.</li>' +
      '<li>Conexión cifrada y <strong>verificación en dos pasos</strong> para tu cuenta.</li>' +
      '<li>Boletos <strong>firmados criptográficamente</strong> e imposibles de falsificar.</li>' +
      '<li>Un <strong>registro contable inalterable</strong> de cada transacción.</li>' +
      '</ul>' +
      '<p>Compra siempre desde el sitio o la app oficial de Boletiva.</p>',
  },
  {
    slug: 'en-que-moneda-y-idioma-funciona-boletiva',
    question: '¿En qué moneda e idioma funciona Boletiva?',
    category: 'other',
    tags: ['moneda', 'quetzales', 'idioma', 'guatemala'],
    sortOrder: 4,
    answerHtml:
      '<p>Boletiva opera en <strong>Guatemala</strong>:</p>' +
      '<ul>' +
      '<li>Todos los precios están en <strong>quetzales (Q / GTQ)</strong>.</li>' +
      '<li>Las fechas y horas usan la zona horaria de <strong>Guatemala</strong>.</li>' +
      '<li>La plataforma está disponible en <strong>español</strong> e <strong>inglés</strong>; puedes cambiar el idioma desde el menú.</li>' +
      '</ul>' +
      '<p>Tu preferencia de idioma se <strong>guarda</strong> en tu perfil para tus próximas visitas.</p>',
  },
  {
    slug: 'como-cuida-boletiva-mis-datos-personales',
    question: '¿Cómo cuida Boletiva mis datos personales?',
    category: 'other',
    tags: ['privacidad', 'datos', 'retencion', 'pii'],
    sortOrder: 5,
    answerHtml:
      '<p>Tratamos tus datos con responsabilidad y solo para brindarte el servicio.</p>' +
      '<ul>' +
      '<li>Tu información de pago la maneja la <strong>pasarela certificada</strong>, no Boletiva.</li>' +
      '<li>Aplicamos políticas de <strong>retención y anonimización</strong>: tras concluir los eventos, tus datos personales se pueden seudonimizar conservando solo la trazabilidad contable requerida.</li>' +
      '<li>Puedes actualizar tu información desde <em>Mi cuenta</em> en cualquier momento.</li>' +
      '</ul>' +
      '<p>Para conocer el detalle, consulta nuestros <strong>Términos y Condiciones</strong> y la política de privacidad.</p>',
  },
];

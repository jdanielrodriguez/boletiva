/**
 * Términos y Condiciones (contenido legal, ESPAÑOL / es-GT). Redactado para una
 * boletera que opera en Guatemala (moneda GTQ, zona America/Guatemala). El
 * componente `Terms` itera `sections` (encabezado + párrafos + viñetas).
 */
export const terms = {
  metaTitle: 'Términos y Condiciones — Pasa Eventos',
  metaDescription:
    'Términos y Condiciones de uso de Pasa Eventos: compra de boletos, reembolsos, transferencias, validación, wallet, promotores y facturación en Guatemala.',
  title: 'Términos y Condiciones',
  lastUpdated: 'Última actualización: 10 de julio de 2026',
  intro:
    'Estos Términos y Condiciones (los «Términos») regulan el acceso y uso de la plataforma Pasa Eventos, un servicio de venta y validación de boletos para eventos en Guatemala. Al crear una cuenta, comprar un boleto o utilizar cualquier función de la plataforma, aceptas estos Términos en su totalidad. Si no estás de acuerdo, por favor no utilices el servicio.',
  tocTitle: 'Contenido',
  sections: [
    {
      id: 'plataforma',
      heading: '1. La plataforma y su objeto',
      paragraphs: [
        'Pasa Eventos es una plataforma tecnológica que permite a organizadores de eventos («promotores») publicar y vender boletos, y a los usuarios («compradores») adquirirlos, recibirlos, transferirlos y presentarlos para su validación en el acceso al evento.',
        'Pasa Eventos actúa como intermediario tecnológico entre el promotor y el comprador. El promotor es el único responsable de la realización, contenido, calidad, fechas, horarios y condiciones del evento. Pasa Eventos no organiza los eventos ni garantiza su celebración.',
      ],
    },
    {
      id: 'definiciones',
      heading: '2. Definiciones',
      paragraphs: ['Para efectos de estos Términos:'],
      bullets: [
        'Comprador: persona que adquiere uno o más boletos a través de la plataforma.',
        'Promotor: persona o empresa autorizada que publica un evento y vende boletos a través de la plataforma.',
        'Boleto: derecho de acceso a un evento, representado por un código digital dinámico (QR) emitido y firmado por la plataforma.',
        'Wallet o saldo interno: monedero dentro de la plataforma donde se acreditan devoluciones y montos a favor del usuario; no es recargable con tarjeta.',
        'Cuota de servicio: cargo que cubre la comisión de la plataforma y la de la pasarela de pago, mostrado de forma desglosada al pagar.',
      ],
    },
    {
      id: 'cuenta',
      heading: '3. Cuenta y registro',
      paragraphs: [
        'Para comprar boletos debes crear una cuenta con un correo electrónico válido y verificarlo. La verificación se realiza mediante un código de 6 dígitos o un enlace mágico enviado a tu correo.',
        'Por tu seguridad, la plataforma exige un segundo factor de autenticación (2FA) —código por correo o aplicación de autenticación— una vez verificado tu correo, especialmente al iniciar sesión desde un dispositivo nuevo. Los dispositivos de confianza no repiten el 2FA.',
        'Eres responsable de la veracidad de tus datos, de mantener la confidencialidad de tus credenciales y de toda actividad realizada desde tu cuenta. Debes tener capacidad legal para contratar; los menores de edad solo pueden usar la plataforma a través de su representante legal.',
      ],
    },
    {
      id: 'compra',
      heading: '4. Compra de boletos',
      paragraphs: [
        'Todos los precios se expresan en Quetzales guatemaltecos (GTQ, Q) e incluyen el Impuesto al Valor Agregado (IVA) aplicable. La plataforma muestra un precio «todo incluido» de forma destacada; el desglose (precio del boleto + cuota de servicio + IVA) se presenta al momento de pagar, con total transparencia.',
        'El precio que pagas es siempre el precio de contado (un pago). Si eliges pagar en cuotas con tu tarjeta, no se te aplicará recargo alguno por ese financiamiento, conforme a la normativa guatemalteca vigente.',
        'La compra se confirma únicamente cuando el pago es aprobado por la pasarela. Mientras seleccionas asientos, estos quedan reservados temporalmente por un tiempo limitado; si no completas el pago dentro de ese plazo, la reserva se libera y los asientos vuelven a estar disponibles.',
        'Los medios de pago disponibles pueden incluir tarjetas de crédito y débito y el saldo interno (wallet). El precio y el desglose se calculan siempre del lado del servidor; ningún monto enviado por el navegador es aceptado como autoritativo.',
      ],
    },
    {
      id: 'reembolsos',
      heading: '5. Reembolsos, cancelaciones y contracargos',
      paragraphs: [
        'Como regla general, las ventas de boletos son finales. Las políticas de reembolso y de cambio dependen de cada evento y del promotor; cuando existan, se informarán antes de la compra.',
        'Si un evento es cancelado por el promotor, se aplicará la política de reembolso correspondiente. Cuando proceda un reembolso, el monto se acreditará a tu saldo interno (wallet) para su uso o retiro, salvo que la ley o la política del evento indiquen otra cosa.',
        'En caso de contracargo (disputa ante el banco emisor) o reembolso, el boleto asociado se invalida de inmediato y la revocación se propaga a los puntos de validación, incluso sin conexión a internet. El uso indebido de contracargos puede derivar en la suspensión de la cuenta.',
      ],
    },
    {
      id: 'transferencia',
      heading: '6. Transferencia de boletos',
      paragraphs: [
        'Puedes regalar o transferir un boleto a otra persona con cuenta verificada mediante un código de confirmación compartido. Al completarse la transferencia, el boleto se vuelve a emitir a nombre del nuevo titular y el código o pase anterior queda inservible.',
        'Cada boleto tiene un número máximo de transferencias, definido por el promotor del evento. Toda transferencia queda registrada en una bitácora encadenada e inalterable (cadena de custodia). La reventa con fines de lucro por fuera de los canales autorizados está prohibida.',
      ],
    },
    {
      id: 'validacion',
      heading: '7. Validación en el acceso',
      paragraphs: [
        'El boleto se valida en la puerta mediante un código QR dinámico que cambia periódicamente. Por ello, una captura de pantalla o una fotografía del código no sirve para ingresar: solo el boleto vivo dentro de tu cuenta o wallet es válido.',
        'La validación funciona incluso sin conexión a internet en el punto de acceso, verificando de forma criptográfica la autenticidad del boleto. Cada boleto admite un único ingreso; un segundo intento con el mismo boleto será rechazado.',
      ],
    },
    {
      id: 'wallet',
      heading: '8. Saldo interno (wallet)',
      paragraphs: [
        'El wallet es un monedero dentro de la plataforma que recibe devoluciones, reembolsos y montos a tu favor. No es una cuenta bancaria ni un medio de ahorro, no genera intereses y no puede recargarse con tarjeta.',
        'Puedes usar tu saldo como medio de pago (total o parcial) en tus compras, o solicitar su retiro. Los retiros están sujetos a aprobación y a una comisión de procesamiento que se te informa antes de confirmar la solicitud. Todos los movimientos quedan asentados en un libro contable con huella inalterable.',
      ],
    },
    {
      id: 'promotor',
      heading: '9. Rol de promotor',
      paragraphs: [
        'Cualquier usuario puede solicitar ser promotor. La condición de promotor requiere aprobación de Pasa Eventos y puede ser suspendida o revocada por incumplimiento de estos Términos.',
        'El promotor es responsable de la información y legalidad de sus eventos, del cumplimiento de las obligaciones frente a los asistentes y de las autorizaciones que correspondan. Pasa Eventos cobra una comisión de plataforma sobre las ventas y liquida al promotor el neto correspondiente, conforme a las condiciones y los plazos acordados.',
        'El promotor se obliga a no publicar eventos ilícitos, fraudulentos o que infrinjan derechos de terceros, y a responder frente a los compradores por cualquier reclamo relacionado con la realización del evento.',
      ],
    },
    {
      id: 'facturacion',
      heading: '10. Facturación (FEL)',
      paragraphs: [
        'Las operaciones se documentan conforme al régimen de Factura Electrónica en Línea (FEL) de Guatemala. Al momento de la compra puedes indicar tu NIT y datos de facturación; si no lo haces, la factura se emitirá a nombre de Consumidor Final (CF).',
        'Es tu responsabilidad proporcionar datos de facturación correctos. Los datos fiscales incorrectos pueden impedir la emisión o corrección de la factura.',
      ],
    },
    {
      id: 'privacidad',
      heading: '11. Privacidad y protección de datos',
      paragraphs: [
        'Tratamos tus datos personales para prestar el servicio: gestión de tu cuenta, procesamiento de pagos, emisión y validación de boletos, facturación y comunicaciones relacionadas. No vendemos tus datos personales.',
        'Aplicamos políticas de retención y de anonimización: transcurrido el plazo correspondiente tras la conclusión de tus eventos y actividad, tus datos personales pueden ser seudonimizados o depurados, preservando la trazabilidad contable exigible por ley sin exponer tu información personal.',
      ],
    },
    {
      id: 'propiedad',
      heading: '12. Propiedad intelectual',
      paragraphs: [
        'La marca, el software, el diseño, los textos y demás elementos de la plataforma pertenecen a Pasa Eventos o a sus licenciantes y están protegidos por la ley. No se concede ningún derecho sobre ellos más allá del uso normal del servicio.',
        'El contenido publicado por los promotores (imágenes, descripciones, banners) es responsabilidad de quien lo publica, quien declara contar con los derechos necesarios para su uso.',
      ],
    },
    {
      id: 'responsabilidad',
      heading: '13. Limitación de responsabilidad',
      paragraphs: [
        'Pasa Eventos provee la plataforma «tal cual» y hace esfuerzos razonables por mantenerla disponible y segura, sin garantizar una operación ininterrumpida o libre de errores.',
        'Pasa Eventos no es responsable por la realización, suspensión, cambios o calidad de los eventos, que son responsabilidad exclusiva del promotor. En la medida permitida por la ley, la responsabilidad de Pasa Eventos frente a un usuario por una operación se limita al monto de la cuota de servicio efectivamente cobrada en esa operación.',
      ],
    },
    {
      id: 'modificaciones',
      heading: '14. Modificaciones',
      paragraphs: [
        'Podemos actualizar estos Términos para reflejar cambios legales, técnicos o del servicio. La versión vigente será siempre la publicada en esta página, con su fecha de última actualización. El uso continuado de la plataforma tras un cambio implica su aceptación.',
      ],
    },
    {
      id: 'ley',
      heading: '15. Ley aplicable y jurisdicción',
      paragraphs: [
        'Estos Términos se rigen por las leyes de la República de Guatemala. Cualquier controversia se someterá a los tribunales competentes de la Ciudad de Guatemala, sin perjuicio de los derechos que la ley de protección al consumidor reconozca al usuario.',
      ],
    },
    {
      id: 'contacto',
      heading: '16. Contacto',
      paragraphs: [
        'Para consultas sobre estos Términos, tu cuenta o una compra, escríbenos a soporte@pasaeventos.com. Atenderemos tu solicitud en horario hábil, zona horaria de Guatemala (America/Guatemala, UTC-6).',
      ],
    },
  ],
};

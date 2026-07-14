/**
 * i18n de correos (v3.11). Los correos transaccionales se renderizan en el IDIOMA
 * del destinatario (`user.language`), con fallback a español. NO usa ngx-translate
 * ni ficheros externos: es un diccionario tipado en memoria (los correos del backend
 * son un puñado y su copy es estable). Cada servicio de correo lee el idioma del
 * destinatario, resuelve el locale y arma el HTML con estas cadenas.
 *
 * Solo dos locales soportados (los del frontend): `es` (default) y `en`.
 */

export type MailLocale = 'es' | 'en';

/**
 * Normaliza el idioma guardado del usuario a un locale de correo soportado.
 * Acepta 'es', 'en', 'es-GT', 'en-US', mayúsculas, null/undefined → 'es'.
 */
export function resolveMailLocale(language?: string | null): MailLocale {
  const base = (language ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return base === 'en' ? 'en' : 'es';
}

/**
 * Fecha/hora en la zona horaria de Guatemala, formateada en el locale del correo.
 * `es` → es-GT; `en` → en-US. Siempre America/Guatemala + sufijo aclaratorio.
 */
export function formatEventDate(d: Date, locale: MailLocale): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'es-GT';
  const fmt = new Intl.DateTimeFormat(intlLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Guatemala',
  });
  const suffix = locale === 'en' ? '(Guatemala time)' : '(hora de Guatemala)';
  return `${fmt.format(d)} ${suffix}`;
}

/** Cadenas de la confirmación de compra (cliente). */
export interface OrderMailStrings {
  subject: (eventName: string) => string;
  title: string;
  preheader: (count: number, eventName: string) => string;
  greeting: (name: string, eventName: string) => string;
  total: string; // etiqueta "Total"
  ticketsHeading: (count: number) => string;
  serialLabel: string;
  generalAdmission: string;
  dynamicQrNote: string;
  textSummary: (eventName: string, dateGt: string, count: number, seats: string) => string;
}

/** Cadenas de los avisos del ciclo de promotor. */
export interface PromoterMailStrings {
  teamNote: string; // "Nota del equipo:"
  pending: PromoterMailCopy;
  approved: PromoterMailCopy;
  rejected: PromoterMailCopy;
  suspended: PromoterMailCopy;
}
export interface PromoterMailCopy {
  subject: string;
  title: string;
  preheader: string;
  /** Recibe el saludo ya escapado ("Hola Ana," / "Hi Ana,") y devuelve el HTML del cuerpo. */
  body: (greetingHtml: string) => string;
}

/** Cadenas del estado de cuentas al finalizar un evento (promotor). */
export interface SettlementMailStrings {
  subject: (eventName: string) => string;
  title: string;
  preheader: (eventName: string) => string;
  greeting: (name: string, eventName: string) => string;
  intro: string;
  rows: {
    gross: string;
    net: string;
    platformFee: string;
    gatewayFee: string;
    iva: string;
    refunds: string;
    transferred: string;
  };
  ticketsSold: string;
  nextStep: string; // "Lo siguiente es el pago al promotor…"
  textSummary: (eventName: string, transferred: string) => string;
}

export interface MailStrings {
  greeting: (name: string) => string; // "Hola Ana," / "Hi Ana,"
  order: OrderMailStrings;
  promoter: PromoterMailStrings;
  settlement: SettlementMailStrings;
}

const ES: MailStrings = {
  greeting: (name) => `Hola ${name},`,
  order: {
    subject: (eventName) => `Boletos confirmados — ${eventName}`,
    title: '¡Compra confirmada!',
    preheader: (count, eventName) => `Tus ${count} boleto(s) para ${eventName} están listos.`,
    greeting: (name, eventName) =>
      `Hola ${name}, tu compra del evento <strong>${eventName}</strong> fue confirmada.`,
    total: 'Total',
    ticketsHeading: (count) => `Tus boletos (${count}):`,
    serialLabel: 'Serial del boleto',
    generalAdmission: 'Admisión general',
    dynamicQrNote:
      'Ábrelos desde la app para ver el código QR dinámico de validación (un screenshot no sirve).',
    textSummary: (eventName, dateGt, count, seats) =>
      `Compra confirmada de ${eventName}. ${dateGt}. ${count} boleto(s): ${seats}`,
  },
  promoter: {
    teamNote: 'Nota del equipo:',
    pending: {
      subject: 'Recibimos tu solicitud de promotor — Boletiva',
      title: 'Recibimos tu solicitud',
      preheader: 'Tu solicitud para ser promotor está en revisión.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} recibimos tu solicitud para operar como <strong>promotor</strong> en Boletiva.</p>
        <p style="margin:0 0 12px 0;">Nuestro equipo la revisará y <strong>te contactará pronto</strong> con el resultado. No necesitas hacer nada más por ahora.</p>`,
    },
    approved: {
      subject: '¡Tu cuenta de promotor fue aprobada! — Boletiva',
      title: '¡Cuenta de promotor aprobada!',
      preheader: 'Ya puedes crear y publicar tus eventos.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} ¡buenas noticias! Tu cuenta de promotor fue <strong>aprobada</strong>.</p>
        <p style="margin:0 0 12px 0;">Ya puedes crear y publicar eventos, cargar tu mapa de asientos y empezar a vender. Si ya habías iniciado sesión, cierra sesión y vuelve a entrar para refrescar tus permisos.</p>`,
    },
    rejected: {
      subject: 'Sobre tu solicitud de promotor — Boletiva',
      title: 'Sobre tu solicitud de promotor',
      preheader: 'Novedades sobre tu solicitud de promotor.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} revisamos tu solicitud para operar como promotor y, por ahora, <strong>no fue aprobada</strong>.</p>
        <p style="margin:0 0 12px 0;">Si crees que se trata de un error o quieres más información, contáctanos y con gusto te ayudamos.</p>`,
    },
    suspended: {
      subject: 'Tu cuenta de promotor fue suspendida — Boletiva',
      title: 'Cuenta de promotor suspendida',
      preheader: 'Tu cuenta de promotor fue suspendida.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} tu cuenta de promotor fue <strong>suspendida</strong> temporalmente, por lo que no podrás crear ni publicar eventos.</p>
        <p style="margin:0 0 12px 0;">Si tienes dudas sobre el motivo, contáctanos para revisar tu caso.</p>`,
    },
  },
  settlement: {
    subject: (eventName) => `Estado de cuentas — ${eventName}`,
    title: 'Evento finalizado: estado de cuentas',
    preheader: (eventName) => `Resumen de cuentas de ${eventName} y próximo pago.`,
    greeting: (name, eventName) =>
      `Hola ${name}, tu evento <strong>${eventName}</strong> fue marcado como finalizado. Este es su estado de cuentas.`,
    intro: 'Resumen de lo recaudado y su distribución:',
    rows: {
      gross: 'Recaudado (bruto)',
      net: 'Tu neto (promotor)',
      platformFee: 'Comisión de plataforma',
      gatewayFee: 'Comisión de pasarela',
      iva: 'IVA (12%)',
      refunds: 'Devoluciones realizadas',
      transferred: 'Transferido a tu saldo',
    },
    ticketsSold: 'Boletos vendidos',
    nextStep:
      'Lo siguiente es el <strong>pago al promotor</strong>: el neto ya está disponible en tu saldo interno y podrás retirarlo desde tu cuenta.',
    textSummary: (eventName, transferred) =>
      `Evento finalizado: ${eventName}. Transferido a tu saldo: Q${transferred}. Lo siguiente es el pago al promotor.`,
  },
};

const EN: MailStrings = {
  greeting: (name) => `Hi ${name},`,
  order: {
    subject: (eventName) => `Tickets confirmed — ${eventName}`,
    title: 'Purchase confirmed!',
    preheader: (count, eventName) => `Your ${count} ticket(s) for ${eventName} are ready.`,
    greeting: (name, eventName) =>
      `Hi ${name}, your purchase for <strong>${eventName}</strong> has been confirmed.`,
    total: 'Total',
    ticketsHeading: (count) => `Your tickets (${count}):`,
    serialLabel: 'Ticket serial',
    generalAdmission: 'General admission',
    dynamicQrNote:
      'Open them in the app to see the dynamic validation QR code (a screenshot will not work).',
    textSummary: (eventName, dateGt, count, seats) =>
      `Purchase confirmed for ${eventName}. ${dateGt}. ${count} ticket(s): ${seats}`,
  },
  promoter: {
    teamNote: 'Team note:',
    pending: {
      subject: 'We received your promoter application — Boletiva',
      title: 'We received your application',
      preheader: 'Your promoter application is under review.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} we received your application to operate as a <strong>promoter</strong> on Boletiva.</p>
        <p style="margin:0 0 12px 0;">Our team will review it and <strong>get back to you soon</strong> with the outcome. There is nothing else you need to do for now.</p>`,
    },
    approved: {
      subject: 'Your promoter account was approved! — Boletiva',
      title: 'Promoter account approved!',
      preheader: 'You can now create and publish your events.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} great news! Your promoter account has been <strong>approved</strong>.</p>
        <p style="margin:0 0 12px 0;">You can now create and publish events, upload your seat map and start selling. If you were already signed in, sign out and back in to refresh your permissions.</p>`,
    },
    rejected: {
      subject: 'About your promoter application — Boletiva',
      title: 'About your promoter application',
      preheader: 'An update on your promoter application.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} we reviewed your application to operate as a promoter and, for now, it was <strong>not approved</strong>.</p>
        <p style="margin:0 0 12px 0;">If you believe this is a mistake or would like more information, please contact us and we will be glad to help.</p>`,
    },
    suspended: {
      subject: 'Your promoter account was suspended — Boletiva',
      title: 'Promoter account suspended',
      preheader: 'Your promoter account was suspended.',
      body: (hi) =>
        `<p style="margin:0 0 12px 0;">${hi} your promoter account has been temporarily <strong>suspended</strong>, so you will not be able to create or publish events.</p>
        <p style="margin:0 0 12px 0;">If you have questions about the reason, please contact us to review your case.</p>`,
    },
  },
  settlement: {
    subject: (eventName) => `Account statement — ${eventName}`,
    title: 'Event finalized: account statement',
    preheader: (eventName) => `Account summary for ${eventName} and the upcoming payout.`,
    greeting: (name, eventName) =>
      `Hi ${name}, your event <strong>${eventName}</strong> was marked as finalized. Here is its account statement.`,
    intro: 'Summary of what was collected and how it is distributed:',
    rows: {
      gross: 'Collected (gross)',
      net: 'Your net (promoter)',
      platformFee: 'Platform fee',
      gatewayFee: 'Gateway fee',
      iva: 'VAT (12%)',
      refunds: 'Refunds issued',
      transferred: 'Transferred to your balance',
    },
    ticketsSold: 'Tickets sold',
    nextStep:
      'Next is the <strong>promoter payout</strong>: your net is now available in your internal balance and you can withdraw it from your account.',
    textSummary: (eventName, transferred) =>
      `Event finalized: ${eventName}. Transferred to your balance: Q${transferred}. Next is the promoter payout.`,
  },
};

const STRINGS: Record<MailLocale, MailStrings> = { es: ES, en: EN };

/** Devuelve el paquete de cadenas del locale (fallback a español). */
export function mailStrings(locale: MailLocale): MailStrings {
  return STRINGS[locale] ?? STRINGS.es;
}

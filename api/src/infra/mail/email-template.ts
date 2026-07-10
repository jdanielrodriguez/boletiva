/**
 * Plantilla HTML base profesional y reutilizable para TODOS los correos del
 * sistema (verificación, OTP/2FA, magic link, nuevo dispositivo, recuperación de
 * contraseña, confirmación de compra e invitación de promotor).
 *
 * - Layout table-based con CSS inline (compatibilidad máxima con clientes de
 *   correo, incl. Outlook vía VML), ancho 600px, preheader oculto y dark-mode.
 * - Sin dependencias (no mjml/handlebars): sustitución de placeholders con
 *   `.replace()`. `escapeHtml` protege los valores dinámicos (nombre, user-agent…)
 *   contra inyección de HTML en el correo.
 * - Multipart: `renderEmail` devuelve `{ html, text }`; el texto plano se deriva
 *   del `bodyText` provisto o limpiando las etiquetas del `bodyHtml`.
 */

/** Contenido específico de cada correo; el resto (marca, footer) es común. */
export interface RenderInput {
  /** Encabezado principal del correo. */
  title: string;
  /** Cuerpo en HTML (ya seguro: usa `escapeHtml` en valores dinámicos). */
  bodyHtml: string;
  /** Texto plano opcional; si falta se deriva de `bodyHtml`. */
  bodyText?: string;
  /** Texto de vista previa (inbox), oculto en el cuerpo. */
  preheader?: string;
  /** Botón de acción opcional. */
  cta?: { url: string; label: string };
}

/** Escapa HTML en valores dinámicos para evitar inyección en el correo. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convierte HTML simple a texto plano legible (para el multipart). */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function ctaBlock(cta: { url: string; label: string }): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0;"><tr><td align="left">
  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="12%" strokecolor="#7c3aed" fillcolor="#7c3aed"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
  <!--[if !mso]><!-- --><a href="${url}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;padding:0 28px;border-radius:8px;">${label}</a><!--<![endif]-->
</td></tr></table>`;
}

const BASE = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
  <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light dark" /><meta name="supported-color-schemes" content="light dark" />
  <title>{{title}}</title>
  <!--[if mso]><style type="text/css">table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
  <style type="text/css">
    body{margin:0;padding:0;width:100% !important;-webkit-text-size-adjust:100%;}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
    a{color:#7c3aed;}
    @media (prefers-color-scheme: dark){
      .pe-body{background:#121217 !important;}.pe-card{background:#1c1c22 !important;}
      .pe-text{color:#e6e6ea !important;}.pe-muted{color:#a3a3ad !important;}
      .pe-footer{color:#8a8a94 !important;}.pe-divider{border-color:#2c2c34 !important;}}
    @media only screen and (max-width:620px){
      .pe-card{width:100% !important;border-radius:0 !important;}
      .pe-pad{padding-left:24px !important;padding-right:24px !important;}}
  </style>
</head>
<body class="pe-body" style="margin:0;padding:0;background:#f4f4f7;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f7;">{{preheader}}&zwnj;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pe-body" style="background:#f4f4f7;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr><td align="left" style="padding:8px 8px 20px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
          <span style="color:#1a1a2e;" class="pe-text">pasa</span><span style="color:#7c3aed;">eventos</span>
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="pe-card" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="height:4px;background:#7c3aed;line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td class="pe-pad" style="padding:36px 40px 32px 40px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <h1 class="pe-text" style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#1a1a2e;font-weight:700;">{{title}}</h1>
          <div class="pe-text" style="font-size:16px;line-height:1.6;color:#3a3a44;">{{bodyHtml}}</div>
          {{ctaBlock}}
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr><td class="pe-footer" style="padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8a94;text-align:center;">
          &copy; {{year}} Pasa Eventos &middot; Guatemala<br />
          Este es un correo automático de tu cuenta en Pasa Eventos; por favor no respondas a este mensaje.<br />
          Si no reconoces esta actividad, contáctanos.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

/** Renderiza el correo completo (HTML + texto plano) a partir del contenido. */
export function renderEmail(input: RenderInput): { html: string; text: string } {
  const year = new Date().getFullYear();
  const preheader = input.preheader ?? input.title;
  const html = BASE.replace(/{{title}}/g, escapeHtml(input.title))
    .replace('{{preheader}}', escapeHtml(preheader))
    .replace('{{bodyHtml}}', input.bodyHtml)
    .replace('{{ctaBlock}}', input.cta ? ctaBlock(input.cta) : '')
    .replace('{{year}}', String(year));

  const bodyText = input.bodyText ?? htmlToText(input.bodyHtml);
  const ctaText = input.cta ? `\n\n${input.cta.label}: ${input.cta.url}` : '';
  const text = `pasaeventos\n\n${input.title}\n\n${bodyText}${ctaText}\n\n—\n© ${year} Pasa Eventos · Guatemala\nCorreo automático de tu cuenta; no respondas a este mensaje.`;

  return { html, text };
}

/** Escapa texto para interpolarlo con seguridad en HTML (correos, plantillas). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Etiquetas permitidas en el HTML enriquecido del KB (editor de formato, T6). */
const KB_ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h2', 'h3', 'h4', 'blockquote', 'code', 'pre', 'a', 'hr',
]);

/**
 * Sanea HTML enriquecido a un subconjunto SEGURO (whitelist) para almacenarlo (T6 KB).
 * Tokeniza: EMITE solo etiquetas permitidas bien formadas (sin atributos salvo `href`
 * en `<a>`, solo http/https/mailto, con rel/target) y ESCAPA el resto del texto — de
 * modo que una etiqueta SIN CERRAR o no permitida (p.ej. `<img onerror=…` o
 * `<a onmouseover=…` sin `>`) queda con sus `<`/`>` escapados y NO puede autocompletarse
 * en un manejador vivo al renderizar. Elimina `<script>/<style>/…` con su contenido y
 * los comentarios. Defensa en profundidad: el frontend además sanea con `[innerHTML]`.
 */
export function sanitizeRichHtml(input: string): string {
  if (!input) return '';
  // 1) Fuera bloques peligrosos con su contenido + comentarios.
  const stripped = input
    .replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 2) Tokeniza por etiquetas COMPLETAS (`<...>`). El texto entre ellas —y cualquier
  //    `<` suelto de una etiqueta sin cerrar— se escapa; solo se re-emiten las permitidas.
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(stripped)) !== null) {
    out += escapeHtmlText(stripped.slice(last, m.index));
    last = tagRe.lastIndex;
    const name = m[1].toLowerCase();
    if (!KB_ALLOWED_TAGS.has(name)) continue; // etiqueta no permitida: se descarta (su texto ya fue escapado)
    if (m[0].startsWith('</')) {
      out += `</${name}>`;
      continue;
    }
    if (name === 'a') {
      const hrefMatch = m[0].match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? '').trim();
      out += /^(https?:|mailto:)/i.test(href)
        ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer nofollow">`
        : '<a>';
      continue;
    }
    out += `<${name}>`;
  }
  out += escapeHtmlText(stripped.slice(last)); // cola: aquí caen las etiquetas sin cerrar → escapadas
  return out.trim();
}

/** Escapa `&`, `<`, `>` de un segmento de TEXTO (no de atributos). */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convierte HTML a texto plano (para búsqueda y JSON-LD `acceptedAnswer`). */
export function stripHtml(input: string): string {
  if (!input) return '';
  return input
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

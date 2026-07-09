/** Puerto de generación de banners con IA. El proveedor real (Gemini "Nano Banana"
 * / Gemini 2.5 Flash Image) se conecta detrás de esta interfaz cuando haya API key;
 * por defecto corre el stub (SVG branded) para no bloquear el desarrollo ni los E2E. */
export const BANNER_PROVIDER = Symbol('BANNER_PROVIDER');

/** Plantillas visuales del banner (paleta/estilo). El stub las mapea a gradientes;
 * el proveedor real las usa como pista de estilo. */
export type BannerTemplate = 'aurora' | 'midnight' | 'sunset' | 'forest' | 'mono';

export interface BannerPrompt {
  eventName: string;
  categoryName?: string | null;
  description?: string | null;
  /** Instrucción libre del promotor para el generador (tagline/estilo). */
  prompt?: string | null;
  /** Plantilla visual elegida (paleta/estilo). */
  template?: BannerTemplate | null;
  /** Imágenes de ejemplo (claves de storage o URLs) que guían al proveedor real. */
  sampleImages?: string[] | null;
}

export interface BannerImage {
  /** Contenido binario del banner. */
  body: Buffer;
  /** Content-Type para el storage (p.ej. image/svg+xml, image/png). */
  contentType: string;
  /** Extensión del archivo (svg, png, webp). */
  ext: string;
}

export interface BannerProvider {
  readonly name: string;
  generate(prompt: BannerPrompt): Promise<BannerImage>;
}

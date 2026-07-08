import type { components, paths } from './schema';

/**
 * Aliases ergonómicos sobre el schema generado (única fuente de verdad: el
 * OpenAPI del backend en docs/openapi.json). Regenerar con `make gen-api` cuando
 * cambie el contrato. NO editar schema.ts a mano.
 */
export type Schemas = components['schemas'];
export type ApiPaths = paths;

// --- Auth ---
export type LoginDto = Schemas['LoginDto'];
export type SignupDto = Schemas['SignupDto'];
export type RefreshDto = Schemas['RefreshDto'];
export type TwoFactorVerifyDto = Schemas['TwoFactorVerifyDto'];
export type TokenPairResponseDto = Schemas['TokenPairResponseDto'];
export type LoginResponseDto = Schemas['LoginResponseDto'];
export type AuthSessionResponseDto = Schemas['AuthSessionResponseDto'];
export type SignupResponseDto = Schemas['SignupResponseDto'];
export type PublicUserResponseDto = Schemas['PublicUserResponseDto'];
export type ProvidersResponseDto = Schemas['ProvidersResponseDto'];

// --- Events (catálogo público) ---
export type PublicEventListDto = Schemas['PublicEventListDto'];
export type PublicEventListItemDto = Schemas['PublicEventListItemDto'];
export type PublicEventDetailDto = Schemas['PublicEventDetailDto'];
export type EventLocalityDto = Schemas['EventLocalityDto'];
export type EventCategoryDto = Schemas['EventCategoryDto'];

// --- Categorías ---
export type CategoryResponseDto = Schemas['CategoryResponseDto'];

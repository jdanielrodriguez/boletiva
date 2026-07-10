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
export type ChangePasswordDto = Schemas['ChangePasswordDto'];
export type ForgotPasswordDto = Schemas['ForgotPasswordDto'];
export type ResetPasswordDto = Schemas['ResetPasswordDto'];
export type MessageResponseDto = Schemas['MessageResponseDto'];

// --- Events (catálogo público) ---
export type PublicEventListDto = Schemas['PublicEventListDto'];
export type PublicEventListItemDto = Schemas['PublicEventListItemDto'];
export type PublicEventDetailDto = Schemas['PublicEventDetailDto'];
export type EventLocalityDto = Schemas['EventLocalityDto'];
export type EventCategoryDto = Schemas['EventCategoryDto'];

// --- Categorías ---
export type CategoryResponseDto = Schemas['CategoryResponseDto'];

// --- Compra (F2): disponibilidad, holds, órdenes, pago ---
export type EventAvailabilityDto = Schemas['EventAvailabilityDto'];
export type LocalityAvailabilityDto = Schemas['LocalityAvailabilityDto'];
export type SeatAvailabilityDto = Schemas['SeatAvailabilityDto'];
export type SeatMapDto = Schemas['SeatMapDto'];
export type BuyerPriceDto = Schemas['BuyerPriceDto'];
export type CreateHoldDto = Schemas['CreateHoldDto'];
export type HoldResponseDto = Schemas['HoldResponseDto'];
export type CheckoutDto = Schemas['CheckoutDto'];
export type OrderResponseDto = Schemas['OrderResponseDto'];
export type PayOrderDto = Schemas['PayOrderDto'];
export type PayOrderResponseDto = Schemas['PayOrderResponseDto'];
export type PaymentOptionsResponseDto = Schemas['PaymentOptionsResponseDto'];
export type GatewayPaymentOptionResponseDto = Schemas['GatewayPaymentOptionResponseDto'];

// --- Reservas compartibles ---
export type CreateReservationDto = Schemas['CreateReservationDto'];
export type ReservationResponseDto = Schemas['ReservationResponseDto'];
export type ReservationItemDto = Schemas['ReservationItemDto'];
export type CheckoutReservationDto = Schemas['CheckoutReservationDto'];

// --- Cuenta (wallet + boletos) ---
export type WalletBalanceResponseDto = Schemas['WalletBalanceResponseDto'];
export type TicketResponseDto = Schemas['TicketResponseDto'];
export type TicketPageResponseDto = Schemas['TicketPageResponseDto'];
export type TicketMediaResponseDto = Schemas['TicketMediaResponseDto'];

// --- Perfil ---
export type UpdateProfileDto = Schemas['UpdateProfileDto'];

// --- Métodos de pago (tarjetas tokenizadas, PCI) ---
export type AddPaymentMethodDto = Schemas['AddPaymentMethodDto'];
export type PaymentMethodResponseDto = Schemas['PaymentMethodResponseDto'];

// --- Retiros de wallet ---
export type RequestWithdrawalDto = Schemas['RequestWithdrawalDto'];
export type WithdrawalResponseDto = Schemas['WithdrawalResponseDto'];
export type WithdrawalPageResponseDto = Schemas['WithdrawalPageResponseDto'];
export type WithdrawalActionResponseDto = Schemas['WithdrawalActionResponseDto'];

// --- Órdenes (historial/facturación) ---
export type OrderPageResponseDto = Schemas['OrderPageResponseDto'];
export type OrderItemResponseDto = Schemas['OrderItemResponseDto'];
export type OrderLedgerChainDto = Schemas['OrderLedgerChainDto'];
export type OrderLedgerTxDto = Schemas['OrderLedgerTxDto'];

// --- Promotores: invitaciones por token (F4) ---
export type CreateInvitationsDto = Schemas['CreateInvitationsDto'];
export type CreateInvitationsResponseDto = Schemas['CreateInvitationsResponseDto'];
export type CreatedInvitationDto = Schemas['CreatedInvitationDto'];
export type InvitationListItemDto = Schemas['InvitationListItemDto'];
export type InvitationPeekDto = Schemas['InvitationPeekDto'];
export type InvitationByTokenDto = Schemas['InvitationByTokenDto'];

// --- Salones / plantillas / settings / desbloqueo (v3.5) ---
export type HallResponseDto = Schemas['HallResponseDto'];
export type CreateHallDto = Schemas['CreateHallDto'];
export type UpdateHallDto = Schemas['UpdateHallDto'];
export type SeatTemplateResponseDto = Schemas['SeatTemplateResponseDto'];
export type CreateSeatTemplateDto = Schemas['CreateSeatTemplateDto'];
export type UpdateSeatTemplateDto = Schemas['UpdateSeatTemplateDto'];
export type SettingViewDto = Schemas['SettingViewDto'];
export type EditUnlockTokenDto = Schemas['EditUnlockTokenDto'];

// --- Banner con IA (F4) ---
export type BannerResponseDto = Schemas['BannerResponseDto'];
export type GenerateBannerDto = Schemas['GenerateBannerDto'];

// --- Liquidación (cuentas) por evento ---
export type EventSettlementDto = Schemas['EventSettlementDto'];

// --- Pasarelas de pago (admin) ---
export type GatewayResponseDto = Schemas['GatewayResponseDto'];
export type CreateGatewayDto = Schemas['CreateGatewayDto'];
export type UpdateGatewayDto = Schemas['UpdateGatewayDto'];
export type UpdateGatewayStatusDto = Schemas['UpdateGatewayStatusDto'];
export type GatewayUnlockResponseDto = Schemas['GatewayUnlockResponseDto'];

// --- Cotización (preview de precio por localidad) ---
export type QuoteResponseDto = Schemas['QuoteResponseDto'];
export type PriceQuoteResponseDto = Schemas['PriceQuoteResponseDto'];

// --- Promotores (admin) ---
export type PromoterListItemDto = Schemas['PromoterListItemDto'];
export type PromoterStatusEventDto = Schemas['PromoterStatusEventDto'];

// --- Gestión de eventos (panel promotor, F4) ---
export type CreateEventDto = Schemas['CreateEventDto'];
export type UpdateEventDto = Schemas['UpdateEventDto'];
export type ManagedEventDetailDto = Schemas['ManagedEventDetailDto'];
export type MyEventListItemDto = Schemas['MyEventListItemDto'];

// Localidades: el OpenAPI no expone un schema nombrado para el request/response de
// localidades del panel, así que se tipan localmente (vista + cuerpo de creación).
export interface LocalityView {
  id: string;
  name: string;
  kind: 'seated' | 'general';
  capacity?: number | null;
  desiredNet?: string | number | null;
}
export interface CreateLocalityInput {
  name: string;
  kind?: 'seated' | 'general';
  capacity?: number;
  desiredNet?: number;
}

// --- Transferencias de boletos ---
export type ClaimTransferDto = Schemas['ClaimTransferDto'];
export type TransferInitiatedDto = Schemas['TransferInitiatedDto'];
export type TransferClaimedDto = Schemas['TransferClaimedDto'];
export type TransferCancelledDto = Schemas['TransferCancelledDto'];
export type OutgoingTransferDto = Schemas['OutgoingTransferDto'];

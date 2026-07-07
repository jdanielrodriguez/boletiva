/** Puerto de proveedores de pases de wallet (Google Wallet / Apple .pkpass). */
export const WALLET_PROVIDER = Symbol('WALLET_PROVIDER');

export type WalletPlatform = 'google' | 'apple';

export interface WalletPassInput {
  ticketId: string;
  serial: string;
  eventName: string;
  seatLabel: string | null;
  /** Valor rotativo (semilla). En Google real alimenta `rotatingBarcode`. */
  qrPayload: string;
}

export interface WalletPassResult {
  platform: WalletPlatform;
  url: string;
  provider: string;
}

export interface WalletProvider {
  readonly name: string;
  createPass(platform: WalletPlatform, input: WalletPassInput): Promise<WalletPassResult>;
}

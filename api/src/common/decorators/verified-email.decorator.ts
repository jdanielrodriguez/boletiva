import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL = 'requireVerifiedEmail';

/** Exige que el usuario tenga el correo verificado (comprar, crear, transferir…). */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL, true);

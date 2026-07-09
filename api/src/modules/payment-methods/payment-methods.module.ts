import { Module } from '@nestjs/common';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { CARD_TOKENIZER, StubCardTokenizer } from './card-tokenizer';

/**
 * Métodos de pago tokenizados (PCI-DSS). El proveedor real (Recurrente/Pagalo) se
 * enchufa reemplazando `StubCardTokenizer` detrás del puerto `CARD_TOKENIZER`.
 */
@Module({
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService, { provide: CARD_TOKENIZER, useClass: StubCardTokenizer }],
})
export class PaymentMethodsModule {}

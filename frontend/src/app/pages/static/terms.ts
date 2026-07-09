import { Component } from '@angular/core';

/** Términos y condiciones (placeholder; el texto legal definitivo llega luego). */
@Component({
  selector: 'app-terms',
  template: `
    <section class="static-page">
      <h1>Términos y condiciones</h1>
      <p>
        Al usar Pasa Eventos aceptas nuestras condiciones de compra, la política de reembolsos según
        cada evento y el tratamiento de tus datos conforme a la ley aplicable en Guatemala.
      </p>

      <h2>Seguridad de los pagos y tus tarjetas</h2>
      <p>
        La seguridad de tus medios de pago es prioritaria. Cuando guardas una tarjeta, el número
        (PAN) se procesa mediante el proveedor de pago y se convierte en un <strong>token
        opaco</strong> antes de llegar a nuestros sistemas: el número completo de tu tarjeta
        <strong>nunca</strong> se almacena ni transita por nuestros servidores. Solo conservamos ese
        token, la marca y los últimos 4 dígitos para mostrarte cuál elegiste.
      </p>
      <p>
        Operamos bajo los lineamientos del estándar <strong>PCI-DSS</strong> y toda la comunicación
        viaja cifrada mediante TLS. El cobro lo ejecuta la pasarela de pago autorizada; Pasa Eventos
        no captura datos sensibles de tarjeta en su plataforma.
      </p>

      <h2>Saldo (wallet)</h2>
      <p>
        El saldo de tu wallet proviene únicamente de reembolsos y reventas de boletos: representa
        dinero ya amparado por una compra. No es posible recargarlo con tarjeta.
      </p>

      <p>El contenido legal completo se publicará próximamente.</p>
    </section>
  `,
})
export class Terms {}

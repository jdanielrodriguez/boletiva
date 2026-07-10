/**
 * Terms and Conditions (legal content, ENGLISH / en-US). Written for a ticketing
 * platform operating in Guatemala (GTQ currency, America/Guatemala time zone).
 * The `Terms` component iterates `sections` (heading + paragraphs + bullets).
 */
export const terms = {
  metaTitle: 'Terms and Conditions — Pasa Eventos',
  metaDescription:
    'Pasa Eventos Terms and Conditions: ticket purchases, refunds, transfers, gate validation, wallet, promoters and billing in Guatemala.',
  title: 'Terms and Conditions',
  lastUpdated: 'Last updated: July 10, 2026',
  intro:
    'These Terms and Conditions (the “Terms”) govern access to and use of the Pasa Eventos platform, a service for selling and validating tickets to events in Guatemala. By creating an account, purchasing a ticket, or using any feature of the platform, you accept these Terms in full. If you do not agree, please do not use the service.',
  tocTitle: 'Contents',
  sections: [
    {
      id: 'plataforma',
      heading: '1. The platform and its purpose',
      paragraphs: [
        'Pasa Eventos is a technology platform that lets event organizers (“promoters”) publish and sell tickets, and lets users (“buyers”) purchase, receive, transfer, and present them for validation at the event entrance.',
        'Pasa Eventos acts as a technology intermediary between the promoter and the buyer. The promoter is solely responsible for the delivery, content, quality, dates, times, and conditions of the event. Pasa Eventos does not organize events and does not guarantee that they will take place.',
      ],
    },
    {
      id: 'definiciones',
      heading: '2. Definitions',
      paragraphs: ['For the purposes of these Terms:'],
      bullets: [
        'Buyer: a person who purchases one or more tickets through the platform.',
        'Promoter: an authorized person or company that publishes an event and sells tickets through the platform.',
        'Ticket: the right to enter an event, represented by a dynamic digital code (QR) issued and signed by the platform.',
        'Wallet or internal balance: an account within the platform where refunds and credits in your favor are deposited; it cannot be topped up with a card.',
        'Service fee: a charge covering the platform’s commission and the payment gateway’s fee, shown itemized at checkout.',
      ],
    },
    {
      id: 'cuenta',
      heading: '3. Account and registration',
      paragraphs: [
        'To purchase tickets you must create an account with a valid email address and verify it. Verification is done with a 6-digit code or a magic link sent to your email.',
        'For your security, the platform requires a second authentication factor (2FA) —a code by email or an authenticator app— once your email is verified, especially when signing in from a new device. Trusted devices do not repeat 2FA.',
        'You are responsible for the accuracy of your information, for keeping your credentials confidential, and for all activity carried out from your account. You must have legal capacity to contract; minors may only use the platform through their legal representative.',
      ],
    },
    {
      id: 'compra',
      heading: '4. Purchasing tickets',
      paragraphs: [
        'All prices are shown in Guatemalan Quetzales (GTQ, Q) and include applicable Value Added Tax (VAT). The platform prominently shows an “all-in” price; the breakdown (ticket price + service fee + VAT) is presented at checkout with full transparency.',
        'The price you pay is always the single-payment (cash) price. If you choose to pay in installments with your card, no surcharge will be applied for that financing, in accordance with applicable Guatemalan regulations.',
        'A purchase is confirmed only when the payment is approved by the gateway. While you select seats, they are held temporarily for a limited time; if you do not complete payment within that window, the hold is released and the seats become available again.',
        'Available payment methods may include credit and debit cards and the internal balance (wallet). The price and its breakdown are always computed server-side; no amount sent by the browser is accepted as authoritative.',
      ],
    },
    {
      id: 'reembolsos',
      heading: '5. Refunds, cancellations, and chargebacks',
      paragraphs: [
        'As a general rule, ticket sales are final. Refund and exchange policies depend on each event and promoter; when they exist, they will be disclosed before purchase.',
        'If an event is canceled by the promoter, the corresponding refund policy will apply. When a refund is due, the amount will be credited to your internal balance (wallet) for use or withdrawal, unless the law or the event policy provides otherwise.',
        'In the event of a chargeback (a dispute filed with your issuing bank) or a refund, the associated ticket is invalidated immediately and the revocation is propagated to validation points, even offline. Improper use of chargebacks may result in suspension of your account.',
      ],
    },
    {
      id: 'transferencia',
      heading: '6. Ticket transfers',
      paragraphs: [
        'You may gift or transfer a ticket to another person with a verified account using a shared confirmation code. When the transfer completes, the ticket is re-issued in the new holder’s name and the previous code or pass becomes unusable.',
        'Each ticket has a maximum number of transfers, set by the event promoter. Every transfer is recorded in a tamper-evident, hash-chained log (chain of custody). Reselling for profit outside authorized channels is prohibited.',
      ],
    },
    {
      id: 'validacion',
      heading: '7. Entrance validation',
      paragraphs: [
        'The ticket is validated at the gate using a dynamic QR code that changes periodically. As a result, a screenshot or photo of the code does not work for entry: only the live ticket inside your account or wallet is valid.',
        'Validation works even without an internet connection at the access point, cryptographically verifying the ticket’s authenticity. Each ticket allows a single entry; a second attempt with the same ticket will be rejected.',
      ],
    },
    {
      id: 'wallet',
      heading: '8. Internal balance (wallet)',
      paragraphs: [
        'The wallet is an account within the platform that receives returns, refunds, and credits in your favor. It is not a bank account or a savings vehicle, it does not earn interest, and it cannot be topped up with a card.',
        'You may use your balance as a payment method (in full or in part) on your purchases, or request a withdrawal. Withdrawals are subject to approval and a processing fee that is disclosed before you confirm the request. All movements are recorded in a ledger with a tamper-evident trail.',
      ],
    },
    {
      id: 'promotor',
      heading: '9. Promoter role',
      paragraphs: [
        'Any user may apply to become a promoter. Promoter status requires approval from Pasa Eventos and may be suspended or revoked for breach of these Terms.',
        'The promoter is responsible for the accuracy and legality of its events, for meeting its obligations to attendees, and for obtaining any required authorizations. Pasa Eventos charges a platform commission on sales and settles the corresponding net amount to the promoter, according to the agreed conditions and timelines.',
        'The promoter agrees not to publish unlawful, fraudulent, or infringing events, and to be answerable to buyers for any claim related to the delivery of the event.',
      ],
    },
    {
      id: 'facturacion',
      heading: '10. Billing (FEL)',
      paragraphs: [
        'Transactions are documented under Guatemala’s Online Electronic Invoice (FEL) regime. At the time of purchase you may provide your NIT (tax ID) and billing details; if you do not, the invoice will be issued to Final Consumer (CF).',
        'It is your responsibility to provide correct billing information. Incorrect tax data may prevent the issuance or correction of the invoice.',
      ],
    },
    {
      id: 'privacidad',
      heading: '11. Privacy and data protection',
      paragraphs: [
        'We process your personal data to provide the service: managing your account, processing payments, issuing and validating tickets, billing, and related communications. We do not sell your personal data.',
        'We apply retention and anonymization policies: after the applicable period following the conclusion of your events and activity, your personal data may be pseudonymized or purged, preserving the accounting traceability required by law without exposing your personal information.',
      ],
    },
    {
      id: 'propiedad',
      heading: '12. Intellectual property',
      paragraphs: [
        'The brand, software, design, texts, and other elements of the platform belong to Pasa Eventos or its licensors and are protected by law. No rights over them are granted beyond normal use of the service.',
        'Content published by promoters (images, descriptions, banners) is the responsibility of whoever publishes it, who represents that they hold the rights necessary for its use.',
      ],
    },
    {
      id: 'responsabilidad',
      heading: '13. Limitation of liability',
      paragraphs: [
        'Pasa Eventos provides the platform “as is” and makes reasonable efforts to keep it available and secure, without guaranteeing uninterrupted or error-free operation.',
        'Pasa Eventos is not responsible for the delivery, suspension, changes, or quality of events, which are the promoter’s sole responsibility. To the extent permitted by law, Pasa Eventos’s liability to a user for a transaction is limited to the amount of the service fee actually charged on that transaction.',
      ],
    },
    {
      id: 'modificaciones',
      heading: '14. Changes',
      paragraphs: [
        'We may update these Terms to reflect legal, technical, or service changes. The version in force will always be the one published on this page, with its last-updated date. Continued use of the platform after a change constitutes acceptance of it.',
      ],
    },
    {
      id: 'ley',
      heading: '15. Governing law and jurisdiction',
      paragraphs: [
        'These Terms are governed by the laws of the Republic of Guatemala. Any dispute will be submitted to the competent courts of Guatemala City, without prejudice to the rights granted to the user by consumer protection law.',
      ],
    },
    {
      id: 'contacto',
      heading: '16. Contact',
      paragraphs: [
        'For questions about these Terms, your account, or a purchase, write to us at soporte@pasaeventos.com. We will address your request during business hours, Guatemala time zone (America/Guatemala, UTC-6).',
      ],
    },
  ],
};

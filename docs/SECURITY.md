# Security and compliance checklist

This repository is not approved for production.

- Require verified business authorization and contact opt-in before sending.
- Scope all database reads/writes by tenant and enforce server-side roles.
- Implement per-tenant Meta credentials with authenticated encryption and rotation.
- Verify Meta webhook signatures against the raw request body.
- Store per-recipient message attempts and reconcile unknown outcomes before retries.
- Honor opt-outs across every campaign and queue.
- Implement subscription payment webhook verification and invoices.
- Audit account, billing, sending, and administrative actions.
- Rate limit auth and API keys; enforce secure cookies or short-lived tokens.
- QR/WhatsApp Web automation is unofficial and carries account restriction risk.
- Never place access tokens, QR sessions, or customer data in the repository.

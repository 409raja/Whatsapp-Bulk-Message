# Official Meta Cloud API setup

Each business must authorize its own WhatsApp Business Account and phone number.
Use Meta's official onboarding flow and store granted credentials encrypted per tenant.
Use approved message templates and honor recipient opt-in and opt-out.
Validate incoming webhook signatures using the app secret and raw request bytes.
Handle sent, delivered, read, failed, and unknown events without inventing receipts.
Never retry an unknown outcome blindly. The provider adapter exists as a foundation; real sending remains disabled until these controls are implemented and tested.

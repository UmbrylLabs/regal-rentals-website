# Payment Security Implementation

Generated agreement Version 2.5 and the signing page use these values:

- `credit_card`: no refundable deposit; the same valid credit card used for payment must be securely stored on file.
- `debit_card`: refundable deposit equal to 50% of the final confirmed rental subtotal.
- `cash`: refundable deposit equal to 50% of the final confirmed rental subtotal.

The selected value and applicable deposit amount are included in the signature consent text, evidence hash, and audit log. Existing signed agreements remain preserved as stored HTML and signature evidence.

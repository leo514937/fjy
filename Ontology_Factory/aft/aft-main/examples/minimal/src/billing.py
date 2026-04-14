"""Minimal sample module used by the Phase 1 code audit skeleton."""


def validate_payment(payment_id: str, amount: float, status: str) -> bool:
    """Validate Payment before it generates Invoice."""
    return bool(payment_id) and amount > 0 and bool(status)


def validate_invoice(invoice_id: str, payment_id: str) -> bool:
    """Validate Invoice records linked to Payment."""
    return bool(invoice_id) and bool(payment_id)

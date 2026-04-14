"""HITL example with multiple validator candidates for Payment."""


def validate_payment(payment_id: str, amount: float, status: str) -> bool:
    """Validate Payment records."""
    return bool(payment_id) and amount > 0 and bool(status)


def validate_payment_record(payment_id: str, amount: float, status: str) -> bool:
    """Validate Payment records through an alternate path."""
    return bool(payment_id) and amount > 0 and bool(status)

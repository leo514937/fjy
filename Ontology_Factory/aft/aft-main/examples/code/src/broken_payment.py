"""Code audit example with a failing generated constraint test."""


def validate_payment(payment_id: str, amount: float, status: str) -> bool:
    """Validate Payment objects."""
    return bool(payment_id) and bool(status)

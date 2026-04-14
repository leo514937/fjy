from pathlib import Path

from ontology_audit_hub.domain.code.parser import parse_python_modules


def test_parse_python_modules_extracts_functions_and_methods(tmp_path: Path) -> None:
    module_path = tmp_path / "sample.py"
    module_path.write_text(
        """
def validate_payment(payment_id: str, amount: float) -> bool:
    \"\"\"Validate payment.\"\"\"
    return amount > 0

class BillingService:
    def check_invoice(self, invoice_id: str) -> bool:
        \"\"\"Check invoice.\"\"\"
        return bool(invoice_id)
""".strip(),
        encoding="utf-8",
    )

    modules = parse_python_modules([str(module_path)])

    callables = {spec.qualname: spec for spec in modules[0].callables}
    assert "validate_payment" in callables
    assert "BillingService.check_invoice" in callables
    assert callables["validate_payment"].parameters[0].name == "payment_id"
    assert callables["BillingService.check_invoice"].callable_type == "method"

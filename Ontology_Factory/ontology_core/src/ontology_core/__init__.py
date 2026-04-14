"""Canonical ontology reconciliation exports."""

from ontology_core.models import ReconciliationResult
from ontology_core.reconciler import reconcile_document

__all__ = ["ReconciliationResult", "reconcile_document"]

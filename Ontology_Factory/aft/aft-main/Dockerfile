FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY src /app/src
COPY examples /app/examples

RUN pip install --no-cache-dir ".[api,graph]"

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "ontology_audit_hub.api:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/backend-requirements.txt
COPY worker/requirements.txt /tmp/worker-requirements.txt
RUN pip install --no-cache-dir -r /tmp/backend-requirements.txt -r /tmp/worker-requirements.txt

COPY worker /app
COPY shared /shared

ENV PYTHONPATH=/app:/shared

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 CMD test -f /tmp/worker-status.json || exit 1

CMD ["python", "app/main.py"]

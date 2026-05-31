FROM python:3.11.9-slim

# Unprivileged runtime user — never run containers as root
RUN adduser --disabled-password --gecos "" appuser

WORKDIR /app

# Dependencies layer (cached separately from application code)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code (invalidated only when app/ changes)
COPY app/ ./app/

USER appuser

CMD ["python3", "app/main.py"]

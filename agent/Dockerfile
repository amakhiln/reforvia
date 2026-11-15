FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY coach ./coach

# Render sets PORT (10000 by default); run as an unprivileged user.
RUN useradd --create-home appuser
USER appuser
EXPOSE 10000
CMD ["sh", "-c", "uvicorn coach.main:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips='*'"]

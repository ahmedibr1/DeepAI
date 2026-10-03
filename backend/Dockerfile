# Presales Portal API (FastAPI). Non-root, no build tools in the final image.
FROM python:3.12-slim AS build
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home portal
# Document store for local runs (a named volume or PVC is mounted here); owned by the app user so a fresh
# volume inherits writable permissions.
RUN mkdir -p /var/lib/portal/documents && chown -R portal:portal /var/lib/portal
WORKDIR /app
COPY --from=build /install /usr/local
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--workers", "2"]

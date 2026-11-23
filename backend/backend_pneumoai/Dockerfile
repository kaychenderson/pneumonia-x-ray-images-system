FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TF_CPP_MIN_LOG_LEVEL=2

WORKDIR /app

COPY requirements.txt .
# Para uma imagem menor sem GPU, troque "tensorflow" por "tensorflow-cpu" no requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/media /app/staticfiles \
    && chown -R app:app /app
USER app

RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput

EXPOSE 8000

# Cada worker carrega sua própria cópia do modelo (RAM). Comece com 2 workers.
# makemigrations com rótulos explícitos é necessário enquanto o repositório não tiver as migrations
# versionadas (rode uma vez localmente e faça commit de apps/*/migrations; depois remova esta etapa).
CMD ["sh", "-c", "python manage.py makemigrations core accounts audit patients exams reports --noinput && python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --threads 4 --timeout 120"]

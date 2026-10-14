# ---- stage 1: build Tailwind CSS and the JavaScript bundle
FROM node:22-slim AS assets
WORKDIR /src
COPY package.json tailwind.config.js ./
RUN npm install --no-audit --no-fund
COPY frontend ./frontend
COPY templates ./templates
COPY static ./static
RUN npm run build

# ---- stage 2: Django on Gunicorn
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_DEBUG=0
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=assets /src/static ./static
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput \
 && useradd --uid 10001 --create-home ekcode && chown -R ekcode /app
USER 10001
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py seed_ekcode && gunicorn ekcode_site.wsgi:application --bind 0.0.0.0:8000 --workers 3"]

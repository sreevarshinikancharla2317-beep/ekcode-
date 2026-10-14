# EkCode: One Nation, One Material Code (SIH26099)

AI harmonization of material master codes across public sector enterprises.
Django + Django REST Framework backend, SQL database (SQLite or PostgreSQL), Tailwind CSS UI, three.js 3D view.

## Run it (Windows, VS Code terminal)

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_ekcode
python manage.py runserver
```
Open **http://127.0.0.1:8001**. Or press **F5** in VS Code ("EkCode: run Django").

EkCode runs on port **8001** so it never clashes with KindBytes, which uses port 8000. If the browser shows KindBytes, you are on port 8000: use the 8001 address instead.

Sign in: `priya.menon@cpcl.example` (maker), `r.iyer@cpcl.example` (checker) or `anita.rao@audit.example` (auditor).
Password `EkCode@2026`. The one-time code is shown on screen in demo mode.

CSS and JS are prebuilt in `static/`. Node.js is only needed to change styles: `npm install` then `npm run build`.

## PostgreSQL
Set `DATABASE_URL=postgres://user:pass@localhost:5432/ekcode`, then migrate and seed. Or `docker compose up --build`, then open http://localhost:8001.

## Tests
`python manage.py test core` (18 tests: engine accuracy, sign-in and lockout, maker-checker, auditor read-only, requests, uploads, audit-chain tampering, exports).

## Layout
- `core/engine.py` matching engine (pure Python)
- `core/services.py` runs the engine against the database, audit hash chain, exports
- `core/api.py` REST API, `accounts/` users, roles and sign-in
- `templates/index.html`, `frontend/src/` Tailwind CSS and JavaScript sources

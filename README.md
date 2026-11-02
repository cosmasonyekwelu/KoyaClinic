# Clinic Booking API

Backend API for Task 1 of the Koya Academy technical assessment.

Official Specification: [https://koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api)

---

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database ORM**: Prisma ORM
- **Database**: PostgreSQL (Neon Serverless)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Testing**: Jest, Supertest
- **Deployment**: Render & Neon
- **Version Control**: Git / GitHub

---

## Project Structure

```
KoyaClinic/
├── prisma/
│   ├── schema.prisma          # Database schema definition
│   └── migrations/            # Versioned SQL migrations
├── public/                    # Frontend client assets
│   ├── index.html             # Clinic booking web UI
│   ├── styles.css             # UI styling
│   └── app.js                 # Frontend interactions & health check
├── src/
│   ├── controllers/           # HTTP request handlers
│   │   └── health.controller.js
│   ├── middleware/            # Error handling, 404, auth
│   │   ├── error.middleware.js
│   │   └── notFound.middleware.js
│   ├── routes/                # Express routing definitions
│   │   ├── health.routes.js
│   │   └── index.js
│   ├── services/              # Business logic (Level 1+)
│   ├── utils/                 # Shared helpers & validators
│   ├── app.js                 # Express application setup
│   ├── db.js                  # PrismaClient singleton instance
│   └── index.js               # Server startup & shutdown handling
├── tests/                     # Automated test suites
│   └── health.test.js
├── .env.example               # Template environment configuration
├── .gitignore                 # Files excluded from Git tracking
├── package.json
└── README.md
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@ep-name.region.aws.neon.tech/neondb?sslmode=require` |
| `PORT` | Local server port | `3000` |
| `API_KEY` | Secret key for `X-API-Key` auth | `my-secret-assessment-key` |
| `NODE_ENV` | Environment mode | `development` or `production` |

---

## Local Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Generate Prisma Client**:
   ```bash
   npm run prisma:generate
   ```

3. **Run Database Migrations** (requires valid `DATABASE_URL`):
   ```bash
   npm run prisma:migrate
   ```

4. **Run Automated Tests**:
   ```bash
   npm test
   ```

5. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to view the frontend or test `http://localhost:3000/health`.

---

## Deployment Guide

### 1. Neon Database Setup
1. Log in to [Neon](https://neon.tech) and create a new project.
2. Under **Connection Details**, copy the pooled connection string.
3. Keep SSL mode enabled (`?sslmode=require`).

### 2. Render Web Service Setup
1. Create a new **Web Service** on [Render](https://render.com) linked to your GitHub repository.
2. Set configuration:
   - **Environment**: Node
   - **Build Command**: `npm install && npx prisma generate`
   - **Start Command**: `npm start`
3. Add Environment Variables:
   - `DATABASE_URL`: Your Neon connection string
   - `API_KEY`: Secret string for assessment validation
   - `NODE_ENV`: `production`
4. Deploy the service. Verify the `/health` endpoint once live.

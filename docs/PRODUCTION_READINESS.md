# Production Readiness and Day-0 Runbook

## 1) Guest email notifications status
Implemented in backend:
- Booking confirmation: `src/modules/bookings/booking.controller.ts`
- Check-in confirmation: `src/modules/check/check.controller.ts`
- Check-out confirmation: `src/modules/check/check.controller.ts`
- Email provider integration: `src/common/notifications/email.ts`

Required env for email:
- `EMAIL_PROVIDER=RESEND`
- `EMAIL_FROM=Your App <no-reply@yourdomain.com>`
- `RESEND_API_KEY=...`

## 2) Day-0 setup order
Run in this exact order:
1. Seed tenant + admin + tenant settings.
2. Create properties.
3. Create units per property.
4. Create manager/staff users.
5. Test booking -> check-in -> check-out and verify emails.

## 3) Minimal production seed script
Command:
- `SEED_ADMIN_PASSWORD='StrongPassword123!' npm run seed:day0`

Optional env:
- `SEED_TENANT_NAME`
- `SEED_TENANT_SLUG`
- `SEED_TENANT_EMAIL`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_FULL_NAME`
- `SEED_MIN_DEPOSIT_PERCENT`
- `SEED_MAX_PROPERTIES`
- `SEED_MAX_UNITS`
- `SEED_MAX_USERS`
- `SEED_PROPERTIES_JSON` (JSON array with optional units)

Example with inventory seed:
```bash
SEED_ADMIN_PASSWORD='StrongPassword123!' \
SEED_PROPERTIES_JSON='[
  {"name":"DTT Shortlet - Lekki","type":"SHORTLET","address":"Lekki, Lagos","units":[
    {"name":"A101","type":"APARTMENT","capacity":2,"basePrice":"65000"},
    {"name":"A102","type":"APARTMENT","capacity":2,"basePrice":"65000"}
  ]}
]' \
npm run seed:day0
```

## 4) Deployment readiness checklist
Environment:
- Set strong JWT secrets.
- Set production `FRONTEND_URL`.
- Set `EMAIL_PROVIDER` + verified `EMAIL_FROM` domain.
- Configure `SUPERADMIN_EMAILS` if using platform controls.

Database:
- Run migrations with `npx prisma migrate deploy`.
- Enable daily backups and retention policy.
- Verify restore process in a staging database.

Monitoring:
- Enable API structured logs and central log collection.
- Add uptime monitor for `/api/health`.
- Add error tracking (e.g. Sentry) for API and frontend.

Security:
- Force HTTPS at edge/load balancer.
- Rotate API and JWT secrets before go-live.
- Restrict CORS to production frontend domains only.

Email domain:
- Verify sender domain in Resend.
- Configure SPF + DKIM + DMARC records.
- Use domain sender (not gmail/yahoo) for production delivery.

File storage:
- Use object storage in production (`STORAGE_DRIVER=S3`).
- Configure `S3_REGION`, `S3_BUCKET`, and optionally `S3_ENDPOINT` (for R2-compatible API).
- Set `S3_PUBLIC_BASE_URL` to your CDN/public bucket URL.
- Configure bucket CORS to allow `PUT` from your frontend origin (`https://app.eazzihotech.com`) with `Content-Type` header.
- Keep `STORAGE_DRIVER=LOCAL` only for local development.

## 5) Integrity + readiness checks
Command:
- `npm run check:readiness`

This checks:
- required env variables
- database connectivity
- core table counts
- tenant/user inventory sanity
- warnings for common email/domain misconfiguration

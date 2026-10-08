# Student Check-in Web

Public frontend for student attendance using Firebase Authentication and a Cloudflare Worker API.

This repository contains frontend code and synthetic test fixtures only. Student rosters, attendance records, passwords, service-account keys, and backend signing secrets are not included.

## Development

Run `npm ci`, `npm test`, and `npm run dev` from `web/`. Set public SDK configuration through a local environment file or the connection settings. Never add server credentials.

## GitHub Pages

The workflow builds `web/dist` and deploys on pushes to `main`. Repository Variables: `FIREBASE_WEB_CONFIG` (public SDK JSON), `WORKER_URL`, and `ALLOW_ANY_STUDENT_EMAIL_FOR_TESTING` (defaults to false). Enable Pages with GitHub Actions as the publishing source.

Testing may temporarily allow all email domains, but verified email, an imported roster, server-owned account binding, enrollment, and QR expiry are still required. Disable the testing flag on both frontend and backend before normal operation.

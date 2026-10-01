# LaborPro Cloud

LaborPro is a browser-based workshop and payroll ledger. This is a separate LaborPro project and Supabase project. Do not replace or edit the Raw Material Inventory project.

Hosted app: [Open LaborPro](https://dskafaq-pixel.github.io/laborpro-app-site/)

## Deployment setup

1. Keep `LaborPro.html`, `cloud-sync.js`, and `payroll-fixes.js` in the same HTTPS-hosted folder. The GitHub Pages workflow copies these files and adds cache-busting versions. A local `file://` URL cannot use cloud authentication.
2. The browser client uses the public publishable key for Supabase project `fjulqqnsbtiemrrgscxp`. This key is intended to be public. Never put a service-role/secret key or database password in HTML, JavaScript, GitHub, or static hosting.
3. In the **LaborPro** Supabase project, run all of `schema.sql` in SQL Editor after each schema change. It enables owner-only reads and routes snapshot writes through a version-checked RPC. Verify the query succeeds before syncing. Keep public signups disabled; use the existing private Auth account.
4. Sign in on every device using that same Supabase Auth account. Authentication is the only app login. The legacy local user list and demo credentials are discarded by the cloud client; staff-level accounts are not supported in this build.
5. On the first device, review the blank workspace and select **Upload device data** only when you are ready to start cloud storage. A clean install no longer seeds fake workers, payroll transactions, or company contact information. Other signed-in devices load the cloud records.
6. When two devices edit the same collection at once, the app blocks automatic overwrite and asks whether to load the cloud copy or replace it with this device’s copy. Separate collections sync independently.

## Security and limits

- Supabase Auth identifies the owner. RLS scopes database rows to that account; table writes are denied directly and the RPC checks identity, allowed key format, payload size, and expected version.
- The `users` collection is never synced. No service-role key is present in client files.
- Dynamic HTML inserted into the app is sanitized with DOMPurify. Inline handlers are retained only when they match templates in the app source; unrecognized handlers and unsafe URL/style content are removed.
- CSV export escapes spreadsheet formula prefixes. Restore checks file size, collection names, and basic record shapes.
- Each collection is still stored as a single JSON snapshot. Conflict checks prevent silent concurrent replacement, but payroll-critical use needs independent review of calculations, backups, access controls, and recovery procedures. This build has not received a formal security audit or payroll/accounting certification.
- This is a single-owner deployment. Separate staff identities, server-enforced staff roles, and record-level merge are not implemented.
- Payroll review found unresolved calculation rules: attendance pay can deduct absences twice, and the configured salary method, tax, and overtime switches are not consistently applied. Do not use this build to calculate or pay live payroll until the owner confirms the intended rules and these calculations are corrected and verified.

This repository is public so GitHub Pages can host the app. Its source and publishable Supabase key are visible to everyone. Never commit worker exports, payroll backups, `.env` files, database passwords, or Supabase secret/service-role keys.

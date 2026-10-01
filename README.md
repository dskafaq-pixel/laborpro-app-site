# LaborPro app site

LaborPro is the workshop and payroll app. This clean deployment repository contains only the app files and the site deployment workflow; the existing private development repository and Raw Material project are not changed.

## App URL

After this repository is public and the first GitHub Pages workflow succeeds, open: https://dskafaq-pixel.github.io/laborpro-app-site/

## Publish steps

1. Set this repository's visibility to Public (required for Pages on the current GitHub plan). This makes the app HTML, browser sync code, and deployment workflow viewable by anyone. The Supabase publishable key in browser code is intended to be public; never add a service-role key, database password, worker export, or payroll backup.
2. In Settings > Pages, select GitHub Actions as the build and deployment source. The workflow deploys LaborPro.html as index.html and copies cloud-sync.js beside it.
3. In the LaborPro Supabase project, add https://dskafaq-pixel.github.io/laborpro-app-site/ under Authentication > URL Configuration as the Site URL and allowed redirect URL. Keep public signups disabled and use the existing private Auth account.
4. Wait for the Deploy LaborPro workflow to finish successfully, then sign in to the app using the LaborPro Supabase Auth email and password.

The app uses owner-scoped Supabase RLS and Realtime sync. Do not use it for live payroll until you have verified sign-in, sync from a second device, backups, and all payroll calculations against your records.

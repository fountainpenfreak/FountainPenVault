# Fountain Pen Vault ✒️

Fountain Pen Vault is a self-hosted web app for managing a fountain pen collection: pens, inks, nibs, feeds, usage history and collection-related financial information.

The interface is mobile-friendly and installable as a Progressive Web App (PWA).

## Features

- Manage fountain pens, inks, nibs and feeds
- Fountain pen diary / EDC view
- Dashboard and collection statistics
- Finance view
- Image uploads
- JSON export and import
- Mobile-responsive interface
- Installable PWA
- Dark interface optimized for desktop and mobile use

## Stack

- Next.js 15 / React 19
- Upstash Redis for vault data
- Vercel Blob for images
- Vercel-compatible deployment

## Requirements

- Node.js 18+ (Node.js 20+ recommended)
- An Upstash Redis database
- Vercel Blob storage if you want image uploads

## Environment variables

Copy `.env.example` to `.env.local` for local development and provide your own values:

```env
KV_REST_API_URL=
KV_REST_API_TOKEN=
BLOB_READ_WRITE_TOKEN=
VAULT_PASS=
```

`VAULT_PASS` should be a long, unique secret. Never commit `.env.local` or production credentials.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000/app/`.

## Deployment

The project can be deployed as a Next.js application on Vercel. Configure the environment variables above in the deployment environment and connect your own Redis and Blob resources.

The repository intentionally contains **no collection data, passwords, tokens or environment-specific configuration**.

## Data and backups

Collection data is stored in Redis under the application's vault key. Use the built-in JSON export function to create your own backup. Imports replace/update application data, so keep a known-good export before experimenting.

Do not commit exported vault JSON files to a public repository: they may contain your collection information and image URLs.

## Privacy and security notes

Authentication is deliberately lightweight: the browser sends `VAULT_PASS` to the server in the `X-Vault-Pass` header, where it is compared with the server-side environment variable. The browser currently caches the password in `localStorage` for convenience.

Image uploads currently use Vercel Blob with public access. Blob URLs are not listed publicly by Fountain Pen Vault, but an image can be viewed by anyone who obtains its URL. See [SECURITY.md](SECURITY.md) before exposing an installation to the internet.

## PWA

Fountain Pen Vault includes a web manifest, service worker and application icons. On supported browsers it can be installed on the home screen or desktop and used like a standalone app.

## License

Released under the [MIT License](LICENSE).

## Community

Issues, fixes and improvements are welcome. If you contribute code, please make sure examples, screenshots and test data contain no real passwords, tokens, private vault exports or personal image URLs.

## Languages

FountainPenVault includes English and German UI languages. English is the default for new installations. Use the **EN / DE** switch in the application header to change the language; the choice is stored locally in the browser.

## Demo mode (no database required)

You can explore and test FountainPenVault locally without creating an Upstash Redis database.

Create `.env.local` in the project root with:

```env
DEMO_MODE=true
```

Then start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000/app/` and click **Connect**. No vault password is required in demo mode.

Demo mode uses bundled, fictional sample data. Changes made through the UI are kept only in the running local Node.js process. Restarting the development server restores the original demo data. Redis is not contacted and no production vault data is used.

Image uploads are disabled in demo mode so the demo cannot accidentally write files to Vercel Blob.

For a real installation, leave `DEMO_MODE=false` (or omit it) and configure the Redis, Blob and `VAULT_PASS` variables described above.

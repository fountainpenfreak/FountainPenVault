# Fountain Pen Vault ✒️

Fountain Pen Vault is a self-hosted web app for managing a fountain pen collection: pens, inks, nibs, feeds, usage history and collection-related financial information.

It was originally developed as a personal collection manager and is now available as open source for anyone who would like to run or adapt their own instance.

The interface is available in **English and German**, is mobile-friendly and can be installed as a Progressive Web App (PWA).

## Screenshots

All screenshots below use the **fictional sample collection included with Demo Mode**. No personal collection data is included in this repository.

### Dashboard

![Fountain Pen Vault Dashboard](docs/screenshots/Screenshot%202026-09-17%20204103.png)

The dashboard provides an overview of currently inked pens, collection size, inks, nibs, feeds and recent activity.

### Pen Journal

![Fountain Pen Vault Pen Journal](docs/screenshots/Screenshot%202026-09-17%20204123.png)

The Pen Journal lets you record which pens were used on a particular day and derives the corresponding inks from each pen's ink history.

### Fountain Pen Collection

![Fountain Pen Vault Pens Table](docs/screenshots/Screenshot%202026-09-17%20204204.png)

Pens can be managed together with their current ink and nib configuration, purchase information and other collection data.

### Ink Collection

![Fountain Pen Vault Inks Table](docs/screenshots/Screenshot%202026-09-17%20204223.png)

The separate ink database keeps track of inks, colors, properties, stock, bottle sizes and purchase information.

## Features

- Manage fountain pens, inks, nibs and feeds
- Track current pen, nib, feed and ink configurations
- Fountain pen journal / EDC view
- Usage and maintenance history
- Dashboard and collection statistics
- Finance view
- Image uploads
- JSON export and import
- English and German interface
- Mobile-responsive interface
- Installable PWA
- Dark interface optimized for desktop and mobile use

## Demo mode — no database required

The easiest way to explore Fountain Pen Vault is the included **Demo Mode**.

It uses a bundled, completely fictional sample collection and does not require an Upstash Redis database, Vercel Blob storage or a vault password.

Clone the repository, install the dependencies and create `.env.local` in the project root:

```env
DEMO_MODE=true
```

Then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000/app/` and click **Connect**. No vault password is required in Demo Mode.

Changes made through the UI are kept only in the running local Node.js process. Restarting the development server restores the original demo data. Redis is not contacted and no production vault data is used.

Image uploads are disabled in Demo Mode so the demo cannot accidentally write files to Vercel Blob.

## Languages

Fountain Pen Vault includes **English and German** UI languages.

English is the default for new installations. Use the **EN / DE** switch in the application header to change the language. The selected language is stored locally in the browser.

The application was originally developed in German and the English localization was added later. Some translations may therefore not be perfect.

## Stack

- Next.js 15 / React 19
- Upstash Redis for vault data
- Vercel Blob for images
- Vercel-compatible deployment

## Requirements for a real installation

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
DEMO_MODE=false
```

`VAULT_PASS` should be a long, unique secret.

Never commit `.env.local`, production credentials or exported personal vault data to a public repository.

## Run locally with your own vault

After configuring the environment variables:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000/app/
```

Enter the password configured in `VAULT_PASS` and click **Connect**.

## Deployment

Fountain Pen Vault can be deployed as a Next.js application on **Vercel**.

Configure the environment variables in the deployment environment and connect your own Upstash Redis database and, if image uploads are required, Vercel Blob storage.

The repository intentionally contains **no personal collection data, passwords, tokens or environment-specific production configuration**.

Each installation uses its own backend resources and collection data.

## Data and backups

Collection data is stored as JSON in Redis under the application's vault key.

Use the built-in **Export** function to create backups of your collection. The corresponding **Import** function can restore/import application data.

Keep a known-good export before experimenting with imports or modifying the application.

Do not commit exported vault JSON files to a public repository. They may contain collection information, purchase information, notes and image URLs.

## Privacy and security notes

Authentication is deliberately lightweight and was designed for a personal, self-hosted installation.

The browser sends `VAULT_PASS` to the server in the `X-Vault-Pass` header, where it is compared with the server-side environment variable. The browser currently caches the password in `localStorage` for convenience.

Image uploads use Vercel Blob with public access. Blob URLs are not listed publicly by Fountain Pen Vault, but an image can be viewed by anyone who obtains its URL.

Please read [SECURITY.md](SECURITY.md) before exposing an installation to the internet.

## PWA

Fountain Pen Vault includes a web manifest, service worker and application icons.

On supported browsers it can be installed on a phone, tablet or desktop and used much like a standalone application.

Because the collection itself remains on the server, the same vault can be accessed from different devices through a browser.

## Project status

Fountain Pen Vault was created as a **personal project** and is being published in its current state for the fountain pen community.

It is not intended to become a commercial service, hosted platform or actively maintained community project.

You are welcome to use the source code, fork the repository and adapt it for your own collection or workflow.

## License

Released under the [MIT License](LICENSE).

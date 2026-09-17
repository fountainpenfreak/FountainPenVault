# Security

Fountain Pen Vault is a small self-hosted personal application. It uses a shared secret (`VAULT_PASS`) sent in the `X-Vault-Pass` request header to protect the vault API.

## Important limitations

- This is intentionally simple authentication, not a full user/account system.
- Use HTTPS in production and choose a long, unique `VAULT_PASS`.
- The browser currently caches the vault password in `localStorage` for convenience. Do not use the application on untrusted or shared devices.
- Uploaded images are currently stored as **publicly addressable Vercel Blob objects**. The application does not publish an index of those URLs, but anyone who obtains a blob URL can access that image.
- Never commit `.env` files, API tokens, passwords, exports of your vault, or private image URLs.

If you discover a security issue, please use GitHub's private vulnerability reporting feature if it is enabled for this repository. Please do not publish secrets or private vault data in an issue.

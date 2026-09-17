import { put } from "@vercel/blob";

function assertAuth(req) {
  const pass = req.headers.get("x-vault-pass") || "";
  const expected = process.env.VAULT_PASS || "";
  if (!expected) throw new Response("VAULT_PASS missing", { status: 500 });
  if (pass !== expected) throw new Response("Unauthorized", { status: 401 });
}

export async function POST(req) {
  try {
    assertAuth(req);

    const form = await req.formData();
    const file = form.get("file");
    if (!file) return new Response("Missing file", { status: 400 });

    const blob = await put(`fpvault/${Date.now()}-${file.name}`, file, { access: "public" });

    return Response.json({
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType,
      size: blob.size,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response("Upload error", { status: 500 });
  }
}

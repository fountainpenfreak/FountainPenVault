import { Redis } from "@upstash/redis";

const KEY = "fpvault:v1";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function assertAuth(req) {
  const pass = req.headers.get("x-vault-pass") || "";
  const expected = process.env.VAULT_PASS || "";
  if (!expected) throw new Response("VAULT_PASS missing", { status: 500 });
  if (pass !== expected) throw new Response("Unauthorized", { status: 401 });
}

function emptyVault() {
  return {
    version: 1,
    pens: [],
    inks: [],
    nibs: [],
    feeds: [],
    events: [],
    meta: { counters: { pen: 1, ink: 1, nib: 1, feed: 1, event: 1, image: 1 } },
  };
}

export async function GET(req) {
  try {
    assertAuth(req);
    const data = await redis.get(KEY);
    return Response.json(data || emptyVault());
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response("Internal error", { status: 500 });
  }
}

export async function PUT(req) {
  try {
    assertAuth(req);
    const body = await req.json();

    for (const k of ["pens", "inks", "nibs", "feeds", "events"]) {
      if (!Array.isArray(body?.[k])) {
        return new Response(`Bad Request: ${k} must be array`, { status: 400 });
      }
    }
    if (!body?.meta?.counters) body.meta = emptyVault().meta;

    await redis.set(KEY, body);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response("Internal error", { status: 500 });
  }
}

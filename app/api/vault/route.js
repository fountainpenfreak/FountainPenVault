import { Redis } from "@upstash/redis";
import demoSeed from "./demo-vault.json" with { type: "json" };

const KEY = "fpvault:v1";
const DEMO_MODE = process.env.DEMO_MODE === "true";

function redisClient() {
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

function assertAuth(req) {
  if (DEMO_MODE) return;
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDemoVault() {
  // Keep demo edits for the lifetime of the local Node.js process only.
  // Restarting `npm run dev` restores the bundled seed data.
  if (!globalThis.__FPV_DEMO_VAULT__) {
    globalThis.__FPV_DEMO_VAULT__ = clone(demoSeed);
  }
  return globalThis.__FPV_DEMO_VAULT__;
}

export async function GET(req) {
  try {
    assertAuth(req);
    if (DEMO_MODE) return Response.json(getDemoVault());

    const data = await redisClient().get(KEY);
    return Response.json(data || emptyVault());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
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

    if (DEMO_MODE) {
      globalThis.__FPV_DEMO_VAULT__ = clone(body);
      return Response.json({ ok: true, demo: true });
    }

    await redisClient().set(KEY, body);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return new Response("Internal error", { status: 500 });
  }
}

/**
 * FountainPenVault — Cloud Edition (Upstash Redis + Vercel Blob)
 * Data: GET/PUT /api/vault
 * Uploads: POST /api/upload (multipart)
 * Auth: header X-Vault-Pass == VAULT_PASS
 */

let vaultPass = "";
let connected = false;

// prevent sort clicks right after resizing a column
let colResizeBlockClickUntil = 0;

// Ensure required CSS for table column resizing exists (colResizer/thWrap)
function ensureColResizeStyles(){
  if(document.getElementById("fpv-col-resize-styles")) return;
  const style = document.createElement("style");
  style.id = "fpv-col-resize-styles";
  style.textContent = `

    .thWrap{ position:relative; display:flex; align-items:center; }
    .thText{ flex:1 1 auto; padding-right: 12px; }
    .colResizer{ position:absolute; top:0; right:0; width:10px; height:100%; cursor:col-resize; touch-action:none; }

    table.fpvTable{ table-layout: fixed; }
    table.fpvTable th, table.fpvTable td{ overflow:hidden; text-overflow: ellipsis; }
    .colResizer::after{ content:""; position:absolute; top:20%; right:4px; width:2px; height:60%; border-radius:2px; background: rgba(233,233,255,.45); opacity:.30; }
    body.isResizingCols{ cursor:col-resize; user-select:none; }
    body.isResizingCols *{ cursor:col-resize !important; }
  `;
  document.head.appendChild(style);
}

let pens = [];
let inks = [];
let nibs = [];
let feeds = [];
let events = [];
let meta = null;

let entity = "dashboard"; // dashboard|pens|inks|nibs|feeds
let selectedId = null;

let penOriginalNibDraftByPenId = {}; // unsaved inline original nib draft

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

// ---- Expose key state & helpers to window (needed by ui-dashboard.js) ----
try {
  Object.defineProperty(window, "entity", { get: () => entity, set: (v) => { entity = v; }, configurable: true });
  Object.defineProperty(window, "selectedId", { get: () => selectedId, set: (v) => { selectedId = v; }, configurable: true });
  Object.defineProperty(window, "pens", { get: () => pens, configurable: true });
  Object.defineProperty(window, "inks", { get: () => inks, configurable: true });
  Object.defineProperty(window, "nibs", { get: () => nibs, configurable: true });
  Object.defineProperty(window, "feeds", { get: () => feeds, configurable: true });
  Object.defineProperty(window, "events", { get: () => events, configurable: true });
  window.esc = esc;
} catch (_) {}

/* =========================================================
   Status / Enablement
========================================================= */

let __statusClearTimer = null;
function setStatus(t, { autoClearMs = null } = {}) {
  const el = $("status");
  if (el) el.textContent = t;

  // Clear previous auto-clear timer
  if (__statusClearTimer) {
    clearTimeout(__statusClearTimer);
    __statusClearTimer = null;
  }

  // Auto-clear logic (used for "Gespeichert ✅")
  const shouldAutoClear =
    autoClearMs !== null
      ? autoClearMs > 0
      : String(t || "").toLowerCase().includes("gespeichert");

  if (shouldAutoClear) {
    const ms = autoClearMs !== null ? autoClearMs : 3000;
    __statusClearTimer = setTimeout(() => {
      __statusClearTimer = null;
      // After save: go back to connected state label (or empty)
      const fallback = connected ? "Verbunden ✅" : "";
      if (el) el.textContent = fallback;
    }, ms);
  }
}
function setEnabled(on) {
  const btnNew = $("btnNew");
  const btnSave = $("btnSave");
  const btnDelete = $("btnDelete");
  const btnExport = $("btnExport");
  const btnImport = $("btnImport");

  if (btnNew) btnNew.disabled = !on || entity === "dashboard" || entity === "finance" || entity === "edc";
  if (btnSave) btnSave.disabled = !on || entity === "dashboard" || entity === "finance" || entity === "edc" || !selectedId;
  if (btnDelete) btnDelete.disabled = !on || entity === "dashboard" || entity === "finance" || entity === "edc" || !selectedId;
  if (btnExport) btnExport.disabled = !on;
  if (btnImport) btnImport.disabled = !on;
}

/* =========================================================
   Lightbox / Overlay
========================================================= */
let __lightboxEl = null;

function ensureLightbox() {
  if (__lightboxEl) return __lightboxEl;

  const el = document.createElement("div");
  el.id = "fpv_lightbox";
  el.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0,0,0,.82);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  el.innerHTML = `
    <div style="
      position: relative;
      max-width: min(1200px, 96vw);
      max-height: 92vh;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <img id="fpv_lightbox_img" alt="image" style="
        max-width: 100%;
        max-height: 92vh;
        border-radius: 16px;
        box-shadow: 0 30px 80px rgba(0,0,0,.75);
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.03);
      "/>
      <button id="fpv_lightbox_close" class="btn danger" style="
        position: absolute;
        top: -10px;
        right: -10px;
        padding: 10px 14px;
      ">Schließen</button>
    </div>
  `;

  document.body.appendChild(el);

  const close = () => {
    el.style.display = "none";
  };
  el.addEventListener("click", (e) => {
    if (e.target === el) close();
  });
  el.querySelector("#fpv_lightbox_close").addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  __lightboxEl = el;
  return el;
}

function openLightbox(url) {
  const el = ensureLightbox();
  const img = el.querySelector("#fpv_lightbox_img");
  img.src = url;
  el.style.display = "flex";
}

/* =========================================================
   Custom Dropdown (Base64 config, stable)
========================================================= */
let __openDropdownId = null;

function getDDRoot(id) {
  return document.querySelector(`[data-dd-root="${CSS.escape(id)}"]`);
}
function closeAnyDropdown() {
  if (!__openDropdownId) return;
  const root = getDDRoot(__openDropdownId);
  if (root) {
    const menu = root.querySelector(".dd-menu");
    if (menu) menu.remove();
    const btn = root.querySelector(".dd-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  __openDropdownId = null;
}

document.addEventListener(
  "pointerdown",
  (e) => {
    if (!__openDropdownId) return;
    const root = getDDRoot(__openDropdownId);
    if (root && root.contains(e.target)) return;
    closeAnyDropdown();
  },
  true
);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAnyDropdown();
});

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

function dropdownHtml({
  id,
  placeholder = "—",
  value = "",
  options = [],
  searchable = true,
  clearable = true,
}) {
  const valLabel = options.find((o) => o.value === value)?.label ?? "";
  const hasValue = value !== "" && value !== null && value !== undefined;

  const cfg = { placeholder, searchable, clearable, options };
  const cfgB64 = b64EncodeUnicode(JSON.stringify(cfg));

  return `
    <div class="dd" data-dd-root="${esc(id)}" data-dd-value="${esc(
    value ?? ""
  )}" data-dd-b64="${cfgB64}">
      <button type="button" class="dd-btn" data-dd-btn="${esc(
        id
      )}" aria-haspopup="listbox" aria-expanded="false">
        <div class="dd-value ${hasValue ? "" : "dd-placeholder"}">${esc(
    hasValue ? valLabel : placeholder
  )}</div>
      </button>
      ${
        clearable
          ? `<button type="button" class="dd-clear" data-dd-clear="${esc(
              id
            )}" title="Leeren">×</button>`
          : ""
      }
      <div class="dd-caret"></div>
    </div>
  `;
}

function initDropdown(id, onChange) {
  const root = getDDRoot(id);
  if (!root) return;

  const btn =
    root.querySelector(`[data-dd-btn="${CSS.escape(id)}"]`) ||
    root.querySelector(`[data-dd-btn="${id}"]`);
  const clearBtn =
    root.querySelector(`[data-dd-clear="${CSS.escape(id)}"]`) ||
    root.querySelector(`[data-dd-clear="${id}"]`);
  if (!btn) return;

  let cfg = null;
  try {
    const b64 = root.getAttribute("data-dd-b64") || "";
    cfg = JSON.parse(b64DecodeUnicode(b64));
  } catch (e) {
    console.error("Dropdown cfg parse failed for", id, e);
    cfg = { placeholder: "—", searchable: true, clearable: true, options: [] };
  }

  const options = cfg.options || [];
  const placeholder = cfg.placeholder || "—";
  const searchable = cfg.searchable !== false;
  const clearable = cfg.clearable !== false;

  function setValue(newValue) {
    root.setAttribute("data-dd-value", newValue ?? "");
    const label = options.find((o) => o.value === newValue)?.label ?? "";
    const valueEl = btn.querySelector(".dd-value");
    const has = newValue !== "" && newValue !== null && newValue !== undefined;
    valueEl.textContent = has ? label : placeholder;
    valueEl.classList.toggle("dd-placeholder", !has);
    if (typeof onChange === "function") onChange(newValue ?? "");
  }

  function open() {
    closeAnyDropdown();
    __openDropdownId = id;
    btn.setAttribute("aria-expanded", "true");

    const menu = document.createElement("div");
    menu.className = "dd-menu";
    menu.innerHTML = `
      ${
        searchable
          ? `<div class="dd-searchWrap"><input class="dd-search" placeholder="Suchen…" /></div>`
          : ""
      }
      <div class="dd-items" role="listbox"></div>
    `;
    root.appendChild(menu);

    const itemsEl = menu.querySelector(".dd-items");
    const searchEl = menu.querySelector(".dd-search");

    let current = root.getAttribute("data-dd-value") || "";
    let visible = options.slice();
    let kbdIndex = -1;

    function renderItems(filter = "") {
      itemsEl.innerHTML = "";
      const q = filter.trim().toLowerCase();

      visible = options.filter((o) => {
        if (!q) return true;
        return (
          String(o.label || "")
            .toLowerCase()
            .includes(q) ||
          String(o.value || "")
            .toLowerCase()
            .includes(q)
        );
      });

      if (visible.length === 0) {
        itemsEl.innerHTML = `<div class="dd-empty">Keine Treffer.</div>`;
        kbdIndex = -1;
        return;
      }

      kbdIndex = visible.findIndex((o) => o.value === current);
      if (kbdIndex < 0) kbdIndex = 0;

      visible.forEach((o, idx) => {
        const div = document.createElement("div");
        div.className =
          "dd-item" +
          (o.value === current ? " active" : "") +
          (idx === kbdIndex ? " kbd" : "");
        div.setAttribute("role", "option");
        div.innerHTML = `<div style="font-weight:600">${esc(o.label)}</div>`;
        div.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          setValue(o.value);
          closeAnyDropdown();
        });
        itemsEl.appendChild(div);
      });

      const kbdEl = itemsEl.querySelector(".dd-item.kbd");
      if (kbdEl) kbdEl.scrollIntoView({ block: "nearest" });
    }

    function move(delta) {
      if (!visible.length) return;
      kbdIndex = Math.max(0, Math.min(visible.length - 1, kbdIndex + delta));
      [...itemsEl.querySelectorAll(".dd-item")].forEach((el, idx) => {
        el.classList.toggle("kbd", idx === kbdIndex);
      });
      const kbdEl = itemsEl.querySelector(".dd-item.kbd");
      if (kbdEl) kbdEl.scrollIntoView({ block: "nearest" });
    }

    function chooseKbd() {
      if (!visible.length || kbdIndex < 0) return;
      const o = visible[kbdIndex];
      setValue(o.value);
      closeAnyDropdown();
    }

    renderItems("");

    if (searchEl) {
      searchEl.focus();
      searchEl.addEventListener("input", () => renderItems(searchEl.value || ""));
      searchEl.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(+1);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          chooseKbd();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeAnyDropdown();
        }
      });
    } else {
      menu.tabIndex = 0;
      menu.focus();
      menu.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(+1);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          chooseKbd();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeAnyDropdown();
        }
      });
    }
  }

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = __openDropdownId === id;
    if (isOpen) closeAnyDropdown();
    else open();
  });

  if (clearBtn && clearable) {
    clearBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setValue("");
      closeAnyDropdown();
    });
  }

  root.__setValue = setValue;
}

/* =========================================================
   API
========================================================= */
async function apiGetVault() {
  const r = await fetch("/api/vault", { headers: { "X-Vault-Pass": vaultPass } });
  if (!r.ok) throw new Error(`GET /api/vault failed: ${r.status}`);
  return await r.json();
}
async function apiPutVault(payload) {
  const r = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Vault-Pass": vaultPass },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`PUT /api/vault failed: ${r.status}`);
}
async function apiUploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", {
    method: "POST",
    headers: { "X-Vault-Pass": vaultPass },
    body: fd,
  });
  if (!r.ok) throw new Error(`POST /api/upload failed: ${r.status}`);
  return await r.json(); // {url, pathname, size, contentType}
}

/* =========================================================
   Vault helpers
========================================================= */
function ensureMeta(m) {
  if (!m) m = {};
  if (!m.counters) m.counters = {};
  for (const k of ["pen", "ink", "nib", "feed", "event", "file"])
    if (!m.counters[k]) m.counters[k] = 1;

  if (!m.master) m.master = {};
  if (!Array.isArray(m.master.vendors)) m.master.vendors = [];
  if (!Array.isArray(m.master.inkBrands)) m.master.inkBrands = [];
  if (!Array.isArray(m.master.penBrands)) m.master.penBrands = [];

  if (!Array.isArray(m.master.nibMaterials)) m.master.nibMaterials = [];
  if (!Array.isArray(m.master.nibSizes)) m.master.nibSizes = [];
  if (!Array.isArray(m.master.nibTypes)) m.master.nibTypes = [];
  if (!Array.isArray(m.master.nibMakers)) m.master.nibMakers = [];

  if (!Array.isArray(m.master.feedMakers)) m.master.feedMakers = [];
  if (!Array.isArray(m.master.feedMaterials)) m.master.feedMaterials = [];

  // defaults
  if (m.master.feedMakers.length === 0)
    m.master.feedMakers = ["Unbekannt", "Jowo", "Bock", "Pilot", "Sailor", "PenBBS", "Jinhao", "Moonman", "Schmidt", "Sonstige"];

  // NEW: feed material defaults
  if (m.master.feedMaterials.length === 0) m.master.feedMaterials = ["Plastik", "Ebonit"];

  if (m.master.nibMaterials.length === 0) m.master.nibMaterials = ["Stahl", "14k Gold", "18k Gold", "21k Gold", "24k Gold", "keine"];
  if (m.master.nibSizes.length === 0)
    m.master.nibSizes = ["Jinhao 26 (5.5)", "Kaigelu (6?)", "PenBBS", "Pilot VP", "Pilot FA", "Sailorspezifisch", "5", "6", "7", "8", "9"];
  if (m.master.nibTypes.length === 0) {
    m.master.nibTypes = [
      "EF",
      "F",
      "M",
      "B",
      "Blade F",
      "CSI Medium",
      "Falcon",
      "Flex",
      "Long Knife",
      "Music",
      "Omniflex",
      "Ultra Flex",
      "1.1 Stub",
      "1.5 Stub",
      "1.9 Stub",
      "2.5 Stub",
      "2.9 Stub",
      "3.0 Stub",
      "PenBBS Calligraphy No 4",
      "PenBBS Calligraphy No 15",
      "PenBBS Calligraphy No 17",
      "keine",
    ];
  }
  if (m.master.nibMakers.length === 0) {
    m.master.nibMakers = ["wie Füller", "Unbekannt", "Bock", "Jinhao", "Jowo", "Kanwrite", "Moonman", "PenBBS", "Pilot", "Schmidt", "Tangmoon", "kein"];
  }

  return m;
}

async function connect() {
  vaultPass = $("vaultPass").value.trim();
  if (!vaultPass) return alert("Bitte Vault Passwort eingeben.");
  setStatus("Verbinde…");

  const v = await apiGetVault();
  pens = v.pens || [];
  inks = v.inks || [];
  nibs = v.nibs || [];
  feeds = v.feeds || [];
  events = v.events || [];
  meta = ensureMeta(v.meta);

  // back-compat: ensure currentFeedMaterial field exists (optional)
  for (const p of pens) {
    if (p.currentFeedMaterial === undefined) p.currentFeedMaterial = "";
  }

  connected = true;
  localStorage.setItem("fpvault_pass_cached", vaultPass);

  setStatus("Verbunden ✅");
  render();
  setEnabled(true);
}

async function saveVault() {
  await apiPutVault({ version: 1, pens, inks, nibs, feeds, events, meta });
  setStatus("Gespeichert ✅", { autoClearMs: 2500 });
}

async function nextId(kind) {
  const map = {
    pen: { prefix: "PEN", pad: 4 },
    ink: { prefix: "INK", pad: 4 },
    nib: { prefix: "NIB", pad: 4 },
    feed: { prefix: "FEED", pad: 4 },
    event: { prefix: "EVT", pad: 6 },
    file: { prefix: "FILE", pad: 6 },
  };
  const cfg = map[kind];
  const n = meta.counters[kind] ?? 1;
  meta.counters[kind] = n + 1;
  await saveVault();
  return `${cfg.prefix}-${String(n).padStart(cfg.pad, "0")}`;
}

/* =========================================================
   Misc helpers
========================================================= */
function toInputDate(iso) {
  if (!iso) return "";
  return String(iso).slice(0, 10);
}
function fromInputDate(val) {
  if (!val) return null;
  return val;
}
function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function fmtMoney(n) {
  if (n === null || n === undefined || n === "") return "";
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toFixed(2);
}
function safeDiv(a, b) {
  const A = Number(a),
    B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B === 0) return null;
  return A / B;
}
function monthsBetween(dateYYYYMMDD, now = new Date()) {
  if (!dateYYYYMMDD) return "";
  const [y, m, d] = dateYYYYMMDD.split("-").map((n) => parseInt(n, 10));
  if (!y || !m) return "";
  const a = new Date(y, m - 1, d || 1);
  const b = now;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if ((d || 1) > b.getDate()) months -= 1;
  return Math.max(0, months);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function emptyOriginalNibDraft() {
  return {
    maker: "",
    material: "",
    size: "",
    type: "",
    price: "",
    currency: "EUR",
    boughtAt: "",
    boughtFrom: "",
    notes: "",
    label: "",
  };
}
function ensureOriginalNibDraft(penId) {
  if (!penOriginalNibDraftByPenId[penId]) penOriginalNibDraftByPenId[penId] = emptyOriginalNibDraft();
  return penOriginalNibDraftByPenId[penId];
}
async function createOriginalNibFromDraftAndLink(pen) {
  const d = ensureOriginalNibDraft(pen.id);
  const hasAny = [d.maker, d.material, d.size, d.type, d.price, d.boughtAt, d.boughtFrom, d.notes, d.label]
    .some(v => String(v || "").trim() !== "");
  if (!hasAny) {
    alert("Bitte trage mindestens ein Feld für die neue Originalfeder ein.");
    return;
  }

  const id = await nextId("nib");
  const nib = {
    id,
    label: String(d.label || "").trim(),
    material: String(d.material || "").trim(),
    size: String(d.size || "").trim(),
    type: String(d.type || "").trim(),
    maker: String(d.maker || "").trim(),
    price: numOrNull(d.price),
    currency: String(d.currency || "EUR").trim() || "EUR",
    boughtAt: d.boughtAt || null,
    boughtFrom: String(d.boughtFrom || "").trim(),
    notes: String(d.notes || "").trim(),
    attachments: [],
    createdAt: new Date().toISOString(),
  };

  nibs.push(nib);
  pen.originalNibId = nib.id;
  if (!pen.currentNibId) pen.currentNibId = nib.id;

  pen.nibHistory = Array.isArray(pen.nibHistory) ? pen.nibHistory : [];
  if (!pen.nibHistory.some(h => h && h.nibId === nib.id)) {
    pen.nibHistory.push({
      id: await nextId("event"),
      date: nib.boughtAt || todayISO(),
      nibId: nib.id,
      notes: "Originalfeder bei Anlage erfasst",
    });
  }

  delete penOriginalNibDraftByPenId[pen.id];
  await saveVault();
}

/* Attachments helpers */
function isImageAttachment(a) {
  const ct = (a?.contentType || "").toLowerCase();
  const fn = (a?.filename || "").toLowerCase();
  if (ct.startsWith("image/")) return true;
  return fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".png") || fn.endsWith(".webp") || fn.endsWith(".gif");
}
function isPdfAttachment(a) {
  const ct = (a?.contentType || "").toLowerCase();
  const fn = (a?.filename || "").toLowerCase();
  return ct === "application/pdf" || fn.endsWith(".pdf");
}
function firstPenPhoto(p) {
  const atts = Array.isArray(p?.attachments) ? p.attachments : [];
  const photos = atts.filter((a) => a.kind === "pen_photo" && isImageAttachment(a));
  return photos[0] || null;
}

/* =========================================================
   Feed material helpers (NEW)
========================================================= */
function getFeedById(id) {
  return feeds.find((f) => f.id === id) || null;
}
function getFeedMaterialById(id) {
  const f = getFeedById(id);
  return (f?.material || "").trim();
}
function isPenEboniteFeed(pen) {
  // primary: currentFeedMaterial if present, else derive from feed DB
  const m = (pen?.currentFeedMaterial || "").trim();
  if (m) return m.toLowerCase() === "ebonit";
  const derived = getFeedMaterialById(pen?.currentFeedId || "");
  return derived.toLowerCase() === "ebonit";
}

/* =========================================================
   Entity helpers
========================================================= */
function getArrayForEntity(ent) {
  if (ent === "pens") return pens;
  if (ent === "inks") return inks;
  if (ent === "nibs") return nibs;
  if (ent === "feeds") return feeds;
  return [];
}
function findById(ent, id) {
  return getArrayForEntity(ent).find((x) => x.id === id) || null;
}

function getDisplayName(ent, obj) {
  if (!obj) return "";
  if (ent === "pens") {
    const base = `${obj.brand ?? ""} ${obj.model ?? ""}`.trim() || obj.id;
    return obj.limitedEdition ? `${base} L.E.` : base;
  }
  if (ent === "inks") return `${obj.brand ?? ""} ${obj.name ?? ""}`.trim() || obj.id;
  if (ent === "nibs") return (obj.label ?? "").trim() || [obj.maker, obj.material, obj.size, obj.type].filter(Boolean).join(" · ") || obj.id;
  if (ent === "feeds") return (obj.label ?? "").trim() || [obj.maker, obj.model, obj.material].filter(Boolean).join(" · ") || obj.id;
  return obj.id;
}

function searchFilter(list) {
  const q = ($("search").value || "").toLowerCase().trim();
  if (!q) return list;
  return list.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
}
function nibLabel(id) {
  const n = nibs.find((x) => x.id === id);
  if (!n) return id;
  return n.label || [n.maker, n.material, n.size, n.type].filter(Boolean).join(" · ") || id;
}
function feedLabel(id) {
  const f = feeds.find((x) => x.id === id);
  if (!f) return id;
  return f.label || [f.maker, f.model, f.material].filter(Boolean).join(" · ") || id;
}
function inkLabel(id) {
  const i = inks.find((x) => x.id === id);
  if (!i) return id;
  return [i.brand, i.name].filter(Boolean).join(" · ") || id;
}

/* =========================================================
   Timeline aggregation + icons
========================================================= */
function penTimeline(pen) {
  const out = [];
  const push = (date, icon, label, notes) => out.push({ date: date || "", icon, label: label || "", notes: notes || "" });

  (pen.nibHistory || []).forEach((h) => push(h.date, "✒️", `Feder: ${nibLabel(h.nibId)}`, h.notes));
  (pen.feedHistory || []).forEach((h) => {
    const mat = (h.feedMaterial || getFeedMaterialById(h.feedId) || "").trim();
    const matTxt = mat ? ` (${mat})` : "";
    push(h.date, "🧩", `Feed: ${feedLabel(h.feedId)}${matTxt}`, h.notes);
  });

  (pen.inkHistory || []).forEach((h) => {
    if (h.type === "ink_cleaned") push(h.date, "🧽", `Reinigung`, h.notes);
    else push(h.date, "💧", `Tinte gefüllt: ${inkLabel(h.inkId)}`, h.notes);
  });

  out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return out;
}

function globalRecentActivity(limit = 12) {
  const items = [];

  for (const p of pens) {
    if (p?.boughtAt) {
      items.push({
        date: p.boughtAt,
        icon: "🖋️",
        label: `Füller: ${getDisplayName("pens", p)} gekauft`,
        notes: "",
        penId: p.id,
        penName: getDisplayName("pens", p),
      });
    }
  }

  for (const i of inks) {
    if (i?.lastPurchasedAt) {
      items.push({
        date: i.lastPurchasedAt,
        icon: "🧴",
        label: `Tinte: ${getDisplayName("inks", i)} gekauft`,
        notes: "",
        penId: "",
        penName: getDisplayName("inks", i),
      });
    }
  }

  for (const p of pens) {
    const tl = penTimeline(p);
    for (const t of tl) {
      items.push({
        date: t.date,
        icon: t.icon,
        label: t.label,
        notes: t.notes,
        penId: p.id,
        penName: getDisplayName("pens", p),
      });
    }
  }
  items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return items.slice(0, limit);
}

/* =========================================================
   Master data card (FULL: add + lists + remove)
========================================================= */
function renderMasterDataCard({ includeNib = false, includeFeed = false } = {}) {
  const nibBlock = includeNib
    ? `
    <div class="hr"></div>
    <div style="font-weight:900;">Feder-Stammdaten</div>
    <div class="muted">Material / Größe / Typ / Hersteller</div>

    <div class="grid2" style="margin-top:10px;">
      <div>
        <div class="label">Neues Material</div>
        <div class="row">
          <input id="md_newNibMaterial" placeholder="z.B. Titan" />
          <button class="btn success" id="md_addNibMaterial">+ Material</button>
        </div>
      </div>
      <div>
        <div class="label">Neue Größe</div>
        <div class="row">
          <input id="md_newNibSize" placeholder="z.B. #10" />
          <button class="btn success" id="md_addNibSize">+ Größe</button>
        </div>
      </div>
    </div>

    <div class="grid2" style="margin-top:10px;">
      <div>
        <div class="label">Neuer Typ</div>
        <div class="row">
          <input id="md_newNibType" placeholder="z.B. Architect" />
          <button class="btn success" id="md_addNibType">+ Typ</button>
        </div>
      </div>
      <div>
        <div class="label">Neuer Hersteller</div>
        <div class="row">
          <input id="md_newNibMaker" placeholder="z.B. Aurora" />
          <button class="btn success" id="md_addNibMaker">+ Hersteller</button>
        </div>
      </div>
    </div>
  `
    : "";

  const feedBlock = includeFeed
    ? `
    <div class="hr"></div>
    <div style="font-weight:900;">Feed-Stammdaten</div>
    <div class="muted">Hersteller- & Material-Liste</div>

    <div class="grid2" style="margin-top:10px;">
      <div>
        <div class="label">Neuer Feed-Hersteller</div>
        <div class="row">
          <input id="md_newFeedMaker" placeholder="z.B. Jowo" />
          <button class="btn success" id="md_addFeedMaker">+ Feed-Maker</button>
        </div>
      </div>
      <div>
        <div class="label">Neues Feed-Material</div>
        <div class="row">
          <input id="md_newFeedMaterial" placeholder="z.B. Ebonit" />
          <button class="btn success" id="md_addFeedMaterial">+ Material</button>
        </div>
      </div>
    </div>
  `
    : "";

  const mkList = (id, title) => `
    <div>
      <div style="font-weight:900;margin:10px 0 6px;">${esc(title)}</div>
      <div id="${esc(id)}"></div>
    </div>
  `;

  return `
    <div class="card">
      <details style="margin-top:0;">
        <summary style="cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:12px; font-weight:900;">
          <span>Stammdaten</span>
          <span class="muted" style="font-weight:700;">Ausklappen</span>
        </summary>
        <div style="margin-top:12px;">
          <div class="muted">Marken, Händler und technische Listen pflegen.</div>

          <div class="hr"></div>

      <div class="grid2">
        <div>
          <div class="label">Neue Füller-Marke</div>
          <div class="row">
            <input id="md_newPenBrand" placeholder="z.B. Pelikan" />
            <button class="btn success" id="md_addPenBrand">+ Marke</button>
          </div>
        </div>
        <div>
          <div class="label">Neue Tinten-Marke</div>
          <div class="row">
            <input id="md_newInkBrand" placeholder="z.B. Iroshizuku" />
            <button class="btn success" id="md_addInkBrand">+ Marke</button>
          </div>
        </div>
      </div>

      <div style="margin-top:10px;">
        <div class="label">Neue Bezugsquelle (Händler)</div>
        <div class="row">
          <input id="md_newVendor" placeholder="z.B. Appelboom" />
          <button class="btn success" id="md_addVendor">+ Händler</button>
        </div>
      </div>

      ${nibBlock}
      ${feedBlock}

      <div class="hr"></div>

      <div class="grid2">
        ${mkList("md_penBrandList", "Füller-Marken")}
        ${mkList("md_inkBrandList", "Tinten-Marken")}
      </div>

      <div class="grid2" style="margin-top:10px;">
        ${mkList("md_vendorList", "Händler")}
        ${
          includeFeed
            ? mkList("md_feedMakerList", "Feed-Hersteller")
            : `<div class="muted">—</div>`
        }
      </div>

      ${
        includeFeed
          ? `<div class="grid2" style="margin-top:10px;">
              ${mkList("md_feedMaterialList", "Feed-Material")}
              <div class="muted">—</div>
            </div>`
          : ""
      }

      ${
        includeNib
          ? `
        <div class="grid2" style="margin-top:10px;">
          ${mkList("md_nibMaterialList", "Feder-Material")}
          ${mkList("md_nibSizeList", "Feder-Größen")}
        </div>
        <div class="grid2" style="margin-top:10px;">
          ${mkList("md_nibTypeList", "Feder-Typen")}
          ${mkList("md_nibMakerList", "Feder-Hersteller")}
        </div>
      `
          : ""
      }
        </div>
      </details>
    </div>
  `;
}

function wireMasterDataCard(rootEl, { includeNib = false, includeFeed = false } = {}) {
  function uniqPush(arr, val) {
    const v = (val || "").trim();
    if (!v) return false;
    if (!arr.includes(v)) arr.push(v);
    return true;
  }
  const mk = (txt, kind) => `
    <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div style="font-weight:900;">${esc(txt)}</div>
      <button class="btn danger" data-md-kind="${esc(kind)}" data-md-x="${esc(txt)}" style="padding:6px 10px;">Entfernen</button>
    </div>
  `;

  function renderLists() {
    const incFeed = !!includeFeed;
    const incNib = !!includeNib;

    const q = (id) => rootEl.querySelector(`#${CSS.escape(id)}`);
    const setHTML = (id, html) => {
      const el = q(id);
      if (el) el.innerHTML = html;
    };

    const listHtml = (arr, kind) =>
      (arr || [])
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map((x) => mk(x, kind))
        .join("") || `<div class="muted">—</div>`;

    setHTML("md_penBrandList", listHtml(meta.master.penBrands, "penBrand"));
    setHTML("md_inkBrandList", listHtml(meta.master.inkBrands, "inkBrand"));
    setHTML("md_vendorList", listHtml(meta.master.vendors, "vendor"));

    if (incFeed) {
      setHTML("md_feedMakerList", listHtml(meta.master.feedMakers, "feedMaker"));
      setHTML("md_feedMaterialList", listHtml(meta.master.feedMaterials, "feedMaterial"));
    }

    if (incNib) {
      setHTML("md_nibMaterialList", listHtml(meta.master.nibMaterials, "nibMaterial"));
      setHTML("md_nibSizeList", listHtml(meta.master.nibSizes, "nibSize"));
      setHTML("md_nibTypeList", listHtml(meta.master.nibTypes, "nibType"));
      setHTML("md_nibMakerList", listHtml(meta.master.nibMakers, "nibMaker"));
    }

    rootEl.querySelectorAll("button[data-md-kind]").forEach((btn) => {
      btn.onclick = async () => {
        const kind = btn.getAttribute("data-md-kind");
        const val = btn.getAttribute("data-md-x");
        const m = meta.master;

        if (kind === "penBrand") m.penBrands = m.penBrands.filter((x) => x !== val);
        if (kind === "inkBrand") m.inkBrands = m.inkBrands.filter((x) => x !== val);
        if (kind === "vendor") m.vendors = m.vendors.filter((x) => x !== val);

        if (kind === "feedMaker") m.feedMakers = m.feedMakers.filter((x) => x !== val);
        if (kind === "feedMaterial") m.feedMaterials = m.feedMaterials.filter((x) => x !== val);

        if (kind === "nibMaterial") m.nibMaterials = m.nibMaterials.filter((x) => x !== val);
        if (kind === "nibSize") m.nibSizes = m.nibSizes.filter((x) => x !== val);
        if (kind === "nibType") m.nibTypes = m.nibTypes.filter((x) => x !== val);
        if (kind === "nibMaker") m.nibMakers = m.nibMakers.filter((x) => x !== val);

        await saveVault();
        renderView();
      };
    });
  }

  // ---- Add buttons (scoped to rootEl) ----
  const q2 = (id) => rootEl.querySelector(`#${CSS.escape(id)}`);

  q2("md_addPenBrand")?.addEventListener("click", async () => {
    if (uniqPush(meta.master.penBrands, q2("md_newPenBrand")?.value)) {
      if (q2("md_newPenBrand")) q2("md_newPenBrand").value = "";
      await saveVault();
      renderView();
    }
  });
  q2("md_addInkBrand")?.addEventListener("click", async () => {
    if (uniqPush(meta.master.inkBrands, q2("md_newInkBrand")?.value)) {
      if (q2("md_newInkBrand")) q2("md_newInkBrand").value = "";
      await saveVault();
      renderView();
    }
  });
  q2("md_addVendor")?.addEventListener("click", async () => {
    if (uniqPush(meta.master.vendors, q2("md_newVendor")?.value)) {
      if (q2("md_newVendor")) q2("md_newVendor").value = "";
      await saveVault();
      renderView();
    }
  });

  if (!!includeFeed) {
    q2("md_addFeedMaker")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.feedMakers, q2("md_newFeedMaker")?.value)) {
        if (q2("md_newFeedMaker")) q2("md_newFeedMaker").value = "";
        await saveVault();
        renderView();
      }
    });
    q2("md_addFeedMaterial")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.feedMaterials, q2("md_newFeedMaterial")?.value)) {
        if (q2("md_newFeedMaterial")) q2("md_newFeedMaterial").value = "";
        await saveVault();
        renderView();
      }
    });
  }

  if (!!includeNib) {
    q2("md_addNibMaterial")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibMaterials, q2("md_newNibMaterial")?.value)) {
        if (q2("md_newNibMaterial")) q2("md_newNibMaterial").value = "";
        await saveVault();
        renderView();
      }
    });
    q2("md_addNibSize")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibSizes, q2("md_newNibSize")?.value)) {
        if (q2("md_newNibSize")) q2("md_newNibSize").value = "";
        await saveVault();
        renderView();
      }
    });
    q2("md_addNibType")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibTypes, q2("md_newNibType")?.value)) {
        if (q2("md_newNibType")) q2("md_newNibType").value = "";
        await saveVault();
        renderView();
      }
    });
    q2("md_addNibMaker")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibMakers, q2("md_newNibMaker")?.value)) {
        if (q2("md_newNibMaker")) q2("md_newNibMaker").value = "";
        await saveVault();
        renderView();
      }
    });
  }


  $("md_addPenBrand")?.addEventListener("click", async () => {
    if (uniqPush(meta.master.penBrands, $("md_newPenBrand").value)) {
      $("md_newPenBrand").value = "";
      await saveVault();
      renderView();
    }
  });
  $("md_addInkBrand")?.addEventListener("click", async () => {
    if (uniqPush(meta.master.inkBrands, $("md_newInkBrand").value)) {
      $("md_newInkBrand").value = "";
      await saveVault();
      renderView();
    }
  });
  $("md_addVendor")?.addEventListener("click", async () => {
    if (uniqPush(meta.master.vendors, $("md_newVendor").value)) {
      $("md_newVendor").value = "";
      await saveVault();
      renderView();
    }
  });

  if (includeFeed) {
    $("md_addFeedMaker")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.feedMakers, $("md_newFeedMaker").value)) {
        $("md_newFeedMaker").value = "";
        await saveVault();
        renderView();
      }
    });
    $("md_addFeedMaterial")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.feedMaterials, $("md_newFeedMaterial").value)) {
        $("md_newFeedMaterial").value = "";
        await saveVault();
        renderView();
      }
    });
  }

  if (includeNib) {
    $("md_addNibMaterial")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibMaterials, $("md_newNibMaterial").value)) {
        $("md_newNibMaterial").value = "";
        await saveVault();
        renderView();
      }
    });
    $("md_addNibSize")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibSizes, $("md_newNibSize").value)) {
        $("md_newNibSize").value = "";
        await saveVault();
        renderView();
      }
    });
    $("md_addNibType")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibTypes, $("md_newNibType").value)) {
        $("md_newNibType").value = "";
        await saveVault();
        renderView();
      }
    });
    $("md_addNibMaker")?.addEventListener("click", async () => {
      if (uniqPush(meta.master.nibMakers, $("md_newNibMaker").value)) {
        $("md_newNibMaker").value = "";
        await saveVault();
        renderView();
      }
    });
  }

  renderLists();
}

/* =========================================================
   Render
========================================================= */
function render() {
  closeAnyDropdown();
  ensureColResizeStyles();
  try { document.body.classList.toggle("tableMode", String(entity||"").endsWith("_table") || entity === "finance" || entity === "edc" || entity === "dashboard"); } catch(_) {}
  renderNav();
  renderList();
  renderView();
  setEnabled(connected);
}

function renderNav() {
  document.querySelectorAll(".navItem").forEach((n) => n.classList.toggle("active", n.dataset.entity === entity));
}

function pillBadge(text) {
  return `<span class="pill">${esc(text)}</span>`;
}
function penBadges(p) {
  const arr = [];
  if (p.currentInkId) arr.push(pillBadge("befüllt"));
  if (firstPenPhoto(p)) arr.push(pillBadge("📷"));
  if (p.limitedEdition) arr.push(pillBadge("L.E."));
  // NEW: badge for ebonite feed
  if (isPenEboniteFeed(p)) arr.push(pillBadge("🪵 Ebonit-Feed"));
  return arr.join(" ");
}


function edcBadgeForPen(penId) {
  const es = (events || []).filter(e => e && e.type === "edc_day" && e.date && Array.isArray(e.penIds));
  const hits = es.filter(e => (e.penIds || []).includes(penId));
  const count = hits.length;
  if (!count) return "";

  const last = hits.map(e => String(e.date)).sort().pop(); // YYYY-MM-DD

  const todayISO = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  })();

  const daysBetween = (aISO, bISO) => {
    const a = new Date(aISO + "T00:00:00").getTime();
    const b = new Date(bISO + "T00:00:00").getTime();
    return Math.max(0, Math.floor((b - a) / 86400000));
  };

  const pauseDays = daysBetween(last, todayISO);

  return `
    <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
      <span class="pill">📅 ${count}× im EDC</span>
      <span class="pill">⏳ ${pauseDays} Tage Pause</span>
      <span class="pill">📆 Letzte Nutzung: ${esc(last)}</span>
    </div>
  `;
}



//function inkBadges(i) {
  //const arr = [];
  //const c = i?.colorHex || "#777777";
  // color swatch always shown (falls unknown: grey)
  //arr.push(`<span class="ink-swatch" style="--c:${esc(c)};" title="${esc(i?.color || "")} (${esc(c)})"></span>`);
  //if (i?.sheen) arr.push(`<span class="miniPill" title="Sheen">✨</span>`);
  //if (i?.shimmer) arr.push(`<span class="miniPill" title="Shimmer">🌟</span>`);
  //return `<span class="inkBadges">${arr.join("")}</span>`;
//}
function inkBadges(i) {
  const arr = [];

  if (i?.sheen) {
    arr.push(`<span class="miniPill" title="Sheen">🌈</span>`);
  }

  if (i?.shimmer) {
    arr.push(`<span class="miniPill" title="Shimmer">✨</span>`);
  }

  const c = i?.colorHex || "#777777";
  // color swatch always shown (falls unknown: grey)
  arr.push(
    `<span class="ink-swatch" style="--c:${esc(c)};" title="${esc(i?.color || "")} (${esc(c)})"></span>`
  );

  return `<span class="inkBadges">${arr.join("")}</span>`;
}

function renderList() {
  // Full-screen tabs: hide the middle column
  if (entity === "finance" || entity === "edc" || entity === "dashboard") {
    const listEl = $("list");
    if (listEl) listEl.innerHTML = "";
    return;
  }

  const listEl = $("list");
  if (!listEl) return;
  listEl.innerHTML = "";

  let arr = searchFilter(getArrayForEntity(entity));
  arr = arr
    .slice()
    .sort((a, b) => getDisplayName(entity, a).localeCompare(getDisplayName(entity, b)));

  for (const item of arr) {
    const div = document.createElement("div");
    div.className = "list-item" + (item.id === selectedId ? " active" : "");
    const extra = entity === "pens" ? penBadges(item) : (entity === "inks" ? inkBadges(item) : "");
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <div style="font-weight:900">${esc(getDisplayName(entity, item))}</div>
        <div>${extra}</div>
      </div>
      <div class="muted">${esc(item.id)}</div>
    `;
    div.onclick = () => {
      selectedId = item.id;
      render();
    };
    listEl.appendChild(div);
  }
}

/* =========================================================
   Views
========================================================= */
/* =========================================================
   Table Views (Pens / Inks)
========================================================= */
let tableSort = {
  pens_table: { key: "id", dir: "asc" },
  inks_table: { key: "id", dir: "asc" },
};
function normForCompare(v){ if(v===null||v===undefined) return ""; return String(v).toLowerCase(); }
function isNumeric(v){ return typeof v==="number" || (typeof v==="string" && v.trim()!=="" && !isNaN(Number(v))); }
function asNumber(v){ if(v===null||v===undefined) return NaN; return Number(String(v).replace(",", ".")); }
function asDate(v){ if(!v) return NaN; const t = Date.parse(v); return isNaN(t)?NaN:t; }
function cmp(a,b,dir){
  if(a===b) return 0;
  const mul = dir==="desc" ? -1 : 1;
  const da = asDate(a), db = asDate(b);
  if(!isNaN(da) || !isNaN(db)){
    const va = isNaN(da)?-1:da, vb = isNaN(db)?-1:db;
    if(va===vb) return 0;
    return va<vb ? -1*mul : 1*mul;
  }
  if(isNumeric(a) || isNumeric(b)){
    const na = asNumber(a), nb = asNumber(b);
    const va = isNaN(na)?-1:na, vb = isNaN(nb)?-1:nb;
    if(va===vb) return 0;
    return va<vb ? -1*mul : 1*mul;
  }
  const sa = normForCompare(a), sb = normForCompare(b);
  if(sa===sb) return 0;
  return sa<sb ? -1*mul : 1*mul;
}
function thLabel(label,key,entityName){
  const s = tableSort[entityName];
  const arrow = s && s.key===key ? (s.dir==="asc" ? " ▲" : " ▼") : "";
  return `${label}${arrow}`;
}
function inkNameById(id){
  const i = (inks||[]).find(x=>x.id===id);
  if(!i) return "";
  return `${i.brand||""} ${i.name||""}`.trim();
}
function nibNameById(id){
  const n = (nibs||[]).find(x=>x.id===id);
  if(!n) return "";
  return (n.label||"").trim();
}

// ==== Table column resizing (persisted) ====
function cssEscape(s){
  try{ return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$"); }
  catch(e){ return String(s); }
}

function tableWidthStoreKey(entityName){ return `fpv_table_colwidths_${entityName}`; }
function loadTableColWidths(entityName){
  try{ return JSON.parse(localStorage.getItem(tableWidthStoreKey(entityName))||"{}") || {}; }
  catch(e){ return {}; }
}
function saveTableColWidths(entityName, widths){
  try{ localStorage.setItem(tableWidthStoreKey(entityName), JSON.stringify(widths||{})); }catch(e){}
}
function applyColWidth(viewEl, entityName, colKey, px){
  const colEl = viewEl.querySelector(`table.fpvTable col[data-col="${cssEscape(colKey)}"]`);
  if(colEl){ colEl.style.width = `${Math.max(40, px)}px`; }
  // also enforce on header/td for some browsers
  viewEl.querySelectorAll(`table.fpvTable th[data-col="${cssEscape(colKey)}"], table.fpvTable td[data-col="${cssEscape(colKey)}"]`)
    .forEach(el=>{ el.style.width = `${Math.max(40, px)}px`; el.style.maxWidth = `${Math.max(40, px)}px`; });
}
function wireTableColumnResizers(viewEl, entityName){
  const table = viewEl.querySelector("table.fpvTable");
  if(!table) return;

  const widths = loadTableColWidths(entityName);

  // Apply stored widths
  Object.entries(widths).forEach(([k,v])=>{
    if(typeof v==="number" && isFinite(v)) applyColWidth(viewEl, entityName, k, v);
  });

  let drag = null; // {colKey,startX,startW}
  const onMove = (e)=>{
    if(!drag) return;
    const dx = (e.clientX - drag.startX);
    const newW = drag.startW + dx;
    applyColWidth(viewEl, entityName, drag.colKey, newW);
  };
  const onUp = ()=>{
    if(!drag) return;
    // persist
    widths[drag.colKey] = Math.max(40, drag.currentW || drag.startW);
    // read actual from col
    const colEl = viewEl.querySelector(`table.fpvTable col[data-col="${cssEscape(drag.colKey)}"]`);
    if(colEl){
      const w = parseFloat(colEl.style.width||"");
      if(isFinite(w)) widths[drag.colKey] = Math.max(40, w);
    }
    saveTableColWidths(entityName, widths);

    document.body.classList.remove("isResizingCols");
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    // block any sort-click that might fire after resizing
    colResizeBlockClickUntil = Date.now() + 300;
    drag = null;
  };

  viewEl.querySelectorAll(`.colResizer[data-entity="${cssEscape(entityName)}"]`).forEach((h)=>{
    h.addEventListener("pointerdown",(e)=>{
      e.preventDefault();
      e.stopPropagation(); // IMPORTANT: avoid triggering sort click
      colResizeBlockClickUntil = Date.now() + 1000;
      const colKey = h.getAttribute("data-col");
      const th = h.closest("th");
      if(!th || !colKey) return;

      // compute current width
      const rect = th.getBoundingClientRect();
      const startW = rect.width;

      drag = { colKey, startX: e.clientX, startW };
      document.body.classList.add("isResizingCols");

      // capture pointer so we don't lose drag
      try{ h.setPointerCapture(e.pointerId); }catch(_){}
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
    }, {capture:true});
    // also block click
    h.addEventListener("click",(e)=>{ e.preventDefault(); e.stopPropagation(); }, {capture:true});
  });
}

function renderPensTableView(viewEl){
  const query = ($("search")?.value || "").trim().toLowerCase();
  const rows = (pens||[]).filter(p=>{
    if(!query) return true;
    const hay = `${p.id} ${p.brand||""} ${p.model||""} ${p.boughtFrom||""} ${p.boughtAt||""} ${p.currency||""} ${p.price??""}`.toLowerCase();
    return hay.includes(query);
  });

  const sortKey = tableSort.pens_table?.key || "id";
  const sortDir = tableSort.pens_table?.dir || "asc";
  const rowsSorted = rows
    .map((p)=>({p, currentInk: p.currentInkId?inkNameById(p.currentInkId):"", currentNib: p.currentNibId?(`${p.currentNibId} — ${nibNameById(p.currentNibId)}`):""}))
    .sort((a,b)=>cmp(a.p[sortKey] ?? a[sortKey], b.p[sortKey] ?? b[sortKey], sortDir))
    .map(x=>x.p);

  const cols = [
    { key:"id", label:"ID" },
    { key:"brand", label:"Marke" },
    { key:"model", label:"Modell" },
    { key:"limitedEdition", label:"L.E." },
    { key:"currentInk", label:"Aktuelle Tinte" },
    { key:"currentNib", label:"Aktuelle ✒️" },
    { key:"price", label:"Preis" },
    { key:"currency", label:"Währung" },
    { key:"boughtAt", label:"Gekauft am" },
    { key:"boughtFrom", label:"Gekauft von" },
  ];
  const colWidths = loadTableColWidths("pens_table");
  const colgroupPens = `<colgroup>${cols.map(c=>{
    const w = colWidths[c.key];
    return `<col data-col="${c.key}"${(typeof w==="number" && isFinite(w)) ? ` style="width:${Math.max(40,w)}px"` : ""}>`;
  }).join("")}</colgroup>`;


  viewEl.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;">
        <div>
          <div style="font-size:20px;font-weight:1000;">Füller – Tabelle</div>
          <div class="muted">Sortieren: Klick auf Spaltenkopf • Filter: Suche</div>
        </div>
        <div class="pill">${rowsSorted.length} Einträge</div>
      </div>
      <div class="hr"></div>
      <div class="tableWrap">
        <table class="fpvTable" data-entity="pens_table">
          ${colgroupPens}
          <thead>
            <tr>
              <th data-sort="id" data-col="id"><div class="thWrap"><span class="thText">${thLabel("ID","id","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="id"></span></div></th>
              <th data-sort="brand" data-col="brand"><div class="thWrap"><span class="thText">${thLabel("Marke","brand","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="brand"></span></div></th>
              <th data-sort="model" data-col="model"><div class="thWrap"><span class="thText">${thLabel("Modell","model","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="model"></span></div></th>
              <th data-sort="limitedEdition" data-col="limitedEdition" style="text-align:center;"><div class="thWrap"><span class="thText">${thLabel("L.E.","limitedEdition","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="limitedEdition"></span></div></th>
              <th data-sort="currentInk" data-col="currentInk"><div class="thWrap"><span class="thText">${thLabel("Aktuelle Tinte","currentInk","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="currentInk"></span></div></th>
              <th data-sort="currentNib" data-col="currentNib"><div class="thWrap"><span class="thText">${thLabel("Aktuelle ✒️","currentNib","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="currentNib"></span></div></th>
              <th data-sort="price" data-col="price" style="text-align:right;"><div class="thWrap"><span class="thText">${thLabel("Preis","price","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="price"></span></div></th>
              <th data-sort="currency" data-col="currency"><div class="thWrap"><span class="thText">${thLabel("Währung","currency","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="currency"></span></div></th>
              <th data-sort="boughtAt" data-col="boughtAt"><div class="thWrap"><span class="thText">${thLabel("Gekauft am","boughtAt","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="boughtAt"></span></div></th>
              <th data-sort="boughtFrom" data-col="boughtFrom"><div class="thWrap"><span class="thText">${thLabel("Gekauft von","boughtFrom","pens_table")}</span><span class="colResizer" data-entity="pens_table" data-col="boughtFrom"></span></div></th>
            </tr>
          </thead>
          <tbody>
            ${rowsSorted.map((p)=>{
              const ink = p.currentInkId ? inkNameById(p.currentInkId) : "";
              const nib = p.currentNibId ? `${p.currentNibId} — ${nibNameById(p.currentNibId)}` : "";
              return `
                <tr data-open-pen="${esc(p.id)}" style="cursor:pointer;">
                  <td>${esc(p.id)}</td>
                  <td>${esc(p.brand||"")}</td>
                  <td>${esc(p.model||"")}</td>
                  <td style="text-align:center;">${p.limitedEdition ? "✓":""}</td>
                  <td>${esc(ink)}</td>
                  <td>${esc(nib)}</td>
                  <td style="text-align:right;">${esc(p.price ?? "")}</td>
                  <td>${esc(p.currency||"")}</td>
                  <td>${esc(p.boughtAt||"")}</td>
                  <td>${esc(p.boughtFrom||"")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  wireTableColumnResizers(viewEl, "pens_table");

  viewEl.querySelectorAll("th[data-sort]").forEach((th)=>{
    th.style.cursor="pointer";
    th.addEventListener("click",(e)=>{
      // ignore click if it came from a column-resize action
      if(Date.now() < colResizeBlockClickUntil) return;
      if(e.target && e.target.closest && e.target.closest(".colResizer")) return;
      e.preventDefault(); e.stopPropagation();
      const key = th.getAttribute("data-sort");
      const s = tableSort.pens_table;
      if(s.key===key) s.dir = s.dir==="asc" ? "desc" : "asc";
      else { s.key = key; s.dir="asc"; }
      renderPensTableView(viewEl);
    });
  });
  viewEl.querySelectorAll("[data-open-pen]").forEach((tr)=>{
    tr.addEventListener("click",()=>{
      const pid = tr.getAttribute("data-open-pen");
      entity = "pens";
      selectedId = pid;
      render();
    });
  });
}

function renderInksTableView(viewEl){
  const query = ($("search")?.value || "").trim().toLowerCase();
  const rows = (inks||[]).filter(i=>{
    if(!query) return true;
    const hay = `${i.id} ${i.brand||""} ${i.name||""} ${i.color||""} ${i.currency||""} ${i.price??""} ${i.amountMl??""} ${i.boughtFrom||""} ${i.firstPurchasedAt||""} ${i.lastPurchasedAt||""}`.toLowerCase();
    return hay.includes(query);
  });

  const sortKey = tableSort.inks_table?.key || "id";
  const sortDir = tableSort.inks_table?.dir || "asc";
  const rowsSorted = rows.slice().sort((a,b)=>cmp(a[sortKey], b[sortKey], sortDir));

  const cols = [
    { key:"id", label:"ID" },
    { key:"brand", label:"Marke" },
    { key:"name", label:"Name" },
    { key:"color", label:"Farbe" },
    { key:"sheen", label:"Sheen" },
    { key:"shimmer", label:"Shimmer" },
    { key:"inStock", label:"Vorrätig" },
    { key:"amountMl", label:"Menge (ml)" },
    { key:"price", label:"Preis" },
    { key:"currency", label:"Währung" },
    { key:"lastPurchasedAt", label:"Zuletzt" },
    { key:"firstPurchasedAt", label:"Erstkauf" },
    { key:"boughtFrom", label:"Gekauft von" },
  ];
  const colWidths = loadTableColWidths("inks_table");
  const colgroupInks = `<colgroup>${cols.map(c=>{
    const w = colWidths[c.key];
    return `<col data-col="${c.key}"${(typeof w==="number" && isFinite(w)) ? ` style="width:${Math.max(40,w)}px"` : ""}>`;
  }).join("")}</colgroup>`;


  viewEl.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;">
        <div>
          <div style="font-size:20px;font-weight:1000;">Tinten – Tabelle</div>
          <div class="muted">Sortieren: Klick auf Spaltenkopf • Filter: Suche</div>
        </div>
        <div class="pill">${rowsSorted.length} Einträge</div>
      </div>
      <div class="hr"></div>
      <div class="tableWrap">
        <table class="fpvTable" data-entity="inks_table">
          ${colgroupInks}
          <thead>
            <tr>
              <th data-sort="id" data-col="id"><div class="thWrap"><span class="thText">${thLabel("ID","id","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="id"></span></div></th>
              <th data-sort="brand" data-col="brand"><div class="thWrap"><span class="thText">${thLabel("Marke","brand","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="brand"></span></div></th>
              <th data-sort="name" data-col="name"><div class="thWrap"><span class="thText">${thLabel("Name","name","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="name"></span></div></th>
              <th data-sort="color" data-col="color"><div class="thWrap"><span class="thText">${thLabel("Farbe","color","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="color"></span></div></th>
              <th data-sort="sheen" data-col="sheen" style="text-align:center;"><div class="thWrap"><span class="thText">${thLabel("Sheen","sheen","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="sheen"></span></div></th>
              <th data-sort="shimmer" data-col="shimmer" style="text-align:center;"><div class="thWrap"><span class="thText">${thLabel("Shimmer","shimmer","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="shimmer"></span></div></th>
              <th data-sort="inStock" data-col="inStock" style="text-align:center;"><div class="thWrap"><span class="thText">${thLabel("Vorrätig","inStock","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="inStock"></span></div></th>
              <th data-sort="amountMl" data-col="amountMl" style="text-align:right;"><div class="thWrap"><span class="thText">${thLabel("Menge (ml)","amountMl","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="amountMl"></span></div></th>
              <th data-sort="price" data-col="price" style="text-align:right;"><div class="thWrap"><span class="thText">${thLabel("Preis","price","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="price"></span></div></th>
              <th data-sort="currency" data-col="currency"><div class="thWrap"><span class="thText">${thLabel("Währung","currency","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="currency"></span></div></th>
              <th data-sort="lastPurchasedAt" data-col="lastPurchasedAt"><div class="thWrap"><span class="thText">${thLabel("Zuletzt","lastPurchasedAt","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="lastPurchasedAt"></span></div></th>
              <th data-sort="firstPurchasedAt" data-col="firstPurchasedAt"><div class="thWrap"><span class="thText">${thLabel("Erstkauf","firstPurchasedAt","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="firstPurchasedAt"></span></div></th>
              <th data-sort="boughtFrom" data-col="boughtFrom"><div class="thWrap"><span class="thText">${thLabel("Gekauft von","boughtFrom","inks_table")}</span><span class="colResizer" data-entity="inks_table" data-col="boughtFrom"></span></div></th>
            </tr>
          </thead>
          <tbody>
            ${rowsSorted.map((i)=>{
              const c = i.colorHex || "#777";
              const sw = `<span class="ink-swatch" style="--c:${esc(c)};" title="${esc(i.color||"")} (${esc(c)})"></span>`;
              return `
                <tr data-open-ink="${esc(i.id)}" style="cursor:pointer;">
                  <td>${esc(i.id)}</td>
                  <td>${esc(i.brand||"")}</td>
                  <td>${esc(i.name||"")}</td>
                  <td><span class="muted">${esc(i.color||"")}</span> ${sw}</td>
                  <td style="text-align:center;">${i.sheen ? "✓":""}</td>
                  <td style="text-align:center;">${i.shimmer ? "✓":""}</td>
                  <td style="text-align:center;">${i.inStock ? "✓":""}</td>
                  <td style="text-align:right;">${esc(i.amountMl ?? "")}</td>
                  <td style="text-align:right;">${esc(i.price ?? "")}</td>
                  <td>${esc(i.currency||"")}</td>
                  <td>${esc(i.lastPurchasedAt||"")}</td>
                  <td>${esc(i.firstPurchasedAt||"")}</td>
                  <td>${esc(i.boughtFrom||"")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  wireTableColumnResizers(viewEl, "inks_table");

  viewEl.querySelectorAll("th[data-sort]").forEach((th)=>{
    th.style.cursor="pointer";
    th.addEventListener("click",(e)=>{
      // ignore click if it came from a column-resize action
      if(Date.now() < colResizeBlockClickUntil) return;
      if(e.target && e.target.closest && e.target.closest(".colResizer")) return;
      e.preventDefault(); e.stopPropagation();
      const key = th.getAttribute("data-sort");
      const s = tableSort.inks_table;
      if(s.key===key) s.dir = s.dir==="asc" ? "desc" : "asc";
      else { s.key = key; s.dir="asc"; }
      renderInksTableView(viewEl);
    });
  });
  viewEl.querySelectorAll("[data-open-ink]").forEach((tr)=>{
    tr.addEventListener("click",()=>{
      const iid = tr.getAttribute("data-open-ink");
      entity = "inks";
      selectedId = iid;
      render();
    });
  });
}

function renderView() {
  const view = $("view");
  if (!view) return;
  view.innerHTML = "";

  if (!connected) {
    view.innerHTML = `<div class="card"><div class="muted">Bitte Passwort eingeben und “Connect” klicken.</div></div>`;
    return;
  }

  const vendorOptions = meta.master.vendors
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((x) => ({ value: x, label: x }));
  const currencyOptions = ["EUR", "USD", "GBP", "PLN", "JPY", "CHF"].map((x) => ({ value: x, label: x }));

  // Table views
  if (String(entity||"").endsWith("_table")) {
    if (entity === "pens_table") { renderPensTableView(view); return; }
    if (entity === "inks_table") { renderInksTableView(view); return; }
  }

  if (entity === "dashboard") {
  const filled = pens.filter((p) => !!p.currentInkId).length;

  // Call module renderer
  if (!window.DashboardUI || !window.DashboardUI.renderDashboardView) {
    view.innerHTML = `<div class="card"><div class="muted">Dashboard-Modul fehlt (ui-dashboard.js nicht geladen).</div></div>`;
    return;
  }

  window.DashboardUI.renderDashboardView({
    viewEl: view,
    stats: {
      penCount: pens.length,
      filledCount: filled,
      inkCount: inks.length,
      nibCount: nibs.length,
      feedCount: feeds.length,
    },
  });
  return;
}

  if (entity === "finance") {
    // Render finance statistics on the right
    if (!window.FinanceUI || !window.FinanceUI.renderFinanceView) {
      view.innerHTML = `<div class="card"><div class="muted">Finance-Modul fehlt (ui-finance.js nicht geladen).</div></div>`;
      return;
    }

    // Ensure a default section and render the finance view
    if (!selectedId) selectedId = "A";
    window.FinanceUI.renderFinanceView({ viewEl: view });

    // Scroll to selected section (A–E)
    const anchor = view.querySelector(`#fin_${CSS.escape(String(selectedId))}`);
    if (anchor) anchor.scrollIntoView({ block: "start" });

    return;
  }

  if (entity === "edc") {
    if (!window.EDCUI || !window.EDCUI.renderEDCView) {
      view.innerHTML = `<div class="card"><div class="muted">EDC-Modul fehlt (ui-edc.js nicht geladen).</div></div>`;
      return;
    }
    window.EDCUI.renderEDCView({ viewEl: view });
    return;
  }


  const obj = findById(entity, selectedId);
  if (!obj) {
    view.innerHTML = `<div class="card"><div class="muted">Kein Eintrag ausgewählt.</div></div>`;
    return;
  }

  /* ================== PENS ================== */
  if (entity === "pens") {
    obj.brand = obj.brand ?? "";
    obj.model = obj.model ?? "";
    obj.limitedEdition = !!obj.limitedEdition;
    obj.leNumber = obj.leNumber ?? "";
    obj.material = obj.material ?? "";
    obj.price = obj.price ?? null;
    obj.currency = obj.currency ?? "EUR";
    obj.boughtAt = obj.boughtAt ?? null;
    obj.boughtFrom = obj.boughtFrom ?? "";
    obj.notes = obj.notes ?? "";
    obj.attachments = Array.isArray(obj.attachments) ? obj.attachments : [];

    obj.originalNibId = obj.originalNibId ?? "";
    obj.currentNibId = obj.currentNibId ?? "";
    obj.nibHistory = Array.isArray(obj.nibHistory) ? obj.nibHistory : [];

    obj.originalFeedId = obj.originalFeedId ?? "";
    obj.currentFeedId = obj.currentFeedId ?? "";
    obj.feedHistory = Array.isArray(obj.feedHistory) ? obj.feedHistory : [];

    // NEW: cache current feed material (auto-update on feed change)
    obj.currentFeedMaterial = (obj.currentFeedMaterial ?? "").trim();

    obj.currentInkId = obj.currentInkId ?? "";
    obj.inkHistory = Array.isArray(obj.inkHistory) ? obj.inkHistory : [];

    const penBrandOptions = meta.master.penBrands.slice().sort((a, b) => a.localeCompare(b)).map((x) => ({ value: x, label: x }));
    const nibDbOptions = nibs
      .slice()
      .sort((a, b) => nibLabel(a.id).localeCompare(nibLabel(b.id)))
      .map((n) => ({ value: n.id, label: nibLabel(n.id) }));
    const feedDbOptions = feeds
      .slice()
      .sort((a, b) => feedLabel(a.id).localeCompare(feedLabel(b.id)))
      .map((f) => ({ value: f.id, label: feedLabel(f.id) }));
    const inkDbOptions = inks
      .slice()
      .sort((a, b) => inkLabel(a.id).localeCompare(inkLabel(b.id)))
      .map((i) => ({ value: i.id, label: inkLabel(i.id) }));

    const photos = obj.attachments.filter((a) => a.kind === "pen_photo" && isImageAttachment(a));
    const invoices = obj.attachments.filter((a) => a.kind === "pen_invoice");
    const cover = firstPenPhoto(obj);

    const timeline = penTimeline(obj);

    view.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-size:22px;font-weight:1000;">${esc(getDisplayName("pens", obj))}</div>
            <div class="muted">${esc(obj.id)} ${
      obj.currentInkId ? " • 💧 " + esc(inkLabel(obj.currentInkId)) : ""
    } ${isPenEboniteFeed(obj) ? " • 🪵 Ebonit-Feed" : ""}</div>
            ${edcBadgeForPen(obj.id)}
          </div>
          ${cover ? `<button class="btn info" id="p_openCover">Cover öffnen</button>` : ""}
        </div>

        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Marke</div>
            ${dropdownHtml({ id: "p_brand_dd", placeholder: "—", value: obj.brand, options: penBrandOptions })}
          </div>
          <div>
            <div class="label">Modell</div>
            <input id="p_model" value="${esc(obj.model)}" placeholder="z.B. 823 / 149 / Pro Gear" />
          </div>
        </div>

        <div class="row" style="margin-top:10px;flex-wrap:wrap;">
          <label class="row" style="gap:8px; cursor:pointer; align-items:center;">
            <input id="p_le" type="checkbox" ${obj.limitedEdition ? "checked" : ""}/>
            <span>Limited edition</span>
          </label>
          <div style="min-width:260px; flex:1;">
            <div class="label">LE Nummer (optional)</div>
            <input id="p_leNumber" value="${esc(obj.leNumber)}" placeholder="z.B. 123/500" />
          </div>
        </div>

        <div style="margin-top:10px;">
          <div class="label">Material (Füller)</div>
          <input id="p_material" value="${esc(obj.material)}" placeholder="z.B. Resin, Ebonite, Celluloid…" />
        </div>

        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Preis</div>
            <input id="p_price" inputmode="decimal" value="${esc(obj.price ?? "")}" />
          </div>
          <div>
            <div class="label">Währung</div>
            ${dropdownHtml({ id: "p_currency_dd", placeholder: "EUR", value: obj.currency, options: currencyOptions, searchable: false, clearable: false })}
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Gekauft am</div>
            <input id="p_boughtAt" type="date" value="${esc(toInputDate(obj.boughtAt))}" />
          </div>
          <div>
            <div class="label">Gekauft von</div>
            ${dropdownHtml({ id: "p_vendor_dd", placeholder: "—", value: obj.boughtFrom, options: vendorOptions })}
          </div>
        </div>

        <div class="hr"></div>

        <div style="font-weight:1000;">📷 Fotos (Füller)</div>
        <div class="muted">Miniaturen öffnen ein Overlay.</div>

        <div class="row" style="margin-top:10px;flex-wrap:wrap;">
          <input id="p_photoFile" type="file" accept="image/*" />
          <button class="btn success" id="p_uploadPhoto">Foto hochladen</button>
        </div>

        <div class="thumbGrid">
          ${
            photos.length
              ? photos
                  .map(
                    (a) => `
                <div class="thumb">
                  <img src="${esc(a.url)}" alt="${esc(a.filename || a.id)}" data-open-url="${esc(a.url)}" />
                  <div class="thumbBar">
                    <div class="pill" title="${esc(a.filename || a.id)}">${esc(a.filename || a.id)}</div>
                    <button class="btn danger" style="padding:6px 10px;" data-att="${esc(a.id)}">×</button>
                  </div>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted" style="grid-column: 1 / -1;">Noch keine Fotos.</div>`
          }
        </div>

        <div class="hr"></div>

        <div style="font-weight:1000;">🧾 Rechnung / Belege</div>
        <div class="muted">PDF oder Bild möglich.</div>

        <div class="row" style="margin-top:10px;flex-wrap:wrap;">
          <input id="p_invoiceFile" type="file" accept="image/*,application/pdf" />
          <button class="btn primary" id="p_uploadInvoice">Rechnung hochladen</button>
        </div>

        <div style="margin-top:10px;">
          ${
            invoices.length
              ? invoices
                  .map(
                    (a) => `
                <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                  <div>
                    <div style="font-weight:900;">${esc(a.filename || a.id)}</div>
                    <div class="muted" style="word-break:break-all;">${esc(a.url)}</div>
                  </div>
                  <div class="row" style="gap:8px;">
                    <a class="btn info" href="${esc(a.url)}" target="_blank" rel="noreferrer">Öffnen</a>
                    <button class="btn danger" data-att="${esc(a.id)}">Entfernen</button>
                  </div>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted">Keine Rechnungen.</div>`
          }
        </div>

        <div class="hr"></div>

        <div>
          <div class="label">Bemerkungen</div>
          <textarea id="p_notes" placeholder="…">${esc(obj.notes)}</textarea>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:1000;">💧 Tinte</div>
        <div class="muted">Aktuelle Tinte + Historie (gefüllt / gereinigt).</div>
        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Aktuelle Tinte</div>
            ${dropdownHtml({ id: "p_currInk_dd", placeholder: "—", value: obj.currentInkId, options: inkDbOptions })}
          </div>
          <div>
            <div class="label">Datum</div>
            <input id="p_inkEventDate" type="date" />
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Tinte auswählen (für “Gefüllt”)</div>
            ${dropdownHtml({ id: "p_inkPick_dd", placeholder: "—", value: "", options: inkDbOptions })}
          </div>
          <div class="row" style="gap:10px; align-items:flex-end;">
            <button class="btn success" id="p_btnInkFilled">+ Gefüllt</button>
            <button class="btn ghost" id="p_btnInkCleaned">+ Gereinigt</button>
          </div>
        </div>

        <div style="margin-top:10px;">
          <div class="label">Bemerkungen</div>
          <textarea id="p_inkNotes" placeholder="optional…"></textarea>
        </div>

        <div class="hr"></div>
        <div style="font-weight:900;">Ink-Historie</div>
        <div style="margin-top:8px;">
          ${
            obj.inkHistory.length
              ? obj.inkHistory
                  .slice()
                  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
                  .map(
                    (h) => `
                <div class="list-item" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                  <div>
                    <div style="font-weight:900;">
                      ${esc(h.date || "—")} — ${h.type === "ink_cleaned" ? "🧽 Reinigung" : "💧 Gefüllt"} ${
                      h.inkId ? "— " + esc(inkLabel(h.inkId)) : ""
                    }
                    </div>
                    <div class="muted">${esc(h.notes || "")}</div>
                  </div>
                  <button class="btn danger" data-ihid="${esc(h.id)}">Entfernen</button>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted">Noch keine Ink-Events erfasst.</div>`
          }
        </div>
      </div>

      <div class="card">
        <div style="font-weight:1000;">✒️ Feder</div>
        <div class="muted">Original/aktuell + Wechsel-Historie.</div>
        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Originalfeder (DB)</div>
            ${dropdownHtml({ id: "p_origNib_dd", placeholder: "—", value: obj.originalNibId, options: nibDbOptions })}
          </div>
          <div>
            <div class="label">Aktuelle Feder (DB)</div>
            ${dropdownHtml({ id: "p_currNib_dd", placeholder: "—", value: obj.currentNibId, options: nibDbOptions })}
          </div>
        </div>

        <div class="hr"></div>
        <details style="margin-top:0;">
          <summary style="cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:12px; font-weight:900;">
            <span>Originalfeder & Federwechsel</span>
            <span class="muted" style="font-weight:700;">ausklappen</span>
          </summary>
          <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;">
          <div>
            <div style="font-weight:900;">Originalfeder erfassen</div>
            <div class="muted">Neue Originalfeder erfassen und direkt diesem Füller zuweisen.</div>
          </div>
        </div>

        <div style="margin-top:12px;">
          <div>
            <div class="label">Label (optional)</div>
            <input id="p_newOrigNibLabel" value="${esc(ensureOriginalNibDraft(obj.id).label)}" placeholder="z.B. Bock 250 · 14k · EF" />
          </div>

          <div class="grid2" style="margin-top:10px;">
            <div>
              <div class="label">Material</div>
              ${dropdownHtml({ id: "p_newOrigNibMaterial_dd", placeholder: "—", value: ensureOriginalNibDraft(obj.id).material, options: meta.master.nibMaterials.map(x => ({ value: x, label: x })) })}
            </div>
            <div>
              <div class="label">Federgröße</div>
              ${dropdownHtml({ id: "p_newOrigNibSize_dd", placeholder: "—", value: ensureOriginalNibDraft(obj.id).size, options: meta.master.nibSizes.map(x => ({ value: x, label: x })) })}
            </div>
          </div>

          <div class="grid2" style="margin-top:10px;">
            <div>
              <div class="label">Typ</div>
              ${dropdownHtml({ id: "p_newOrigNibType_dd", placeholder: "—", value: ensureOriginalNibDraft(obj.id).type, options: meta.master.nibTypes.map(x => ({ value: x, label: x })) })}
            </div>
            <div>
              <div class="label">Hersteller</div>
              ${dropdownHtml({ id: "p_newOrigNibMaker_dd", placeholder: "—", value: ensureOriginalNibDraft(obj.id).maker, options: meta.master.nibMakers.map(x => ({ value: x, label: x })) })}
            </div>
          </div>

          <div class="grid2" style="margin-top:10px;">
            <div>
              <div class="label">Preis</div>
              <input id="p_newOrigNibPrice" inputmode="decimal" value="${esc(ensureOriginalNibDraft(obj.id).price)}" />
            </div>
            <div>
              <div class="label">Währung</div>
              ${dropdownHtml({ id: "p_newOrigNibCurrency_dd", placeholder: "EUR", value: ensureOriginalNibDraft(obj.id).currency || "EUR", options: currencyOptions, searchable: false, clearable: false })}
            </div>
          </div>

          <div class="grid2" style="margin-top:10px;">
            <div>
              <div class="label">Gekauft am</div>
              <input id="p_newOrigNibBoughtAt" type="date" value="${esc(toInputDate(ensureOriginalNibDraft(obj.id).boughtAt))}" />
            </div>
            <div>
              <div class="label">Gekauft von</div>
              ${dropdownHtml({ id: "p_newOrigNibVendor_dd", placeholder: "—", value: ensureOriginalNibDraft(obj.id).boughtFrom, options: vendorOptions })}
            </div>
          </div>

          <div style="margin-top:10px;">
            <div class="label">Bemerkungen</div>
            <textarea id="p_newOrigNibNotes" placeholder="optional…">${esc(ensureOriginalNibDraft(obj.id).notes)}</textarea>
          </div>

          <div class="row" style="margin-top:10px;flex-wrap:wrap;">
            <button class="btn success" id="p_createOrigNib">Anlegen und zuweisen</button>
          </div>
        </div>

        <div class="hr"></div>
        <div style="font-weight:900;">Federwechsel hinzufügen</div>

        <div class="grid2" style="margin-top:8px;">
          <div>
            <div class="label">Datum</div>
            <input id="p_nibChangeDate" type="date" />
          </div>
          <div>
            <div class="label">Feder auswählen</div>
            ${dropdownHtml({ id: "p_changeNib_dd", placeholder: "—", value: "", options: nibDbOptions })}
          </div>
        </div>

        <div style="margin-top:10px;">
          <div class="label">Bemerkungen</div>
          <textarea id="p_nibChangeNotes" placeholder="optional…"></textarea>
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn success" id="p_addNibChange">+ Federwechsel speichern</button>
        </div>

        <div class="hr"></div>
        <div style="font-weight:900;">Federwechsel-Historie</div>
        <div style="margin-top:8px;">
          ${
            obj.nibHistory.length
              ? obj.nibHistory
                  .slice()
                  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
                  .map(
                    (h) => `
                <div class="list-item" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                  <div>
                    <div style="font-weight:900;">${esc(h.date || "—")} — 🖋️ ${esc(nibLabel(h.nibId))}</div>
                    <div class="muted">${esc(h.notes || "")}</div>
                  </div>
                  <button class="btn danger" data-nhid="${esc(h.id)}">Entfernen</button>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted">Noch keine Federwechsel erfasst.</div>`
          }
        </div>
          </div>
        </details>
      </div>

      <div class="card">
        <div style="font-weight:1000;">🧩 Feed</div>
        <div class="muted">Original/aktuell + Wechsel-Historie (Material wird automatisch erkannt).</div>
        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Original-Feed (DB)</div>
            ${dropdownHtml({ id: "p_origFeed_dd", placeholder: "—", value: obj.originalFeedId, options: feedDbOptions })}
          </div>
          <div>
            <div class="label">Aktueller Feed (DB)</div>
            ${dropdownHtml({ id: "p_currFeed_dd", placeholder: "—", value: obj.currentFeedId, options: feedDbOptions })}
          </div>
        </div>

        <div class="hr"></div>
        <div style="font-weight:900;">Feedwechsel hinzufügen</div>

        <div class="grid2" style="margin-top:8px;">
          <div>
            <div class="label">Datum</div>
            <input id="p_feedChangeDate" type="date" />
          </div>
          <div>
            <div class="label">Feed auswählen</div>
            ${dropdownHtml({ id: "p_changeFeed_dd", placeholder: "—", value: "", options: feedDbOptions })}
          </div>
        </div>

        <div style="margin-top:10px;">
          <div class="label">Bemerkungen</div>
          <textarea id="p_feedChangeNotes" placeholder="optional…"></textarea>
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn success" id="p_addFeedChange">+ Feedwechsel speichern</button>
        </div>

        <div class="hr"></div>
        <div style="font-weight:900;">Feedwechsel-Historie</div>
        <div style="margin-top:8px;">
          ${
            obj.feedHistory.length
              ? obj.feedHistory
                  .slice()
                  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
                  .map((h) => {
                    const mat = (h.feedMaterial || getFeedMaterialById(h.feedId) || "").trim();
                    const matTxt = mat ? ` • <span class="pill">${esc(mat)}</span>` : "";
                    return `
                      <div class="list-item" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                        <div>
                          <div style="font-weight:900;">${esc(h.date || "—")} — 🧩 ${esc(feedLabel(h.feedId))} ${matTxt}</div>
                          <div class="muted">${esc(h.notes || "")}</div>
                        </div>
                        <button class="btn danger" data-fhid="${esc(h.id)}">Entfernen</button>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="muted">Noch keine Feedwechsel erfasst.</div>`
          }
        </div>
      </div>

      <div class="card">
        <div style="font-weight:1000;">⏱️ Timeline</div>
        <div class="muted">Zusammengefasste Historie (Ink/Feder/Feed).</div>
        <div class="hr"></div>

        <div>
          ${
            timeline.length
              ? timeline
                  .map(
                    (t) => `
                <div class="list-item">
                  <div style="font-weight:1000;">${esc(t.date || "—")} — ${esc(t.icon)} ${esc(t.label)}</div>
                  <div class="muted">${esc(t.notes || "")}</div>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted">Noch keine Historie vorhanden.</div>`
          }
        </div>
      </div>

      ${renderMasterDataCard({ includeNib: true, includeFeed: true })}
    `;

    wireMasterDataCard(view, { includeNib: true, includeFeed: true });

    setTimeout(() => {
      initDropdown("p_brand_dd", (v) => {
        obj.brand = v;
        renderList();
      });
      initDropdown("p_currency_dd", (v) => {
        obj.currency = v || "EUR";
      });
      initDropdown("p_vendor_dd", (v) => {
        obj.boughtFrom = v;
      });

      initDropdown("p_origNib_dd", (v) => {
        obj.originalNibId = v;
      });
      initDropdown("p_currNib_dd", (v) => {
        obj.currentNibId = v;
      });
      initDropdown("p_changeNib_dd", () => {});

      initDropdown("p_newOrigNibMaker_dd", (v) => {
        ensureOriginalNibDraft(obj.id).maker = v;
      });
      initDropdown("p_newOrigNibMaterial_dd", (v) => {
        ensureOriginalNibDraft(obj.id).material = v;
      });
      initDropdown("p_newOrigNibSize_dd", (v) => {
        ensureOriginalNibDraft(obj.id).size = v;
      });
      initDropdown("p_newOrigNibType_dd", (v) => {
        ensureOriginalNibDraft(obj.id).type = v;
      });
      initDropdown("p_newOrigNibVendor_dd", (v) => {
        ensureOriginalNibDraft(obj.id).boughtFrom = v;
      });
      initDropdown("p_newOrigNibCurrency_dd", (v) => {
        ensureOriginalNibDraft(obj.id).currency = v || "EUR";
      });

      initDropdown("p_origFeed_dd", (v) => {
        obj.originalFeedId = v;
      });

      // If user directly changes current feed, update cached material too (NEW)
      initDropdown("p_currFeed_dd", (v) => {
        obj.currentFeedId = v;
        obj.currentFeedMaterial = getFeedMaterialById(v) || "";
        renderList();
      });

      initDropdown("p_changeFeed_dd", () => {});

      initDropdown("p_currInk_dd", (v) => {
        obj.currentInkId = v;
        renderList();
      });
      initDropdown("p_inkPick_dd", () => {});

      $("p_openCover")?.addEventListener("click", () => {
        if (cover?.url) openLightbox(cover.url);
      });

      $("p_model").oninput = () => {
        obj.model = $("p_model").value;
        renderList();
      };
      $("p_le").onchange = () => {
        obj.limitedEdition = $("p_le").checked;
        render();
      };
      $("p_leNumber").oninput = () => {
        obj.leNumber = $("p_leNumber").value;
      };
      $("p_material").oninput = () => {
        obj.material = $("p_material").value;
      };
      $("p_price").oninput = () => {
        obj.price = numOrNull($("p_price").value);
      };
      $("p_boughtAt").onchange = () => {
        obj.boughtAt = fromInputDate($("p_boughtAt").value);
      };
      $("p_notes").oninput = () => {
        obj.notes = $("p_notes").value;
      };

      // photo upload + thumbnails
      $("p_uploadPhoto").onclick = async () => {
        const f = $("p_photoFile").files?.[0];
        if (!f) return alert("Bitte ein Foto auswählen.");
        setStatus("Upload Foto…");
        const up = await apiUploadFile(f);
        const fid = await nextId("file");
        obj.attachments.push({
          id: fid,
          kind: "pen_photo",
          url: up.url,
          pathname: up.pathname,
          filename: f.name,
          contentType: up.contentType,
          size: up.size,
          uploadedAt: new Date().toISOString(),
        });
        await saveVault();
        renderView();
        renderList();
      };

      // invoice upload
      $("p_uploadInvoice").onclick = async () => {
        const f = $("p_invoiceFile").files?.[0];
        if (!f) return alert("Bitte Datei auswählen.");
        setStatus("Upload Rechnung…");
        const up = await apiUploadFile(f);
        const fid = await nextId("file");
        obj.attachments.push({
          id: fid,
          kind: "pen_invoice",
          url: up.url,
          pathname: up.pathname,
          filename: f.name,
          contentType: up.contentType,
          size: up.size,
          uploadedAt: new Date().toISOString(),
        });
        await saveVault();
        renderView();
      };

      // open image in overlay
      view.querySelectorAll("[data-open-url]").forEach((img) => {
        img.addEventListener("click", () => {
          const url = img.getAttribute("data-open-url");
          if (url) openLightbox(url);
        });
      });

      // remove attachments
      view.querySelectorAll("button[data-att]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-att");
          obj.attachments = obj.attachments.filter((a) => a.id !== id);
          await saveVault();
          renderView();
          renderList();
        };
      });

      // ink events
      $("p_btnInkFilled").onclick = async () => {
        const date = $("p_inkEventDate").value;
        const inkId = getDDRoot("p_inkPick_dd")?.getAttribute("data-dd-value") || "";
        if (!date) return alert("Bitte Datum wählen.");
        if (!inkId) return alert("Bitte Tinte auswählen.");
        const id = await nextId("event");
        obj.inkHistory.push({ id, type: "ink_filled", date, inkId, notes: $("p_inkNotes").value || "" });
        obj.currentInkId = inkId;
        await saveVault();
        renderView();
        renderList();
      };
      $("p_btnInkCleaned").onclick = async () => {
        const date = $("p_inkEventDate").value;
        if (!date) return alert("Bitte Datum wählen.");
        const id = await nextId("event");
        obj.inkHistory.push({
          id,
          type: "ink_cleaned",
          date,
          inkId: obj.currentInkId || "",
          notes: $("p_inkNotes").value || "",
        });
        obj.currentInkId = "";
        await saveVault();
        renderView();
        renderList();
      };
      view.querySelectorAll("button[data-ihid]").forEach((btn) => {
        btn.onclick = async () => {
          const hid = btn.getAttribute("data-ihid");
          obj.inkHistory = obj.inkHistory.filter((h) => h.id !== hid);
          await saveVault();
          renderView();
          renderList();
        };
      });

      $("p_newOrigNibLabel") && ($("p_newOrigNibLabel").oninput = () => {
        ensureOriginalNibDraft(obj.id).label = $("p_newOrigNibLabel").value;
      });
      $("p_newOrigNibPrice") && ($("p_newOrigNibPrice").oninput = () => {
        ensureOriginalNibDraft(obj.id).price = $("p_newOrigNibPrice").value;
      });
      $("p_newOrigNibBoughtAt") && ($("p_newOrigNibBoughtAt").onchange = () => {
        ensureOriginalNibDraft(obj.id).boughtAt = fromInputDate($("p_newOrigNibBoughtAt").value);
      });
      $("p_newOrigNibNotes") && ($("p_newOrigNibNotes").oninput = () => {
        ensureOriginalNibDraft(obj.id).notes = $("p_newOrigNibNotes").value;
      });

      $("p_createOrigNib")?.addEventListener("click", async () => {
        await createOriginalNibFromDraftAndLink(obj);
        renderView();
        renderList();
      });
      // nib change
      $("p_addNibChange").onclick = async () => {
        const date = $("p_nibChangeDate").value;
        const nibId = getDDRoot("p_changeNib_dd")?.getAttribute("data-dd-value") || "";
        if (!date) return alert("Bitte Datum wählen.");
        if (!nibId) return alert("Bitte Feder auswählen.");
        const hid = await nextId("event");
        obj.nibHistory.push({ id: hid, date, nibId, notes: $("p_nibChangeNotes").value || "" });
        obj.currentNibId = nibId;
        await saveVault();
        renderView();
      };
      view.querySelectorAll("button[data-nhid]").forEach((btn) => {
        btn.onclick = async () => {
          const hid = btn.getAttribute("data-nhid");
          obj.nibHistory = obj.nibHistory.filter((h) => h.id !== hid);
          await saveVault();
          renderView();
        };
      });

      // feed change (NEW: auto material detection)
      $("p_addFeedChange").onclick = async () => {
        const date = $("p_feedChangeDate").value;
        const feedId = getDDRoot("p_changeFeed_dd")?.getAttribute("data-dd-value") || "";
        if (!date) return alert("Bitte Datum wählen.");
        if (!feedId) return alert("Bitte Feed auswählen.");

        const feedMat = getFeedMaterialById(feedId) || "";

        const hid = await nextId("event");
        obj.feedHistory.push({
          id: hid,
          date,
          feedId,
          feedMaterial: feedMat, // <-- stored automatically
          notes: $("p_feedChangeNotes").value || "",
        });

        obj.currentFeedId = feedId;
        obj.currentFeedMaterial = feedMat; // <-- cached on pen
        await saveVault();
        renderView();
        renderList();
      };

      view.querySelectorAll("button[data-fhid]").forEach((btn) => {
        btn.onclick = async () => {
          const hid = btn.getAttribute("data-fhid");
          obj.feedHistory = obj.feedHistory.filter((h) => h.id !== hid);

          // if current feed points to removed event's feed, keep current as-is; no auto rollback
          await saveVault();
          renderView();
          renderList();
        };
      });
    }, 0);

    return;
  }

  /* ================== INKS ================== */
  if (entity === "inks") {
    obj.brand = obj.brand ?? "";
    obj.name = obj.name ?? "";
    obj.color = obj.color ?? "";
    obj.colorHex = obj.colorHex ?? "#777777";
    obj.sheen = !!obj.sheen;
    obj.shimmer = !!obj.shimmer;
    obj.specialEdition = !!obj.specialEdition;
    obj.inStock = obj.inStock === undefined ? true : !!obj.inStock;

    obj.firstPurchasedAt = obj.firstPurchasedAt ?? null;
    obj.lastPurchasedAt = obj.lastPurchasedAt ?? null;
    obj.boughtFrom = obj.boughtFrom ?? "";

    obj.amountMl = obj.amountMl ?? null;
    obj.price = obj.price ?? null;
    obj.currency = obj.currency ?? "EUR";
    obj.notes = obj.notes ?? "";

    const inkBrandOptions = meta.master.inkBrands
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((x) => ({ value: x, label: x }));
    const ageMonths = monthsBetween(obj.lastPurchasedAt);
    const pricePerMl = safeDiv(obj.price, obj.amountMl);

    view.innerHTML = `
      <div class="card">
        <div style="font-size:22px;font-weight:1000;">${esc(getDisplayName("inks", obj))}</div>
        <div class="muted">${esc(obj.id)}</div>

        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Marke</div>
            ${dropdownHtml({ id: "i_brand_dd", placeholder: "—", value: obj.brand, options: inkBrandOptions })}
          </div>
          <div>
            <div class="label">Name der Tinte</div>
            <input id="i_name" value="${esc(obj.name)}" />
          </div>
        </div>

        
        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Farbe</div>
            <div class="row" style="align-items:center;gap:10px;">
              <input id="i_color" value="${esc(obj.color)}" placeholder="z.B. Blue / Teal / Black" />
              <input id="i_colorHex" type="color" value="${esc(obj.colorHex || "#777777")}" title="Farbpicker" style="width:44px;height:38px;padding:0;border-radius:10px;" />
              <!-- <span id="i_colorSwatch" class="ink-swatch" style="--c:${esc(obj.colorHex || "#777777")};"></span> -->
            </div>
          </div>
        </div>


        <div class="hr"></div>

        <div class="row" style="flex-wrap:wrap; align-items:center;">
          <label class="row" style="gap:8px; cursor:pointer; align-items:center;">
            <input id="i_sheen" type="checkbox" ${obj.sheen ? "checked" : ""}/> <span>Sheen</span>
          </label>
          <label class="row" style="gap:8px; cursor:pointer; align-items:center;">
            <input id="i_shimmer" type="checkbox" ${obj.shimmer ? "checked" : ""}/> <span>Shimmer</span>
          </label>
          <label class="row" style="gap:8px; cursor:pointer; align-items:center;">
            <input id="i_special" type="checkbox" ${obj.specialEdition ? "checked" : ""}/> <span>Special edition</span>
          </label>
          <label class="row" style="gap:8px; cursor:pointer; align-items:center;">
            <input id="i_stock" type="checkbox" ${obj.inStock ? "checked" : ""}/> <span>Vorrätig</span>
          </label>
        </div>

        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="label">Erst gekauft am</div>
            <input id="i_firstPurchasedAt" type="date" value="${esc(toInputDate(obj.firstPurchasedAt))}" />
          </div>
          <div>
            <div class="label">Zuletzt gekauft am</div>
            <input id="i_lastPurchasedAt" type="date" value="${esc(toInputDate(obj.lastPurchasedAt))}" />
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Gekauft von</div>
            ${dropdownHtml({ id: "i_vendor_dd", placeholder: "—", value: obj.boughtFrom, options: vendorOptions })}
          </div>
          <div>
            <div class="label">Vorrat wie alt (Monate)</div>
            <input value="${esc(ageMonths === "" ? "" : String(ageMonths))}" disabled />
          </div>
        </div>

        <div class="hr"></div>

        
        <div class="grid3">
          <div>
            <div class="label">Menge in ml</div>
            <input id="i_amountMl" inputmode="decimal" value="${esc(obj.amountMl ?? "")}" />
          </div>
          <div>
            <div class="label">Preis</div>
            <input id="i_price" inputmode="decimal" value="${esc(obj.price ?? "")}" />
          </div>
          <div>
            <div class="label">Währung</div>
            ${dropdownHtml({ id: "i_currency_dd", placeholder: "EUR", value: obj.currency, options: currencyOptions, searchable: false, clearable: false })}
          </div>
        </div>


        <div style="margin-top:10px;">
          <div class="label">Preis pro ml (dynamisch)</div>
          <input value="${esc(pricePerMl === null ? "" : fmtMoney(pricePerMl))}" disabled />
        </div>

        <div class="hr"></div>

        <div>
          <div class="label">Bemerkungen</div>
          <textarea id="i_notes">${esc(obj.notes)}</textarea>
        </div>
      </div>

      ${renderMasterDataCard({ includeNib: false, includeFeed: false })}
    `;

    wireMasterDataCard(view, { includeNib: false, includeFeed: false });

    setTimeout(() => {
      initDropdown("i_brand_dd", (v) => {
        obj.brand = v;
        renderList();
      });
      initDropdown("i_currency_dd", (v) => {
        obj.currency = v || "EUR";
      });
      initDropdown("i_vendor_dd", (v) => {
        obj.boughtFrom = v;
      });

      $("i_name").oninput = () => {
        obj.name = $("i_name").value;
        renderList();
      };
      $("i_color").oninput = () => {
        obj.color = $("i_color").value;
      };
      $("i_colorHex").oninput = () => {
        obj.colorHex = $("i_colorHex").value || "#777777";
        const sw = $("i_colorSwatch");
        if (sw) sw.style.setProperty("--c", obj.colorHex);
        // keep list/table swatch in sync
        renderList();
        if (String(entity || "").endsWith("_table")) renderView();
      };

      $("i_sheen").onchange = () => {
        obj.sheen = $("i_sheen").checked;
      };
      $("i_shimmer").onchange = () => {
        obj.shimmer = $("i_shimmer").checked;
      };
      $("i_special").onchange = () => {
        obj.specialEdition = $("i_special").checked;
      };
      $("i_stock").onchange = () => {
        obj.inStock = $("i_stock").checked;
      };

      $("i_firstPurchasedAt").onchange = () => {
        obj.firstPurchasedAt = fromInputDate($("i_firstPurchasedAt").value);
        renderView();
      };
      $("i_lastPurchasedAt").onchange = () => {
        obj.lastPurchasedAt = fromInputDate($("i_lastPurchasedAt").value);
        renderView();
      };

      $("i_amountMl").oninput = () => {
        obj.amountMl = numOrNull($("i_amountMl").value);
        renderView();
      };
      $("i_price").oninput = () => {
        obj.price = numOrNull($("i_price").value);
        renderView();
      };
      $("i_notes").oninput = () => {
        obj.notes = $("i_notes").value;
      };
    }, 0);

    return;
  }

  /* ================== NIBS ================== */
  if (entity === "nibs") {
    obj.label = obj.label ?? "";
    obj.material = obj.material ?? "";
    obj.size = obj.size ?? "";
    obj.type = obj.type ?? "";
    obj.maker = obj.maker ?? "";
    obj.price = obj.price ?? null;
    obj.currency = obj.currency ?? "EUR";
    obj.boughtAt = obj.boughtAt ?? null;
    obj.boughtFrom = obj.boughtFrom ?? "";
    obj.notes = obj.notes ?? "";
    obj.attachments = Array.isArray(obj.attachments) ? obj.attachments : [];

    const materialOptions = meta.master.nibMaterials.map((x) => ({ value: x, label: x }));
    const sizeOptions = meta.master.nibSizes.map((x) => ({ value: x, label: x }));
    const typeOptions = meta.master.nibTypes.map((x) => ({ value: x, label: x }));
    const makerOptions = meta.master.nibMakers.map((x) => ({ value: x, label: x }));

    const invoices = obj.attachments.filter((a) => a.kind === "nib_invoice");

    view.innerHTML = `
      <div class="card">
        <div style="font-size:22px;font-weight:1000;">${esc(getDisplayName("nibs", obj))}</div>
        <div class="muted">${esc(obj.id)}</div>

        <div class="hr"></div>

        <div>
          <div class="label">Label (optional)</div>
          <input id="n_label" value="${esc(obj.label)}" placeholder="z.B. Bock 250 · 14k · EF" />
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Material</div>
            ${dropdownHtml({ id: "n_material_dd", placeholder: "—", value: obj.material, options: materialOptions })}
          </div>
          <div>
            <div class="label">Federgröße</div>
            ${dropdownHtml({ id: "n_size_dd", placeholder: "—", value: obj.size, options: sizeOptions })}
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Typ</div>
            ${dropdownHtml({ id: "n_type_dd", placeholder: "—", value: obj.type, options: typeOptions })}
          </div>
          <div>
            <div class="label">Hersteller</div>
            ${dropdownHtml({ id: "n_maker_dd", placeholder: "—", value: obj.maker, options: makerOptions })}
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Preis</div>
            <input id="n_price" inputmode="decimal" value="${esc(obj.price ?? "")}" />
          </div>
          <div>
            <div class="label">Währung</div>
            ${dropdownHtml({ id: "n_currency_dd", placeholder: "EUR", value: obj.currency, options: currencyOptions, searchable: false, clearable: false })}
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Gekauft am</div>
            <input id="n_boughtAt" type="date" value="${esc(toInputDate(obj.boughtAt))}" />
          </div>
          <div>
            <div class="label">Gekauft von</div>
            ${dropdownHtml({ id: "n_vendor_dd", placeholder: "—", value: obj.boughtFrom, options: vendorOptions })}
          </div>
        </div>

        <div class="hr"></div>

        <div style="font-weight:1000;">🧾 Rechnung / Belege</div>
        <div class="muted">PDF oder Bild möglich.</div>

        <div class="row" style="margin-top:10px;flex-wrap:wrap;">
          <input id="n_invoiceFile" type="file" accept="image/*,application/pdf" />
          <button class="btn primary" id="n_uploadInvoice">Rechnung hochladen</button>
        </div>

        <div style="margin-top:10px;">
          ${
            invoices.length
              ? invoices
                  .map(
                    (a) => `
                <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                  <div>
                    <div style="font-weight:900;">${esc(a.filename || a.id)}</div>
                    <div class="muted" style="word-break:break-all;">${esc(a.url)}</div>
                  </div>
                  <div class="row" style="gap:8px;">
                    <a class="btn info" href="${esc(a.url)}" target="_blank" rel="noreferrer">Öffnen</a>
                    <button class="btn danger" data-att="${esc(a.id)}">Entfernen</button>
                  </div>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted">Keine Belege.</div>`
          }
        </div>

        <div class="hr"></div>

        <div>
          <div class="label">Bemerkungen</div>
          <textarea id="n_notes">${esc(obj.notes)}</textarea>
        </div>
      </div>

      ${renderMasterDataCard({ includeNib: true, includeFeed: false })}
    `;

    wireMasterDataCard(view, { includeNib: true, includeFeed: false });

    setTimeout(() => {
      initDropdown("n_material_dd", (v) => {
        obj.material = v;
        renderList();
      });
      initDropdown("n_size_dd", (v) => {
        obj.size = v;
        renderList();
      });
      initDropdown("n_type_dd", (v) => {
        obj.type = v;
        renderList();
      });
      initDropdown("n_maker_dd", (v) => {
        obj.maker = v;
        renderList();
      });

      initDropdown("n_currency_dd", (v) => {
        obj.currency = v || "EUR";
      });
      initDropdown("n_vendor_dd", (v) => {
        obj.boughtFrom = v;
      });

      $("n_label").oninput = () => {
        obj.label = $("n_label").value;
        renderList();
      };
      $("n_price").oninput = () => {
        obj.price = numOrNull($("n_price").value);
      };
      $("n_boughtAt").onchange = () => {
        obj.boughtAt = fromInputDate($("n_boughtAt").value);
      };
      $("n_notes").oninput = () => {
        obj.notes = $("n_notes").value;
      };

      $("n_uploadInvoice").onclick = async () => {
        const f = $("n_invoiceFile").files?.[0];
        if (!f) return alert("Bitte Datei auswählen.");
        setStatus("Upload Rechnung…");
        const up = await apiUploadFile(f);
        const fid = await nextId("file");
        obj.attachments.push({
          id: fid,
          kind: "nib_invoice",
          url: up.url,
          pathname: up.pathname,
          filename: f.name,
          contentType: up.contentType,
          size: up.size,
          uploadedAt: new Date().toISOString(),
        });
        await saveVault();
        renderView();
      };

      view.querySelectorAll("button[data-att]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-att");
          obj.attachments = obj.attachments.filter((a) => a.id !== id);
          await saveVault();
          renderView();
        };
      });
    }, 0);

    return;
  }

  /* ================== FEEDS ================== */
  if (entity === "feeds") {
    obj.label = obj.label ?? "";
    obj.maker = obj.maker ?? "";
    obj.model = obj.model ?? "";
    obj.material = (obj.material ?? "").trim(); // NEW
    obj.price = obj.price ?? null;
    obj.currency = obj.currency ?? "EUR";
    obj.boughtAt = obj.boughtAt ?? null;
    obj.boughtFrom = obj.boughtFrom ?? "";
    obj.notes = obj.notes ?? "";
    obj.attachments = Array.isArray(obj.attachments) ? obj.attachments : [];

    const makerOptions = meta.master.feedMakers.slice().sort((a, b) => a.localeCompare(b)).map((x) => ({ value: x, label: x }));
    const materialOptions = meta.master.feedMaterials.slice().sort((a, b) => a.localeCompare(b)).map((x) => ({ value: x, label: x }));
    const invoices = obj.attachments.filter((a) => a.kind === "feed_invoice");

    view.innerHTML = `
      <div class="card">
        <div style="font-size:22px;font-weight:1000;">${esc(getDisplayName("feeds", obj))}</div>
        <div class="muted">${esc(obj.id)}</div>

        <div class="hr"></div>

        <div>
          <div class="label">Label (optional)</div>
          <input id="f_label" value="${esc(obj.label)}" placeholder="z.B. ebonite feed #6" />
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Hersteller</div>
            ${dropdownHtml({ id: "f_maker_dd", placeholder: "—", value: obj.maker, options: makerOptions })}
          </div>
          <div>
            <div class="label">Material</div>
            ${dropdownHtml({ id: "f_material_dd", placeholder: "—", value: obj.material, options: materialOptions, searchable: false })}
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Modell/Typ</div>
            <input id="f_model" value="${esc(obj.model)}" placeholder="z.B. #6 feed / Pilot feed / ebonite..." />
          </div>
          <div>
            <div class="label">Preis</div>
            <input id="f_price" inputmode="decimal" value="${esc(obj.price ?? "")}" />
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Währung</div>
            ${dropdownHtml({ id: "f_currency_dd", placeholder: "EUR", value: obj.currency, options: currencyOptions, searchable: false, clearable: false })}
          </div>
          <div>
            <div class="label">Gekauft am</div>
            <input id="f_boughtAt" type="date" value="${esc(toInputDate(obj.boughtAt))}" />
          </div>
        </div>

        <div class="grid2" style="margin-top:10px;">
          <div>
            <div class="label">Gekauft von</div>
            ${dropdownHtml({ id: "f_vendor_dd", placeholder: "—", value: obj.boughtFrom, options: vendorOptions })}
          </div>
          <div class="muted" style="display:flex;align-items:flex-end;">—</div>
        </div>

        <div class="hr"></div>

        <div style="font-weight:1000;">🧾 Rechnung / Belege</div>
        <div class="muted">PDF oder Bild möglich.</div>

        <div class="row" style="margin-top:10px;flex-wrap:wrap;">
          <input id="f_invoiceFile" type="file" accept="image/*,application/pdf" />
          <button class="btn primary" id="f_uploadInvoice">Rechnung hochladen</button>
        </div>

        <div style="margin-top:10px;">
          ${
            invoices.length
              ? invoices
                  .map(
                    (a) => `
                <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                  <div>
                    <div style="font-weight:900;">${esc(a.filename || a.id)}</div>
                    <div class="muted" style="word-break:break-all;">${esc(a.url)}</div>
                  </div>
                  <div class="row" style="gap:8px;">
                    <a class="btn info" href="${esc(a.url)}" target="_blank" rel="noreferrer">Öffnen</a>
                    <button class="btn danger" data-att="${esc(a.id)}">Entfernen</button>
                  </div>
                </div>
              `
                  )
                  .join("")
              : `<div class="muted">Keine Belege.</div>`
          }
        </div>

        <div class="hr"></div>

        <div>
          <div class="label">Bemerkungen</div>
          <textarea id="f_notes">${esc(obj.notes)}</textarea>
        </div>
      </div>

      ${renderMasterDataCard({ includeNib: false, includeFeed: true })}
    `;

    wireMasterDataCard(view, { includeNib: false, includeFeed: true });

    setTimeout(() => {
      initDropdown("f_maker_dd", (v) => {
        obj.maker = v;
        renderList();
      });
      initDropdown("f_material_dd", (v) => {
        obj.material = v;
        renderList();
      });
      initDropdown("f_currency_dd", (v) => {
        obj.currency = v || "EUR";
      });
      initDropdown("f_vendor_dd", (v) => {
        obj.boughtFrom = v;
      });

      $("f_label").oninput = () => {
        obj.label = $("f_label").value;
        renderList();
      };
      $("f_model").oninput = () => {
        obj.model = $("f_model").value;
        renderList();
      };
      $("f_price").oninput = () => {
        obj.price = numOrNull($("f_price").value);
      };
      $("f_boughtAt").onchange = () => {
        obj.boughtAt = fromInputDate($("f_boughtAt").value);
      };
      $("f_notes").oninput = () => {
        obj.notes = $("f_notes").value;
      };

      $("f_uploadInvoice").onclick = async () => {
        const f = $("f_invoiceFile").files?.[0];
        if (!f) return alert("Bitte Datei auswählen.");
        setStatus("Upload Rechnung…");
        const up = await apiUploadFile(f);
        const fid = await nextId("file");
        obj.attachments.push({
          id: fid,
          kind: "feed_invoice",
          url: up.url,
          pathname: up.pathname,
          filename: f.name,
          contentType: up.contentType,
          size: up.size,
          uploadedAt: new Date().toISOString(),
        });
        await saveVault();
        renderView();
      };

      view.querySelectorAll("button[data-att]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-att");
          obj.attachments = obj.attachments.filter((a) => a.id !== id);
          await saveVault();
          renderView();
        };
      });
    }, 0);

    return;
  }

  view.innerHTML = `<div class="card"><div class="muted">Unbekannter Tab.</div></div>`;
}

/* =========================================================
   CRUD
========================================================= */
async function createNew() {
  if (!connected || entity === "dashboard") return;

  if (entity === "pens") {
    const id = await nextId("pen");
    pens.push({
      id,
      brand: "",
      model: "",
      limitedEdition: false,
      leNumber: "",
      material: "",
      price: null,
      currency: "EUR",
      boughtAt: null,
      boughtFrom: "",
      attachments: [],
      notes: "",
      originalNibId: "",
      currentNibId: "",
      nibHistory: [],
      originalFeedId: "",
      currentFeedId: "",
      currentFeedMaterial: "", // NEW
      feedHistory: [],
      currentInkId: "",
      inkHistory: [],
    });
    selectedId = id;
  } else if (entity === "inks") {
    const id = await nextId("ink");
    inks.push({
      id,
      brand: "",
      name: "",
      color: "",
      colorHex: "#777777",
      sheen: false,
      shimmer: false,
      specialEdition: false,
      inStock: true,
      firstPurchasedAt: null,
      lastPurchasedAt: null,
      boughtFrom: "",
      amountMl: null,
      price: null,
      currency: "EUR",
      notes: "",
    });
    selectedId = id;
  } else if (entity === "nibs") {
    const id = await nextId("nib");
    nibs.push({
      id,
      label: "",
      material: "",
      size: "",
      type: "",
      maker: "",
      price: null,
      currency: "EUR",
      boughtAt: null,
      boughtFrom: "",
      notes: "",
      attachments: [],
    });
    selectedId = id;
  } else if (entity === "feeds") {
    const id = await nextId("feed");
    feeds.push({
      id,
      label: "",
      maker: "",
      material: "", // NEW
      model: "",
      price: null,
      currency: "EUR",
      boughtAt: null,
      boughtFrom: "",
      notes: "",
      attachments: [],
    });
    selectedId = id;
  }

  await saveVault();
  render();
}

async function deleteSelected() {
  if (!connected || entity === "dashboard" || !selectedId) return;
  if (!confirm(`Wirklich löschen: ${selectedId}?`)) return;

  const baseEntity = String(entity||"").endsWith("_table") ? String(entity).replace("_table","") : entity;
  const arr = getArrayForEntity(baseEntity);
  const idx = arr.findIndex((x) => x.id === selectedId);
  if (idx >= 0) arr.splice(idx, 1);

  selectedId = getArrayForEntity(entity)[0]?.id ?? null;
  await saveVault();
  render();
}

/* =========================================================
   Export / Import
========================================================= */
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function exportVault() {
  downloadJson("vault-export.json", { version: 1, exportedAt: new Date().toISOString(), pens, inks, nibs, feeds, events, meta });
}
async function importVaultFromFile(file) {
  const obj = JSON.parse(await file.text());
  for (const k of ["pens", "inks", "nibs", "feeds", "events"]) if (!Array.isArray(obj?.[k])) throw new Error("Bad import file");
  pens = obj.pens;
  inks = obj.inks;
  nibs = obj.nibs;
  feeds = obj.feeds;
  events = obj.events;
  meta = ensureMeta(obj.meta);

  // back-compat fill
  for (const p of pens) {
    if (p.currentFeedMaterial === undefined) p.currentFeedMaterial = "";
  }

  await saveVault();
  render();
}

/* =========================================================
   Wire UI
========================================================= */
document.querySelectorAll(".navItem").forEach((item) => {
  item.onclick = () => {
    closeAnyDropdown();
    entity = item.dataset.entity;

    // Finance keeps an internal section (A–E) in selectedId
    if (entity === "finance") {
      selectedId = selectedId || "A";
    } else {
      selectedId = (entity === "dashboard" || entity === "edc" || String(entity || "").endsWith("_table"))
        ? null
        : getArrayForEntity(entity)[0]?.id ?? null;
    }

    render();
  };
});

$("search")?.addEventListener("input", () => { renderList(); if (String(entity||"").endsWith("_table")) renderView(); });

$("btnConnect").onclick = () =>
  connect().catch((err) => {
    console.error(err);
    setStatus("Connect fehlgeschlagen");
    alert(String(err.message || err));
  });

$("btnNew").onclick = () => createNew().catch((e) => alert(e.message || e));
$("btnSave").onclick = () => saveVault().catch((e) => alert(e.message || e));
$("btnDelete").onclick = () => deleteSelected().catch((e) => alert(e.message || e));

$("btnExport").onclick = () => exportVault();
$("btnImport").onclick = () => $("fileImport").click();
$("fileImport").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await importVaultFromFile(file);
  } catch (err) {
    alert("Import fehlgeschlagen: " + (err.message || err));
  }
  e.target.value = "";
});

// restore cached pass
$("vaultPass").value = localStorage.getItem("fpvault_pass_cached") || "";
meta = ensureMeta(meta);
setEnabled(false);
setStatus("Nicht verbunden");
render();


// ---- Window bindings for dashboard module ----
try {
  window.render = render;
  window.getDisplayName = getDisplayName;
  window.inkLabel = inkLabel;
  window.nibLabel = nibLabel;
  window.isPenEboniteFeed = isPenEboniteFeed;
  window.globalRecentActivity = globalRecentActivity;
  window.monthsBetween = monthsBetween;
} catch(_) {}

// ---- Window bindings for additional modules (EDC, etc.) ----
try {
  window.fpvNavigate = function fpvNavigate(ent, sel) {
    closeAnyDropdown();
    entity = ent;
    if (ent === "finance") {
      selectedId = sel || selectedId || "A";
    } else if (ent === "edc" || ent === "dashboard" || String(ent || "").endsWith("_table")) {
      selectedId = sel || null;
    } else {
      selectedId = sel || getArrayForEntity(ent)[0]?.id || null;
    }
    render();
  };

  // expose save/id helpers for modules (EDC writes events)
  window.fpvSaveVault = saveVault;
  window.fpvNextId = nextId;
} catch(_) {}

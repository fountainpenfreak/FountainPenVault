// public/ui-finance.js
// Finance UI module for FountainPenVault
// Depends on globals from main.js: pens, inks, nibs, feeds, esc, render (optional)

(function () {
  function safeText(s) {
    return esc(s ?? "");
  }

  function num(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(",", ".");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function yearFromDate(d) {
    if (!d) return null;
    const m = String(d).match(/(\d{4})/);
    return m ? m[1] : null;
  }

  function toEUR(amount, currency, usdEur) {
    const a = num(amount);
    if (!Number.isFinite(a)) return NaN;
    const cur = String(currency || "EUR").trim().toUpperCase();
    if (cur === "EUR") return a;
    if (cur === "USD") return a * usdEur;
    return NaN;
  }

  function fmtEUR(x) {
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  function fmtNum(x, digits = 2) {
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function sum(arr) {
    return arr.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
  }

  function groupYear(items) {
    const map = new Map();
    items.forEach((it) => {
      const y = it.year;
      if (!y) return;
      if (!map.has(y)) map.set(y, { pens: 0, inks: 0, acc: 0, total: 0 });
      const row = map.get(y);
      if (it.kind === "pens") row.pens += it.eur;
      if (it.kind === "inks") row.inks += it.eur;
      if (it.kind === "acc") row.acc += it.eur;
      row.total += it.eur;
    });
    const years = Array.from(map.keys()).sort((a, b) => String(b).localeCompare(String(a)));
    return { map, years };
  }

  function topBy(arr, keyFn, dir = "desc") {
    const filtered = arr.filter((x) => Number.isFinite(keyFn(x)));
    if (!filtered.length) return null;
    filtered.sort((a, b) => (keyFn(a) - keyFn(b)) * (dir === "asc" ? 1 : -1));
    return filtered[0] || null;
  }

  function brandCounts(items) {
    const m = new Map();
    (items || []).forEach((x) => {
      const b = String(x?.brand || "").trim() || "—";
      m.set(b, (m.get(b) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  function getUsdEur() {
    try {
      const raw = localStorage.getItem("fpv_usd_eur");
      const v = num(raw);
      if (Number.isFinite(v) && v > 0) return v;
    } catch (_) {}
    return 0.92;
  }

  function setUsdEur(v) {
    try {
      localStorage.setItem("fpv_usd_eur", String(v));
    } catch (_) {}
  }

  window.FinanceUI = {
    renderFinanceView: function renderFinanceView({ viewEl }) {
      const usdEur = getUsdEur();

      const penItems = (pens || [])
        .map((p) => ({
          kind: "pens",
          year: yearFromDate(p.boughtAt),
          eur: toEUR(p.price, p.currency, usdEur),
          label: `${p.brand || ""} ${p.model || ""}`.trim() || p.id,
        }))
        .filter((x) => Number.isFinite(x.eur));

      const inkItems = (inks || [])
        .map((i) => ({
          kind: "inks",
          year: yearFromDate(i.lastPurchasedAt),
          eur: toEUR(i.price, i.currency, usdEur),
          label: `${i.brand || ""} ${i.name || ""}`.trim() || i.id,
          raw: i,
        }))
        .filter((x) => Number.isFinite(x.eur));

      // Accessories: only those with a price (per requirement)
      const accItems = []
        .concat((nibs || []).map((n) => ({ ...n, __accKind: "nib" })), (feeds || []).map((f) => ({ ...f, __accKind: "feed" })))
        .map((a) => ({
          kind: "acc",
          year: yearFromDate(a.boughtAt),
          eur: toEUR(a.price, a.currency, usdEur),
          label: `${a.__accKind === "nib" ? "✒️" : "🧩"} ${a.brand || a.maker || ""} ${a.model || a.label || ""}`.trim() || a.id,
        }))
        .filter((x) => Number.isFinite(x.eur));

      const allItems = penItems.concat(inkItems, accItems);
      const { map, years } = groupYear(allItems);

      const pensTotal = sum(penItems.map((x) => x.eur));
      const inksTotal = sum(inkItems.map((x) => x.eur));
      const accTotal = sum(accItems.map((x) => x.eur));
      const grandTotal = pensTotal + inksTotal + accTotal;

      // B) averages + extremes
      const avgPen = penItems.length ? pensTotal / penItems.length : NaN;
      const avgInkPurchase = inkItems.length ? inksTotal / inkItems.length : NaN;
      const maxPen = topBy(penItems, (x) => x.eur, "desc");
      const minPen = topBy(penItems, (x) => x.eur, "asc");

      // C) counts per year (based on dates, regardless of price)
      function countByYear(kind) {
        const m = new Map();
        const add = (y) => {
          if (!y) return;
          m.set(y, (m.get(y) || 0) + 1);
        };
        if (kind === "pens") (pens || []).forEach((p) => add(yearFromDate(p.boughtAt)));
        if (kind === "inks") (inks || []).forEach((i) => add(yearFromDate(i.lastPurchasedAt)));
        if (kind === "acc") [].concat(nibs || [], feeds || []).forEach((a) => add(yearFromDate(a.boughtAt)));
        const ys = Array.from(m.keys()).sort((a, b) => String(b).localeCompare(String(a)));
        return { m, ys };
      }
      const cPens = countByYear("pens");
      const cInks = countByYear("inks");
      const cAcc = countByYear("acc");

      // D) ink analysis (last purchase)
      const inkWithPerMl = (inks || [])
        .map((i) => {
          const priceEur = toEUR(i.price, i.currency, usdEur);
          const ml = num(i.amountMl);
          const per = Number.isFinite(priceEur) && Number.isFinite(ml) && ml > 0 ? priceEur / ml : NaN;
          return { i, per, priceEur, ml };
        })
        .filter((x) => Number.isFinite(x.per));

      const avgPerMl = inkWithPerMl.length ? sum(inkWithPerMl.map((x) => x.per)) / inkWithPerMl.length : NaN;
      const weightedPerMl = (() => {
        const totalPrice = sum(inkWithPerMl.map((x) => x.priceEur));
        const totalMl = sum(inkWithPerMl.map((x) => x.ml));
        return totalMl > 0 ? totalPrice / totalMl : NaN;
      })();

      const maxPerMlInk = inkWithPerMl.slice().sort((a, b) => b.per - a.per)[0] || null;
      const minPerMlInk = inkWithPerMl.slice().sort((a, b) => a.per - b.per)[0] || null;

      const totalMlInStock = (() => {
        const hasInStock = (inks || []).some((i) => typeof i.inStock === "boolean");
        const list = hasInStock ? (inks || []).filter((i) => i.inStock) : (inks || []);
        return sum(list.map((i) => num(i.amountMl)).filter((x) => Number.isFinite(x) && x > 0));
      })();

      const sheenCount = (inks || []).filter((i) => i?.sheen).length;
      const shimmerCount = (inks || []).filter((i) => i?.shimmer).length;
      const bothCount = (inks || []).filter((i) => i?.sheen && i?.shimmer).length;

      // E) pen stats
      const leCount = (pens || []).filter((p) => !!p.limitedEdition).length;
      const penCount = (pens || []).length;
      const lePct = penCount ? (leCount / penCount) * 100 : NaN;
      const brandTop = brandCounts(pens || []);

      const avgAgeYears = (() => {
        const now = new Date();
        const ages = (pens || [])
          .map((p) => {
            const d = p.boughtAt ? new Date(p.boughtAt) : null;
            if (!d || isNaN(d.getTime())) return NaN;
            return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
          })
          .filter((x) => Number.isFinite(x) && x >= 0);
        return ages.length ? sum(ages) / ages.length : NaN;
      })();

      viewEl.innerHTML = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;">
            <div>
              <div style="font-size:22px;font-weight:1000;">🧮 Finanzen</div>
              <div class="muted">Ausgaben & Statistiken (Tinten basierend auf <b>letztem Einkauf</b>).</div>
            </div>
            <div class="pill">${fmtEUR(grandTotal)}</div>
          </div>

          <div class="hr"></div>

          <div class="grid2">
            <div class="card" style="margin:0;">
              <div style="font-weight:1000;">💱 USD → EUR</div>
              <div class="muted">Für Umrechnung (USD-Preise werden damit in EUR gerechnet).</div>
              <div style="margin-top:10px;display:flex;gap:10px;align-items:center;">
                <div class="muted">1 USD =</div>
                <input id="fx_usd_eur" inputmode="decimal" value="${safeText(String(usdEur))}" style="max-width:120px;" />
                <div class="muted">EUR</div>
              </div>
            </div>
            <div class="card" style="margin:0;">
              <div style="font-weight:1000;">🖊️ Gesamtwert Füller (EUR)</div>
              <div class="muted">EUR + umgerechnete USD (nur Füller mit Preis).</div>
              <div style="font-size:28px;font-weight:1000;margin-top:8px;">${fmtEUR(pensTotal)}</div>
              <div class="muted">Ø Füllerpreis: <b>${fmtEUR(avgPen)}</b></div>
            </div>
          </div>

          <div class="hr"></div>

          <div style="font-weight:1000;">A) Gesamtinvestition</div>
          <div class="tableWrap" style="margin-top:8px;">
            <table class="fpvTable">
              <thead>
                <tr>
                  <th>Kategorie</th>
                  <th style="text-align:right;">Summe (EUR)</th>
                  <th style="text-align:right;">Anzahl (mit Preis)</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Füller</td><td style="text-align:right;">${fmtEUR(pensTotal)}</td><td style="text-align:right;">${penItems.length}</td></tr>
                <tr><td>Tinten (letzter Kauf)</td><td style="text-align:right;">${fmtEUR(inksTotal)}</td><td style="text-align:right;">${inkItems.length}</td></tr>
                <tr><td>Zubehör (Feeds + Federn)</td><td style="text-align:right;">${fmtEUR(accTotal)}</td><td style="text-align:right;">${accItems.length}</td></tr>
                <tr><td><b>Gesamt</b></td><td style="text-align:right;"><b>${fmtEUR(grandTotal)}</b></td><td style="text-align:right;"><b>${penItems.length + inkItems.length + accItems.length}</b></td></tr>
              </tbody>
            </table>
          </div>

          <div class="hr"></div>

          <div style="font-weight:1000;">Ausgaben pro Jahr (nach Einkaufsdatum)</div>
          <div class="muted">Zubehör berücksichtigt nur Einträge mit Preis. Tinten zählen nach <b>lastPurchasedAt</b>.</div>

          <div class="tableWrap" style="margin-top:8px;">
            <table class="fpvTable">
              <thead>
                <tr>
                  <th>Jahr</th>
                  <th style="text-align:right;">Füller</th>
                  <th style="text-align:right;">Tinten</th>
                  <th style="text-align:right;">Zubehör</th>
                  <th style="text-align:right;">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                ${
                  years.length
                    ? years
                        .map((y) => {
                          const r = map.get(y);
                          return `
                            <tr>
                              <td>${safeText(y)}</td>
                              <td style="text-align:right;">${fmtEUR(r.pens)}</td>
                              <td style="text-align:right;">${fmtEUR(r.inks)}</td>
                              <td style="text-align:right;">${fmtEUR(r.acc)}</td>
                              <td style="text-align:right;"><b>${fmtEUR(r.total)}</b></td>
                            </tr>
                          `;
                        })
                        .join("")
                    : `<tr><td colspan="5" class="muted">Noch keine auswertbaren Preise/Datumsangaben vorhanden.</td></tr>`
                }
              </tbody>
            </table>
          </div>

          <div class="hr"></div>

          <div class="grid2">
            <div class="card" style="margin:0;">
              <div style="font-weight:1000;">B) Extremwerte</div>
              <div class="muted">Nur Einträge mit Preis.</div>
              <div style="margin-top:10px;">
                <div>Teuerster Füller: <b>${maxPen ? safeText(maxPen.label) : "—"}</b> <span class="muted">${maxPen ? "• " + fmtEUR(maxPen.eur) : ""}</span></div>
                <div>Günstigster Füller: <b>${minPen ? safeText(minPen.label) : "—"}</b> <span class="muted">${minPen ? "• " + fmtEUR(minPen.eur) : ""}</span></div>
                <div class="hr"></div>
                <div>Teuerste Tinte/ml: <b>${maxPerMlInk ? safeText((maxPerMlInk.i.brand || "") + " — " + (maxPerMlInk.i.name || "")) : "—"}</b>
                  <span class="muted">${maxPerMlInk ? "• " + fmtNum(maxPerMlInk.per, 3) + " EUR/ml" : ""}</span>
                </div>
                <div>Günstigste Tinte/ml: <b>${minPerMlInk ? safeText((minPerMlInk.i.brand || "") + " — " + (minPerMlInk.i.name || "")) : "—"}</b>
                  <span class="muted">${minPerMlInk ? "• " + fmtNum(minPerMlInk.per, 3) + " EUR/ml" : ""}</span>
                </div>
                <div style="margin-top:8px;">Ø Tintenkauf (letzter): <b>${fmtEUR(avgInkPurchase)}</b></div>
              </div>
            </div>

            <div class="card" style="margin:0;">
              <div style="font-weight:1000;">C) Kaufverhalten</div>
              <div class="muted">Anzahl (nach Datum): Füller=boughtAt, Tinten=lastPurchasedAt, Zubehör=boughtAt.</div>
              <div class="tableWrap" style="margin-top:8px;max-height:220px;">
                <table class="fpvTable">
                  <thead>
                    <tr><th>Jahr</th><th style="text-align:right;">Füller</th><th style="text-align:right;">Tinten</th><th style="text-align:right;">Zubehör</th></tr>
                  </thead>
                  <tbody>
                    ${
                      Array.from(new Set([].concat(cPens.ys, cInks.ys, cAcc.ys)))
                        .sort((a, b) => String(b).localeCompare(String(a)))
                        .map((y) => `
                          <tr>
                            <td>${safeText(y)}</td>
                            <td style="text-align:right;">${cPens.m.get(y) || 0}</td>
                            <td style="text-align:right;">${cInks.m.get(y) || 0}</td>
                            <td style="text-align:right;">${cAcc.m.get(y) || 0}</td>
                          </tr>
                        `)
                        .join("") || `<tr><td colspan="4" class="muted">Keine Datumsangaben vorhanden.</td></tr>`
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="hr"></div>

          <div class="grid2">
            <div class="card" style="margin:0;">
              <div style="font-weight:1000;">D) Tintenanalyse (letzter Einkauf)</div>
              <div class="muted">Nur Tinten mit Preis & Menge (ml) werden für €/ml ausgewertet.</div>

              <div style="margin-top:10px;">
                <div>Ø Preis/ml (einfach): <b>${fmtNum(avgPerMl, 3)}</b> <span class="muted">EUR/ml</span></div>
                <div>Ø Preis/ml (gewichtet): <b>${fmtNum(weightedPerMl, 3)}</b> <span class="muted">EUR/ml</span></div>
                <div style="margin-top:8px;">Gesamt ml im Bestand: <b>${fmtNum(totalMlInStock, 0)}</b> <span class="muted">ml</span></div>
                <div class="muted" style="margin-top:8px;">Sheen: ${sheenCount} • Shimmer: ${shimmerCount} • Beides: ${bothCount}</div>
              </div>
            </div>

            <div class="card" style="margin:0;">
              <div style="font-weight:1000;">E) Füller-Statistik</div>
              <div class="muted">Basierend auf bestehenden Feldern.</div>

              <div style="margin-top:10px;">
                <div>Limited Editions: <b>${leCount}</b> / ${penCount} <span class="muted">(${Number.isFinite(lePct) ? fmtNum(lePct, 1) + "%" : "—"})</span></div>
                <div>Ø Alter: <b>${Number.isFinite(avgAgeYears) ? fmtNum(avgAgeYears, 1) : "—"}</b> <span class="muted">Jahre</span></div>
              </div>

              <div class="hr"></div>
              <div style="font-weight:900;">Top Marken</div>
              <div style="margin-top:8px;">
                ${
                  brandTop.length
                    ? brandTop
                        .map(
                          (r) => `
                          <div style="display:flex;justify-content:space-between;gap:10px;">
                            <div>${safeText(r.brand)}</div>
                            <div class="muted">${r.count}</div>
                          </div>
                        `
                        )
                        .join("")
                    : `<div class="muted">Keine Marken erfasst.</div>`
                }
              </div>
            </div>
          </div>
        </div>
      `;

      const fx = viewEl.querySelector("#fx_usd_eur");
      if (fx) {
        fx.addEventListener("input", () => {
          const v = num(fx.value);
          if (Number.isFinite(v) && v > 0) setUsdEur(v);
        });
        fx.addEventListener("change", () => {
          const v = num(fx.value);
          if (Number.isFinite(v) && v > 0) setUsdEur(v);
          if (typeof window.render === "function") window.render();
        });
      }
    },
  };
})();

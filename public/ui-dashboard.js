// public/ui-dashboard.js
// Dashboard UI module for FountainPenVault
// Depends on globals from main.js: pens, inks, nibs, feeds, entity, selectedId, render, esc, getDisplayName, inkLabel, nibLabel, isPenEboniteFeed, globalRecentActivity, monthsBetween

(function () {
  function safeText(s) {
    return esc(s ?? "");
  }

  function navigateEntity(ent) {
    // Prefer app navigation helper if present
    if (typeof window.fpvNavigate === "function") {
      window.fpvNavigate(ent);
      return;
    }
    window.entity = ent;
    window.selectedId = null;
    window.render?.();
  }

  function openPen(pid) {
    window.entity = "pens";
    window.selectedId = pid;
    window.render?.();
  }

  function penLine(p) {
    const penName = getDisplayName("pens", p);
    const nib = p.currentNibId ? nibLabel(p.currentNibId) : "—";
    const ink = p.currentInkId ? inkLabel(p.currentInkId) : "—";
    const ebo = isPenEboniteFeed(p) ? ` <span class="pill">🪵 Ebonit-Feed</span>` : "";
    return `
      <div class="list-item" data-open-pen="${safeText(p.id)}" style="cursor:pointer;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div style="font-weight:1000;">🖊️ ${safeText(penName)}${ebo}</div>
          <div class="muted">${safeText(p.id)}</div>
        </div>
        <div class="muted">✒️ ${safeText(nib)} &nbsp; • &nbsp; 💧 ${safeText(ink)}</div>
      </div>
    `;
  }

  function renderFilledPensList() {
    const filledPens = (pens || [])
      .filter((p) => !!p.currentInkId)
      .slice()
      .sort((a, b) => getDisplayName("pens", a).localeCompare(getDisplayName("pens", b)));

    if (!filledPens.length) {
      return `<div class="muted">Aktuell ist kein Füller als „befüllt“ markiert.</div>`;
    }
    return filledPens.map(penLine).join("");
  }

  window.DashboardUI = {
    renderDashboardView: function renderDashboardView({ viewEl, stats }) {
      const { penCount, filledCount, inkCount, nibCount, feedCount } = stats;

      const inksOld = (inks || [])
        .map((i) => ({ ink: i, age: monthsBetween(i.lastPurchasedAt) }))
        .filter((x) => x.age !== "" && Number(x.age) >= 24)
        .sort((a, b) => b.age - a.age)
        .slice(0, 8);

      const recent = globalRecentActivity(12);

      viewEl.innerHTML = `
        <div class="card">
          <div style="font-size:22px;font-weight:1000;">Dashboard 📱</div>
          <div class="muted">Überblick & letzte Aktivitäten</div>

          <div class="hr"></div>

          <div class="card" style="margin:0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;">
              <div>
                <div style="font-weight:1000;">✍🏻 Aktuell befüllte Füller</div>
                <div class="muted">Nur die, die gerade mit Tinte befüllt sind — inkl. Feder & Tinte.</div>
              </div>
              <div class="pill">${filledCount} befüllt</div>
            </div>

            <div style="margin-top:10px;">
              ${renderFilledPensList()}
            </div>
          </div>

          <div class="hr"></div>

          <div class="grid2">
            <div class="card" style="margin:0;cursor:pointer;" data-open-entity="pens">
              <div style="font-weight:900;">🖊️ Füller</div>
              <div style="font-size:34px;font-weight:1000;margin-top:6px;">${penCount}</div>
              <div class="muted">davon befüllt: <b>${filledCount}</b></div>
            </div>
            <div class="card" style="margin:0;cursor:pointer;" data-open-entity="inks">
              <div style="font-weight:900;">💧 Tinten</div>
              <div style="font-size:34px;font-weight:1000;margin-top:6px;">${inkCount}</div>
              <div class="muted">alte Vorräte (≥24M): <b>${inksOld.length}</b></div>
            </div>
          </div>

          <div class="grid2" style="margin-top:12px;">
            <div class="card" style="margin:0;cursor:pointer;" data-open-entity="nibs">
              <div style="font-weight:900;">✒️ Federn</div>
              <div style="font-size:34px;font-weight:1000;margin-top:6px;">${nibCount}</div>
              <div class="muted">DB für Wechsel</div>
            </div>
            <div class="card" style="margin:0;cursor:pointer;" data-open-entity="feeds">
              <div style="font-weight:900;">🧩 Feeds</div>
              <div style="font-size:34px;font-weight:1000;margin-top:6px;">${feedCount}</div>
              <div class="muted">DB für Wechsel</div>
            </div>
          </div>

          <div class="hr"></div>

          <div style="font-weight:1000;">⏱️ Letzte Aktivitäten</div>
          <div class="muted">Einträge mit Füller-ID sind anklickbar und öffnen den zugehörigen Füller.</div>

          <div style="margin-top:8px;">
            ${
              recent.length
                ? recent
                    .map(
                      (r) => `
                        <div class="list-item" ${r.penId ? `data-open-pen="${safeText(r.penId)}" style="cursor:pointer;"` : ""}>
                          <div style="display:flex;justify-content:space-between;gap:10px;">
                            <div style="font-weight:900;">${safeText(r.date || "—")} — ${safeText(r.icon)} ${safeText(r.label)}</div>
                            <div class="muted">${safeText(r.penId)}</div>
                          </div>
                          <div class="muted">${safeText(r.penName)}${r.notes ? " — " + safeText(r.notes) : ""}</div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="muted">Noch keine Historie vorhanden.</div>`
            }
          </div>

          <div class="hr"></div>

          <div style="font-weight:1000;">🧪 Alte Tinten (≥24 Monate)</div>
          <div class="muted">Basierend auf “Zuletzt gekauft am”.</div>
          <div style="margin-top:8px;">
            ${
              inksOld.length
                ? inksOld
                    .map(
                      (x) => `
                        <div class="list-item">
                          <div style="font-weight:900;">${safeText(getDisplayName("inks", x.ink))}</div>
                          <div class="muted">Alter: <b>${safeText(String(x.age))}</b> Monate • Zuletzt: ${safeText(
                            x.ink.lastPurchasedAt || "—"
                          )}</div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="muted">Keine Tinte ist aktuell ≥24 Monate alt.</div>`
            }
          </div>
        </div>
      `;

      // Wire entity cards (AFTER innerHTML)
      viewEl.querySelectorAll("[data-open-entity]").forEach((el) => {
        el.addEventListener("click", () => {
          const ent = el.getAttribute("data-open-entity");
          navigateEntity(ent);
        });
      });

      // Wire pen links
      viewEl.querySelectorAll("[data-open-pen]").forEach((el) => {
        el.addEventListener("click", () => {
          const pid = el.getAttribute("data-open-pen");
          openPen(pid);
        });
      });
    },
  };
})();

// public/ui-edc.js
// EDC / Füllertagebuch module for FountainPenVault
// Stores day-entries in `events` (from main.js) as: { id, type:"edc_day", date:"YYYY-MM-DD", penIds:[...], notes:"", createdAt, updatedAt }
// Depends on globals from main.js: pens, inks, events, esc, getDisplayName, inkLabel, render, fpvNextId, fpvSaveVault, fpvNavigate

(function () {
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Draft state (unsaved) so toggles work without having to press "Speichern".
  // Keeps selection while user clicks quick picks / list checkboxes.
  const _draft = { date: null, penIds: [], notes: "" };

  // Recent entries paging (progressive "Weitere laden")
  const _recent = { limit: 20 };

  // UI state (persist across re-renders)
  const _uiState = { allPensOpen: false };

  // Inject module-scoped styling once
  (function ensureEdcStyle() {
    if (document.getElementById("fpv-edc-style")) return;
    const style = document.createElement("style");
    style.id = "fpv-edc-style";
    style.textContent = `
      /* EDC module extras (theme-aligned) */
      .edc-load-more.navItem{ text-align:center; margin-top:14px; }
      .edc-load-more.navItem span{ display:inline-block; opacity:.9; }
    `;
    document.head.appendChild(style);
  })();


  function loadDraftForDate(date) {
    if (_draft.date === date) return;
    const e = entryByDate(date);
    _draft.date = date;
    _draft.penIds = uniq((e && e.penIds) ? e.penIds : []);
    _draft.notes = (e && e.notes) ? String(e.notes) : "";
  }

  function setDraftPens(penIds) {
    _draft.penIds = uniq(penIds || []);
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }

  function byId(arr, id) {
    return (arr || []).find((x) => x && x.id === id) || null;
  }

  function uniq(arr) {
    const out = [];
    const s = new Set();
    for (const x of arr || []) {
      const k = String(x || "");
      if (!k) continue;
      if (s.has(k)) continue;
      s.add(k);
      out.push(k);
    }
    return out;
  }

  function sortByNamePen(a, b) {
    return getDisplayName("pens", a).localeCompare(getDisplayName("pens", b));
  }

  function edcEntries() {
    return (events || [])
      .filter((e) => e && e.type === "edc_day" && e.date)
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function entryByDate(date) {
    return (events || []).find((e) => e && e.type === "edc_day" && e.date === date) || null;
  }

  // Determine the ink that was in a pen on a given date.
  // Logic: replay inkHistory <= date; ink_cleaned clears; ink_filled sets.
  // If no history: for dates >= today, fall back to currentInkId.
  function inkAtDate(pen, date) {
    if (!pen) return "";
    const hist = Array.isArray(pen.inkHistory) ? pen.inkHistory : [];
    const sorted = hist
      .filter((h) => h && h.date)
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let current = "";
    for (const h of sorted) {
      if (String(h.date) > String(date)) break;
      if (h.type === "ink_cleaned") {
        current = "";
      } else if (h.type === "ink_filled") {
        current = h.inkId || "";
      }
    }

    if (!current) {
      // heuristic for "today" or future
      if (String(date) >= todayISO()) {
        current = pen.currentInkId || "";
      }
    }

    return current;
  }

  function dayDerivedInkIds(date, penIds) {
    const ids = [];
    for (const pid of penIds || []) {
      const p = byId(pens, pid);
      const iid = inkAtDate(p, date);
      if (iid) ids.push(iid);
    }
    return uniq(ids);
  }

  function pill(text) {
    return `<span class="pill">${esc(text)}</span>`;
  }

  function penPill(pid) {
    const p = byId(pens, pid);
    const label = p ? getDisplayName("pens", p) : pid;
    return `<span class="pill" data-open-pen="${esc(pid)}" style="cursor:pointer;">🖊️ ${esc(label)}</span>`;
  }

  function inkPill(iid) {
    const i = byId(inks, iid);
    const label = i ? inkLabel(iid) : iid;
    return `<span class="pill" data-open-ink="${esc(iid)}" style="cursor:pointer;">💧 ${esc(label)}</span>`;
  }

  function stats() {
    const es = edcEntries();
    const dayCount = es.length;

    const penUse = new Map();
    const inkUse = new Map();
    let totalMarks = 0;

    for (const e of es) {
      const pids = uniq(e.penIds || []);
      totalMarks += pids.length;
      for (const pid of pids) penUse.set(pid, (penUse.get(pid) || 0) + 1);

      const inkIds = dayDerivedInkIds(e.date, pids);
      for (const iid of inkIds) inkUse.set(iid, (inkUse.get(iid) || 0) + 1);
    }

    const topPens = Array.from(penUse.entries())
      .map(([pid, n]) => ({ pid, n, last: es.find((x) => (x.penIds || []).includes(pid))?.date || "" }))
      .sort((a, b) => (b.n - a.n) || String(b.last).localeCompare(String(a.last)));

    const topInks = Array.from(inkUse.entries())
      .map(([iid, n]) => ({ iid, n, last: es.find((x) => dayDerivedInkIds(x.date, x.penIds || []).includes(iid))?.date || "" }))
      .sort((a, b) => (b.n - a.n) || String(b.last).localeCompare(String(a.last)));

    // weekday distribution (Mon..Sun)
    const wd = [0, 0, 0, 0, 0, 0, 0];
    for (const e of es) {
      const d = new Date(e.date + "T00:00:00");
      const js = d.getDay(); // 0 Sun .. 6 Sat
      const idx = (js + 6) % 7; // 0 Mon .. 6 Sun
      wd[idx] += 1;
    }

    // Longest since used (Pens)
    const today = todayISO();
    const lastUseByPen = new Map(); // pid -> lastDate (YYYY-MM-DD)
    const useByWeekdayPen = Array.from({ length: 7 }, () => new Map()); // weekdayIdx -> (pid -> count)

    for (const e of es) {
      const date = e.date;
      const pids = uniq(e.penIds || []);
      // last used
      for (const pid of pids) {
        const prev = lastUseByPen.get(pid);
        if (!prev || date > prev) lastUseByPen.set(pid, date);
      }
      // per weekday top pen
      const d = new Date(date + "T00:00:00");
      const js = d.getDay(); // 0 Sun .. 6 Sat
      const wdi = (js + 6) % 7; // 0 Mon .. 6 Sun
      const map = useByWeekdayPen[wdi];
      for (const pid of pids) {
        map.set(pid, (map.get(pid) || 0) + 1);
      }
    }

    // Never used pens (exist in vault but never in EDC log)
    const usedPenIds = new Set(Array.from(lastUseByPen.keys()));
    const neverUsedPens = (pens || [])
      .filter(p => p && p.id)
      .map(p => p.id)
      .filter(pid => !usedPenIds.has(pid));


    function daysBetween(aISO, bISO) {
      // days from aISO to bISO (bISO >= aISO), integer
      const a = new Date(aISO + "T00:00:00").getTime();
      const b = new Date(bISO + "T00:00:00").getTime();
      return Math.max(0, Math.floor((b - a) / 86400000));
    }

    const longestPens = Array.from(lastUseByPen.entries()).map(([pid, last]) => ({
      pid,
      last,
      days: daysBetween(last, today),
    })).sort((a, b) => (b.days - a.days) || a.pid.localeCompare(b.pid));

    const topPenByWeekday = useByWeekdayPen.map((map, idx) => {
      let bestPid = null, bestN = 0;
      for (const [pid, n] of map.entries()) {
        if (n > bestN) { bestN = n; bestPid = pid; }
      }
      return { weekday: idx, pid: bestPid, n: bestN };
    });


    return { dayCount, totalMarks, penUse, inkUse, topPens, topInks, weekday: wd, longestPens, topPenByWeekday, neverUsedPens };
  }

  function render(viewEl) {
    // one-time init per mount
    if (!viewEl.hasAttribute("data-edc-inited")) {
      viewEl.setAttribute("data-edc-inited", "1");
      _recent.limit = 20;
    }

    const es = edcEntries();
    const s = stats();
    const penOptions = (pens || []).slice().sort(sortByNamePen);
    const filled = penOptions.filter((p) => !!p.currentInkId);

    const defaultDate = todayISO();
    const activeDate = viewEl.getAttribute("data-edc-date") || defaultDate;
    const existing = entryByDate(activeDate);
    loadDraftForDate(activeDate);
    const selected = new Set(uniq(_draft.penIds || []));

    const derivedInkIds = dayDerivedInkIds(activeDate, Array.from(selected));

    viewEl.innerHTML = `
      <div class="card">
        <div style="font-size:22px;font-weight:1000;">Füllertagebuch ✒️📅</div>
        <div class="muted">Schnell erfassen, welche Füller an einem Tag verwendet wurden - inkl. abgeleiteter Tinten.</div>

        <div class="hr"></div>

        <div class="card" style="margin:0;">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:space-between;">
            <div>
              <div style="font-weight:1000;">Eintrag</div>
              <div class="muted">Datum wählen, Füller anklicken, speichern.</div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
              <button class="btn" id="edcToday">Heute</button>
              <button class="btn success" id="edcSave">Speichern</button>
              <button class="btn danger" id="edcDelete" ${existing ? "" : "disabled"}>Löschen</button>
            </div>
          </div>

          <div class="hr"></div>

          <div class="grid2">
            <div>
              <div class="label">Datum</div>
              <input id="edcDate" type="date" value="${esc(activeDate)}" />
            </div>
            <div>
              <div class="label">Notiz (optional)</div>
              <input id="edcNotes" placeholder="z.B. Meeting, Reise, Tests…" value="${esc(_draft.notes || "")}" />
            </div>
          </div>

          <div style="margin-top:12px;">
            <div style="font-weight:900;">Quick Picks (aktuell befüllt)</div>
            <div class="muted">Tippe zum An-/Abwählen.</div>
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">
              ${filled.length ? filled.map((p) => {
                const on = selected.has(p.id);
                return `<span class="pill" data-toggle-pen="${esc(p.id)}" style="cursor:pointer;${on ? "border-color: rgba(159,103,255,.55); background: rgba(159,103,255,.14);" : ""}">🖊️ ${esc(getDisplayName("pens", p))}</span>`;
              }).join("") : `<div class="muted">Keine befüllten Füller markiert.</div>`}
            </div>
          </div>

          <div class="hr"></div>

          <details id="edcAll" ${_uiState.allPensOpen ? "open" : ""}>
            <summary style="cursor:pointer;font-weight:900;">Alle Füller anzeigen (${penOptions.length})</summary>
            <div style="margin-top:10px;">
              <input id="edcPenSearch" placeholder="Füller suchen…" />
              <div style="margin-top:10px;max-height:320px;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:10px;">
                ${penOptions.map((p) => {
                  const on = selected.has(p.id);
                  return `
                    <label style="display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;cursor:pointer;" class="edcRow" data-name="${esc(getDisplayName("pens", p).toLowerCase())}">
                      <input type="checkbox" data-check-pen="${esc(p.id)}" ${on ? "checked" : ""} />
                      <div style="display:flex;flex-direction:column;">
                        <div style="font-weight:900;">${esc(getDisplayName("pens", p))}</div>
                        <div class="muted">${esc(p.id)}${p.currentInkId ? " • 💧 " + esc(inkLabel(p.currentInkId)) : ""}</div>
                      </div>
                    </label>
                  `;
                }).join("")}
              </div>
            </div>
          </details>

          <div class="hr"></div>

          <div>
            <div style="font-weight:900;">Auswahl (${selected.size})</div>
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">
              ${selected.size ? Array.from(selected).map(penPill).join("") : `<div class="muted">Noch keine Füller ausgewählt.</div>`}
            </div>
          </div>

          <div style="margin-top:12px;">
            <div style="font-weight:900;">Abgeleitete Tinten (${derivedInkIds.length})</div>
            <div class="muted">Basierend auf der Ink-Historie je Füller</div>
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">
              ${derivedInkIds.length ? derivedInkIds.map(inkPill).join("") : `<div class="muted">Keine Tinten ableitbar (noch keine Ink-Historie / keine Auswahl).</div>`}
            </div>
        </div>

        <div class="hr"></div>

 
          


          

        </div>


        <div class="hr"></div>

        <div class="grid2">
          <div class="card" style="margin:0;">
            <div style="font-weight:900;">📌 Stats</div>
            <div class="muted">Über alle Tage</div>
            <div class="hr"></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${pill(`${s.dayCount} Tage`)}
              ${pill(`${s.totalMarks} Füller-Nennungen`)}
              ${pill(`${s.penUse.size} unterschiedliche Füller`)}
              ${pill(`${s.inkUse.size} unterschiedliche Tinten`)}
            </div>
          </div>
          <div class="card" style="margin:0;">
            <div style="font-weight:900;">🗓️ Wochentage</div>
            <div class="muted">An welchen Tagen du am häufigsten loggst</div>
            <div class="hr"></div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;">
              ${["Mo","Di","Mi","Do","Fr","Sa","So"].map((d, i) => `
                <div class="pill" title="${esc(d)}" style="text-align:center;">${esc(d)}<br><b>${s.weekday[i] || 0}</b></div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid2">
          <div class="card" style="margin:0;">
            <div style="font-weight:900;">🏆 Top Füller</div>
            <div class="muted">nach Anzahl Tage im Log</div>
            <div class="hr"></div>
            ${s.topPens.length ? s.topPens.slice(0, 10).map((x) => {
              const p = byId(pens, x.pid);
              const label = p ? getDisplayName("pens", p) : x.pid;
              return `<div class="list-item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div style="font-weight:900;cursor:pointer;" data-open-pen="${esc(x.pid)}">🖊️ ${esc(label)}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                  ${pill(`${x.n}×`)}
                  <span class="muted">${esc(x.last || "")}</span>
                </div>
              </div>`;
            }).join("") : `<div class="muted">Noch keine Einträge.</div>`}
          </div>
          <div class="card" style="margin:0;">
            <div style="font-weight:900;">🏆 Top Tinten</div>
            <div class="muted">abgeleitet aus den geloggten Füllern</div>
            <div class="hr"></div>
            ${s.topInks.length ? s.topInks.slice(0, 10).map((x) => {
              const i = byId(inks, x.iid);
              const label = i ? inkLabel(x.iid) : x.iid;
              return `<div class="list-item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div style="font-weight:900;cursor:pointer;" data-open-ink="${esc(x.iid)}">💧 ${esc(label)}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                  ${pill(`${x.n}×`)}
                  <span class="muted">${esc(x.last || "")}</span>
                </div>
              </div>`;
            }).join("") : `<div class="muted">Noch keine ableitbaren Tinten.</div>`}
          </div>
        </div>

        <div class="hr"></div>

<div class="card" style="margin:0;">
            <div style="font-weight:900;">📅 Top-Füller je Wochentag</div>
            <div class="muted">Welcher Füller an Mo/Di/Mi… am häufigsten geloggt wurde</div>
            <div class="hr"></div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;">
              ${["Mo","Di","Mi","Do","Fr","Sa","So"].map((d, i) => {
                const t = (s.topPenByWeekday || [])[i] || { pid:null, n:0 };
                if (!t.pid) return `<div class="pill" style="text-align:center;" title="${esc(d)}">${esc(d)}<br><span class="muted">—</span></div>`;
                const p = byId(pens, t.pid);
                const label = p ? getDisplayName("pens", p) : t.pid;
                return `<div class="pill" style="text-align:center;cursor:pointer;" title="${esc(d)}: ${esc(label)}" data-open-pen="${esc(t.pid)}">${esc(d)}<br><b>${esc(label)}</b><br><span class="muted">${t.n}×</span></div>`;
              }).join("")}
            </div>
          </div>


        <div class="hr"></div>

        <div class="card" style="margin:0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-end;">
            <div>
              <div style="font-weight:900;">🕘 Letzte Einträge</div>
              <div class="muted">Klick auf Datum lädt den Tag. Klick auf Pill öffnet Details.</div>
            </div>
            <div class="pill">${Math.min(_recent.limit, es.length)} / ${es.length}</div>
          </div>
          <div class="hr"></div>
          ${es.length ? es.slice(0, _recent.limit).map((e) => {
            const pids = uniq(e.penIds || []);
            const inksDerived = dayDerivedInkIds(e.date, pids);
            return `<div class="list-item" style="display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div style="font-weight:1000;cursor:pointer;" data-open-date="${esc(e.date)}">📅 ${esc(e.date)}</div>
                <div class="muted">${esc(e.notes || "")}</div>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">${pids.map(penPill).join("")}</div>
              ${inksDerived.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${inksDerived.map(inkPill).join("")}</div>` : ""}
            </div>`;
          }).join("") + (es.length > _recent.limit ? `<button class="navItem edc-load-more" data-edc-load-more="1"><span>Weitere laden</span></button>` : ``) : `<div class="muted">Noch keine Einträge vorhanden.</div>`}
        </div>

        <div class="hr"></div>

<div class="card" style="margin:0;">
            <div style="font-weight:900;">⏳ Füller mit der längsten Pause seit letzter Nutzung</div>
            <div class="muted">Füller, die mindestens 1x im EDC-Log vorkamen, die am längsten nicht benutzt wurden. Sortiert nach: Anzahl Tage seit letzter Nutzung (absteigend) + alphabetisch</div>
            <div class="hr"></div>
            ${s.longestPens && s.longestPens.length ? s.longestPens.slice(0, 10).map((x) => {
              const p = byId(pens, x.pid);
              const label = p ? getDisplayName("pens", p) : x.pid;
              return `<div class="list-item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div style="font-weight:900;cursor:pointer;" data-open-pen="${esc(x.pid)}">🖊️ ${esc(label)}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                  ${pill(`${x.days} Tage`)}
                  <span class="muted">${esc(x.last || "")}</span>
                </div>
              </div>`;
            }).join("") : `<div class="muted">Noch keine Einträge.</div>`}
          </div>

       <div class="card" style="margin:0;">
         <div style="font-weight:900;">🚫 Noch nie verwendet</div>
            <div class="muted">Füller, die noch nie im EDC-Log auftauchten</div>
            <div class="hr"></div>
            ${s.neverUsedPens && s.neverUsedPens.length ? s.neverUsedPens.map((pid) => {
              const p = byId(pens, pid);
              const label = p ? getDisplayName("pens", p) : pid;
              return `<div class="list-item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div style="font-weight:900;cursor:pointer;" data-open-pen="${esc(pid)}">🖊️ ${esc(label)}</div>
                ${pill("0×")}
              </div>`;
            }).join("") : `<div class="muted">Alle Füller wurden mindestens einmal verwendet.</div>`}
          </div>

      </div>
    `;

// ---- wiring ----
    const $id = (id) => viewEl.querySelector(`#${CSS.escape(id)}`);

    const syncSelectedFromUI = () => {
      // checkboxes
      $$('input[data-check-pen]', viewEl).forEach((cb) => {
        const pid = cb.getAttribute('data-check-pen');
        if (!pid) return;
        if (cb.checked) selected.add(pid);
        else selected.delete(pid);
      });
    };

    $id("edcToday")?.addEventListener("click", () => {
      viewEl.setAttribute("data-edc-date", todayISO());
      render(viewEl);
    });

    $id("edcDate")?.addEventListener("change", () => {
      const d = $id("edcDate").value || todayISO();
      viewEl.setAttribute("data-edc-date", d);
      render(viewEl);
    });

    // quick toggle pills
    $$('[data-toggle-pen]', viewEl).forEach((el) => {
      el.addEventListener("click", () => {
        const pid = el.getAttribute("data-toggle-pen");
        if (!pid) return;
        if (selected.has(pid)) selected.delete(pid);
        else selected.add(pid);
        setDraftPens(Array.from(selected));
        render(viewEl);
      });
    });

    // checkbox changes
    $$('input[data-check-pen]', viewEl).forEach((cb) => {
      cb.addEventListener("change", () => {
        const pid = cb.getAttribute("data-check-pen");
        if (!pid) return;
        if (cb.checked) selected.add(pid);
        else selected.delete(pid);
        setDraftPens(Array.from(selected));
        render(viewEl);
      });
    });

    // search
    $id("edcPenSearch")?.addEventListener("input", () => {
      const q = String($id("edcPenSearch").value || "").trim().toLowerCase();
      $$('label.edcRow', viewEl).forEach((row) => {
        const n = row.getAttribute('data-name') || "";
        row.style.display = !q || n.includes(q) ? "flex" : "none";
      });

    // Persist open/closed state of "Alle Füller anzeigen"
    $id("edcAll")?.addEventListener("toggle", () => {
      _uiState.allPensOpen = !!$id("edcAll")?.open;
    });
    });

    
    // notes draft
    $id("edcNotes")?.addEventListener("input", () => {
      _draft.notes = String($id("edcNotes").value || "");
    });

// open pen / ink
    $$('[data-open-pen]', viewEl).forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const pid = el.getAttribute("data-open-pen");
        if (!pid) return;
        if (typeof window.fpvNavigate === "function") window.fpvNavigate("pens", pid);
        else { window.entity = "pens"; window.selectedId = pid; window.render?.(); }
      });
    });
    $$('[data-open-ink]', viewEl).forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const iid = el.getAttribute("data-open-ink");
        if (!iid) return;
        if (typeof window.fpvNavigate === "function") window.fpvNavigate("inks", iid);
        else { window.entity = "inks"; window.selectedId = iid; window.render?.(); }
      });
    });

    
    // load more recent entries
    $$('[data-edc-load-more]', viewEl).forEach((btn) => {
      btn.addEventListener("click", () => {
        _recent.limit += 20;
        render(viewEl);
      });
    });

// load day
    $$('[data-open-date]', viewEl).forEach((el) => {
      el.addEventListener("click", () => {
        const d = el.getAttribute("data-open-date");
        if (!d) return;
        viewEl.setAttribute("data-edc-date", d);
        render(viewEl);
      });
    });

    // save
    $id("edcSave")?.addEventListener("click", async () => {
      const date = ($id("edcDate")?.value || "").trim();
      if (!date) return alert("Bitte Datum wählen.");

      syncSelectedFromUI();
      setDraftPens(Array.from(selected));
      _draft.notes = String($id("edcNotes")?.value || "");
      const penIds = uniq(_draft.penIds || []);
      const notes = (_draft.notes || "").trim();

      let e = entryByDate(date);
      const now = new Date().toISOString();

      if (!e) {
        if (typeof window.fpvNextId !== "function") return alert("Interner Fehler: fpvNextId fehlt.");
        const id = await window.fpvNextId("event");
        e = { id, type: "edc_day", date, penIds, notes, createdAt: now, updatedAt: now };
        events.push(e);
      } else {
        e.penIds = penIds;
        e.notes = notes;
        e.updatedAt = now;
      }

      if (typeof window.fpvSaveVault === "function") await window.fpvSaveVault();
      else if (typeof window.saveVault === "function") await window.saveVault();

      _draft.date = null;
      viewEl.setAttribute("data-edc-date", date);
      window.render?.();
    });

    // delete
    $id("edcDelete")?.addEventListener("click", async () => {
      const date = ($id("edcDate")?.value || "").trim();
      if (!date) return;
      const e = entryByDate(date);
      if (!e) return;
      if (!confirm(`Eintrag ${date} wirklich löschen?`)) return;
      const idx = events.findIndex((x) => x && x.id === e.id);
      if (idx >= 0) events.splice(idx, 1);
      if (typeof window.fpvSaveVault === "function") await window.fpvSaveVault();
      _draft.date = null;
      viewEl.setAttribute("data-edc-date", todayISO());
      window.render?.();
    });
  }

  window.EDCUI = {
    renderEDCView: function ({ viewEl }) {
      try {
        render(viewEl);
      } catch (err) {
        console.error("EDCUI.renderEDCView failed:", err);
        const msg = (err && err.message) ? err.message : String(err);
        viewEl.innerHTML = `<div class="card"><div style="font-weight:900;">Füllertagebuch</div><div class="hr"></div><div class="muted">Beim Rendern ist ein Fehler aufgetreten. Öffne bitte die Browser-Konsole, dort steht die genaue Ursache.</div><div style="margin-top:10px;"><code>${esc(msg)}</code></div></div>`;
      }
    },
  };
})();

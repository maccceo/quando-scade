(() => {
  "use strict";

  const STORAGE_KEY = "scadenze.products.v1";
  const NAMES_KEY = "scadenze.names.v1";
  const SUGGESTIONS_KEY = "scadenze.suggestions.v1";
  /** Inclusive window: today through +4 days counts as soon-to-expire. */
  const SOON_DAYS = 4;

  const CATEGORIES = ["colazione", "primi", "secondi", "contorni", "snack", "dolci"];
  const CATEGORY_SET = new Set(CATEGORIES);

  const SWIPE_AXIS_LOCK = 10;
  const SWIPE_REVEAL_MAX = 88;
  const SWIPE_ACTION = 72;

  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   expiry: string | null,
   *   category: string | null,
   *   longShelf: boolean
   * }} Product
   * @typedef {{ name: string, category: string | null }} Suggestion
   */

  const $ = (id) => document.getElementById(id);

  const els = {
    main: $("main"),
    soonBlock: $("soonBlock"),
    soonList: $("soonList"),
    catalog: $("catalog"),
    emptyState: $("emptyState"),
    subtitle: $("subtitle"),
    fabAdd: $("fabAdd"),
    sheet: $("formSheet"),
    backdrop: $("sheetBackdrop"),
    sheetTitle: $("sheetTitle"),
    sheetClose: $("sheetClose"),
    form: $("productForm"),
    editId: $("editId"),
    productName: $("productName"),
    productExpiry: $("productExpiry"),
    expiryField: $("expiryField"),
    clearExpiry: $("clearExpiry"),
    categoryChips: $("categoryChips"),
    suggestions: $("suggestions"),
    saveBtn: $("saveBtn"),
    deleteBtn: $("deleteBtn"),
    toast: $("toast"),
    confirmOverlay: $("confirmOverlay"),
    confirmDialog: $("confirmDialog"),
    confirmMessage: $("confirmMessage"),
    confirmYes: $("confirmYes"),
    confirmNo: $("confirmNo"),
  };

  let toastTimer = 0;
  /** @type {null | ((ok: boolean) => void)} */
  let confirmResolver = null;
  /** @type {string | null} */
  let selectedCategory = null;

  /** @type {{
    li: HTMLElement,
    row: HTMLElement,
    id: string,
    startX: number,
    startY: number,
    dx: number,
    axis: "undecided" | "h" | "v",
    pointerId: number,
  } | null} */
  let swipe = null;

  function normalizeCategory(raw) {
    if (typeof raw !== "string") return null;
    const c = raw.trim().toLowerCase();
    return CATEGORY_SET.has(c) ? c : null;
  }

  /** In-place compatible migration: keep ids/names/expiry; add category/longShelf. */
  function normalizeProduct(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return null;

    const id =
      typeof raw.id === "string" && raw.id
        ? raw.id
        : uid();

    let expiry = null;
    if (typeof raw.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.expiry)) {
      expiry = raw.expiry;
    }

    const category = normalizeCategory(raw.category);

    let longShelf = Boolean(raw.longShelf);
    if (raw.longShelf == null && expiry == null) {
      // Old entries always had expiry; if somehow missing, treat as long shelf.
      longShelf = true;
    }
    if (longShelf) expiry = null;
    if (!longShelf && !expiry) {
      // Keep required-date semantics for non-long-shelf items without a date.
      longShelf = false;
      expiry = null;
    }

    return { id, name, expiry, category, longShelf };
  }

  function needsProductMigration(raw) {
    if (!raw || typeof raw !== "object") return true;
    return !("category" in raw) || !("longShelf" in raw) || (raw.longShelf && raw.expiry);
  }

  function loadProducts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      const dirty = list.some(needsProductMigration);
      const normalized = list.map(normalizeProduct).filter(Boolean);
      // Persist only when old shape needs category/longShelf fields.
      if (dirty) saveProducts(normalized);
      return normalized;
    } catch {
      return [];
    }
  }

  function saveProducts(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function migrateSuggestionsFromLegacyNames() {
    if (localStorage.getItem(SUGGESTIONS_KEY)) return;
    try {
      const raw = localStorage.getItem(NAMES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return;
      const mapped = list
        .filter((n) => typeof n === "string" && n.trim())
        .map((n) => ({ name: n.trim(), category: null }));
      if (mapped.length) {
        localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(mapped.slice(0, 200)));
      } else {
        localStorage.setItem(SUGGESTIONS_KEY, "[]");
      }
    } catch {
      localStorage.setItem(SUGGESTIONS_KEY, "[]");
    }
  }

  function loadSuggestions() {
    migrateSuggestionsFromLegacyNames();
    try {
      const raw = localStorage.getItem(SUGGESTIONS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list
        .map((s) => {
          if (typeof s === "string") return { name: s.trim(), category: null };
          if (!s || typeof s !== "object") return null;
          const name = typeof s.name === "string" ? s.name.trim() : "";
          if (!name) return null;
          return { name, category: normalizeCategory(s.category) };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function rememberSuggestion(name, category) {
    const n = name.trim();
    if (!n) return;
    const cat = normalizeCategory(category);
    const list = loadSuggestions();
    const lower = n.toLowerCase();
    const next = list.filter((x) => x.name.toLowerCase() !== lower);
    next.unshift({ name: n, category: cat });
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(next.slice(0, 200)));
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function todayLocal() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function todayISO() {
    const t = todayLocal();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function daysUntil(iso) {
    if (!iso) return null;
    const exp = parseISODate(iso);
    const t = todayLocal();
    return Math.round((exp - t) / 86400000);
  }

  function formatExpiryShort(iso) {
    const d = parseISODate(iso);
    const formatted = new Intl.DateTimeFormat("it-IT", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(d);
    return formatted.replace(/\./g, "").toLowerCase();
  }

  function urgencyLabel(days) {
    if (days == null) return "lunga conservazione";
    if (days < 0) return days === -1 ? "scaduto ieri" : `scaduto da ${-days} gg`;
    if (days === 0) return "scade oggi";
    if (days === 1) return "scade domani";
    return `tra ${days} giorni`;
  }

  function pillClass(days) {
    if (days == null) return "shelf";
    if (days < 0) return "expired";
    if (days <= SOON_DAYS) return "soon";
    return "";
  }

  function isSoon(p) {
    if (p.longShelf || !p.expiry) return false;
    const days = daysUntil(p.expiry);
    return days != null && days <= SOON_DAYS;
  }

  function sortByExpiry(list) {
    return [...list].sort((a, b) => {
      const da = daysUntil(a.expiry);
      const db = daysUntil(b.expiry);
      if (da == null && db == null) return a.name.localeCompare(b.name, "it");
      if (da == null) return 1;
      if (db == null) return -1;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name, "it");
    });
  }

  function showToast(msg) {
    els.toast.hidden = false;
    els.toast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 2200);
  }

  function askConfirm(message) {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      els.confirmMessage.textContent = message;
      els.confirmOverlay.hidden = false;
    });
  }

  function closeConfirm(ok) {
    els.confirmOverlay.hidden = true;
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(ok);
  }

  function isConfirmOpen() {
    return !els.confirmOverlay.hidden;
  }

  function hideSuggestions() {
    els.suggestions.hidden = true;
    els.suggestions.innerHTML = "";
  }

  function setCategory(cat) {
    selectedCategory = normalizeCategory(cat);
    els.categoryChips.querySelectorAll(".chip").forEach((btn) => {
      const on = btn.getAttribute("data-category") === selectedCategory;
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("active", on);
    });
  }

  function syncClearExpiryBtn() {
    els.clearExpiry.hidden = !els.productExpiry.value;
  }

  function clearExpiryDate() {
    els.productExpiry.value = "";
    syncClearExpiryBtn();
  }

  function openSheet({ mode, product } = { mode: "add" }) {
    els.sheet.hidden = false;
    els.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    hideSuggestions();

    if (mode === "edit" && product) {
      els.sheetTitle.textContent = "Modifica";
      els.editId.value = product.id;
      els.productName.value = product.name;
      setCategory(product.category);
      els.productExpiry.value =
        product.longShelf || !product.expiry ? "" : product.expiry || todayISO();
      els.deleteBtn.hidden = false;
      els.saveBtn.textContent = "Aggiorna";
    } else {
      els.sheetTitle.textContent = "Nuovo prodotto";
      els.editId.value = "";
      els.productName.value = "";
      setCategory(null);
      els.productExpiry.value = todayISO();
      els.deleteBtn.hidden = true;
      els.saveBtn.textContent = "Salva";
    }
    syncClearExpiryBtn();

    window.setTimeout(() => {
      hideSuggestions();
      els.productName.focus({ preventScroll: true });
      hideSuggestions();
    }, 50);
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.backdrop.hidden = true;
    document.body.style.overflow = "";
    els.form.reset();
    els.editId.value = "";
    setCategory(null);
    syncClearExpiryBtn();
    hideSuggestions();
  }

  function renderSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      hideSuggestions();
      return;
    }

    const matches = loadSuggestions()
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 8);

    if (!matches.length) {
      hideSuggestions();
      return;
    }

    els.suggestions.innerHTML = matches
      .map((s) => {
        const catAttr = s.category ? escapeAttr(s.category) : "";
        const hint = s.category ? ` <em>${escapeHtml(s.category)}</em>` : "";
        return `<li role="option"><button type="button" data-name="${escapeAttr(s.name)}" data-category="${catAttr}">${escapeHtml(s.name)}${hint}</button></li>`;
      })
      .join("");
    els.suggestions.hidden = false;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function resetRowTransform(li, row) {
    li.classList.remove("dragging", "swiping-edit", "swiping-delete");
    row.style.transform = "";
  }

  async function confirmDelete(id) {
    const ok = await askConfirm("Sei sicuro di voler eliminare l’elemento?");
    if (!ok) return;
    deleteProduct(id);
    render();
    showToast("Prodotto eliminato");
  }

  function openEditById(id) {
    const p = loadProducts().find((x) => x.id === id);
    if (p) openSheet({ mode: "edit", product: p });
  }

  function productItemHtml(p, i) {
    const days = daysUntil(p.expiry);
    const pc = pillClass(days);
    const pillText = p.expiry ? formatExpiryShort(p.expiry) : "senza data";
    const delay = `${Math.min(i, 12) * 28}ms`;
    return `
      <li class="product-item" data-id="${escapeAttr(p.id)}" style="animation-delay:${delay}">
        <div class="swipe-bg edit" aria-hidden="true">Modifica</div>
        <div class="swipe-bg delete" aria-hidden="true">Elimina</div>
        <div class="product-row">
          <div class="product-main">
            <p class="product-name">${escapeHtml(p.name)}</p>
            <p class="product-meta">${urgencyLabel(days)}</p>
          </div>
          <span class="expiry-pill ${pc}">${escapeHtml(pillText)}</span>
        </div>
      </li>
    `;
  }

  function fillList(ul, products) {
    ul.innerHTML = products.map((p, i) => productItemHtml(p, i)).join("");
  }

  function render() {
    const all = loadProducts();
    const soon = sortByExpiry(all.filter(isSoon));

    els.subtitle.textContent =
      all.length === 0
        ? "I tuoi prodotti"
        : all.length === 1
          ? "1 prodotto"
          : `${all.length} prodotti`;

    els.emptyState.hidden = all.length > 0;

    els.soonBlock.hidden = soon.length === 0;
    if (soon.length) fillList(els.soonList, soon);
    else els.soonList.innerHTML = "";

    const openCats = new Set(
      [...els.catalog.querySelectorAll("details.cat-section[open]")].map(
        (el) => el.getAttribute("data-cat") || ""
      )
    );

    const sections = [];
    for (const cat of CATEGORIES) {
      const items = sortByExpiry(all.filter((p) => p.category === cat));
      if (!items.length) continue;
      sections.push({ key: cat, title: cat, items });
    }
    const other = sortByExpiry(all.filter((p) => !p.category));
    if (other.length) {
      sections.push({ key: "altro", title: "altro", items: other });
    }

    els.catalog.innerHTML = sections
      .map((sec) => {
        const openAttr = openCats.has(sec.key) ? " open" : "";
        return `
      <details class="cat-section" data-cat="${escapeAttr(sec.key)}"${openAttr}>
        <summary class="cat-summary">
          <span class="cat-title">${escapeHtml(sec.title)}</span>
          <span class="cat-count">${sec.items.length}</span>
        </summary>
        <ul class="product-list">${sec.items.map((p, i) => productItemHtml(p, i)).join("")}</ul>
      </details>`;
      })
      .join("");
  }

  function upsertProduct({ name, expiry, category, longShelf, id }) {
    const products = loadProducts();
    const payload = {
      name,
      expiry: longShelf ? null : expiry,
      category: normalizeCategory(category),
      longShelf: Boolean(longShelf),
    };
    if (id) {
      const idx = products.findIndex((p) => p.id === id);
      if (idx >= 0) {
        products[idx] = { ...products[idx], ...payload };
      }
    } else {
      products.push({ id: uid(), ...payload });
    }
    saveProducts(products);
    rememberSuggestion(name, payload.category);
  }

  function deleteProduct(id) {
    const products = loadProducts().filter((p) => p.id !== id);
    saveProducts(products);
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const li = e.target.closest(".product-item");
    if (!li || !els.main.contains(li)) return;
    if (!els.sheet.hidden || isConfirmOpen()) return;
    // Don't start swipe from the summary toggle.
    if (e.target.closest("summary")) return;

    const row = li.querySelector(".product-row");
    if (!row) return;

    swipe = {
      li,
      row,
      id: li.dataset.id || "",
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      axis: "undecided",
      pointerId: e.pointerId,
    };
    li.classList.add("dragging");
    try {
      li.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;

    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;

    if (swipe.axis === "undecided") {
      if (Math.abs(dx) < SWIPE_AXIS_LOCK && Math.abs(dy) < SWIPE_AXIS_LOCK) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        const abandoned = swipe;
        resetRowTransform(abandoned.li, abandoned.row);
        try {
          abandoned.li.releasePointerCapture(abandoned.pointerId);
        } catch {
          /* ignore */
        }
        swipe = null;
        return;
      }
      swipe.axis = "h";
    }

    if (swipe.axis !== "h") return;

    e.preventDefault();
    swipe.dx = clamp(dx, -SWIPE_REVEAL_MAX, SWIPE_REVEAL_MAX);
    swipe.row.style.transform = `translate3d(${swipe.dx}px, 0, 0)`;
    swipe.li.classList.toggle("swiping-edit", swipe.dx > 12);
    swipe.li.classList.toggle("swiping-delete", swipe.dx < -12);
  }

  function onPointerUp(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;

    const { li, row, id, dx, axis } = swipe;
    swipe = null;

    if (axis !== "h") {
      resetRowTransform(li, row);
      return;
    }

    li.classList.remove("dragging");

    if (dx >= SWIPE_ACTION) {
      row.style.transform = "";
      li.classList.remove("swiping-edit", "swiping-delete");
      openEditById(id);
      return;
    }

    if (dx <= -SWIPE_ACTION) {
      row.style.transform = "";
      li.classList.remove("swiping-edit", "swiping-delete");
      confirmDelete(id);
      return;
    }

    resetRowTransform(li, row);
  }

  function onPointerCancel(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    resetRowTransform(swipe.li, swipe.row);
    swipe = null;
  }

  // Events
  els.fabAdd.addEventListener("click", () => openSheet({ mode: "add" }));
  els.sheetClose.addEventListener("click", closeSheet);
  els.backdrop.addEventListener("click", closeSheet);

  els.categoryChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip[data-category]");
    if (!btn) return;
    const cat = btn.getAttribute("data-category");
    setCategory(selectedCategory === cat ? null : cat);
  });

  els.clearExpiry.addEventListener("click", (e) => {
    e.preventDefault();
    clearExpiryDate();
  });

  els.productExpiry.addEventListener("input", syncClearExpiryBtn);
  els.productExpiry.addEventListener("change", syncClearExpiryBtn);

  els.productName.addEventListener("input", () => {
    renderSuggestions(els.productName.value);
  });

  els.productName.addEventListener("focus", () => {
    hideSuggestions();
  });

  els.suggestions.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-name]");
    if (!btn) return;
    els.productName.value = btn.getAttribute("data-name") || "";
    const cat = btn.getAttribute("data-category") || "";
    setCategory(cat || null);
    hideSuggestions();
    els.productExpiry.focus();
  });

  document.addEventListener("click", (e) => {
    if (!els.suggestions.hidden && !els.productName.contains(e.target) && !els.suggestions.contains(e.target)) {
      hideSuggestions();
    }
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = els.productName.value.trim();
    const expiry = els.productExpiry.value;
    const longShelf = !expiry;
    if (!name) {
      showToast("Inserisci il nome");
      return;
    }
    const id = els.editId.value || null;
    upsertProduct({
      name,
      expiry: longShelf ? null : expiry,
      category: selectedCategory,
      longShelf,
      id,
    });
    closeSheet();
    render();
    showToast(id ? "Prodotto aggiornato" : "Prodotto salvato");
  });

  els.deleteBtn.addEventListener("click", async () => {
    const id = els.editId.value;
    if (!id) return;
    const ok = await askConfirm("Sei sicuro di voler eliminare l’elemento?");
    if (!ok) return;
    deleteProduct(id);
    closeSheet();
    render();
    showToast("Prodotto eliminato");
  });

  els.confirmYes.addEventListener("click", () => closeConfirm(true));
  els.confirmNo.addEventListener("click", () => closeConfirm(false));
  els.confirmOverlay.addEventListener("click", (e) => {
    if (e.target === els.confirmOverlay) closeConfirm(false);
  });

  els.main.addEventListener("pointerdown", onPointerDown);
  els.main.addEventListener("pointermove", onPointerMove, { passive: false });
  els.main.addEventListener("pointerup", onPointerUp);
  els.main.addEventListener("pointercancel", onPointerCancel);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isConfirmOpen()) {
      closeConfirm(false);
      return;
    }
    if (!els.sheet.hidden) closeSheet();
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  els.confirmOverlay.hidden = true;
  confirmResolver = null;
  setCategory(null);
  syncClearExpiryBtn();

  render();
})();

(() => {
  "use strict";

  const STORAGE_KEY = "scadenze.products.v1";
  const NAMES_KEY = "scadenze.names.v1";
  /** Inclusive window: today through +4 days counts as soon-to-expire. */
  const SOON_DAYS = 4;

  /** @typedef {{ id: string, name: string, expiry: string }} Product */

  const $ = (id) => document.getElementById(id);

  const els = {
    productList: $("productList"),
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
    suggestions: $("suggestions"),
    saveBtn: $("saveBtn"),
    deleteBtn: $("deleteBtn"),
    toast: $("toast"),
  };

  let toastTimer = 0;

  const ICON_EDIT =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3zM13.5 6.5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_DELETE =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h14M10 11v6M14 11v6M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 8l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function loadProducts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveProducts(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function loadNames() {
    try {
      const raw = localStorage.getItem(NAMES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function rememberName(name) {
    const n = name.trim();
    if (!n) return;
    const names = loadNames();
    const lower = n.toLowerCase();
    const next = names.filter((x) => x.toLowerCase() !== lower);
    next.unshift(n);
    localStorage.setItem(NAMES_KEY, JSON.stringify(next.slice(0, 200)));
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

  /** YYYY-MM-DD for <input type="date"> — defaults picker year to current calendar year. */
  function todayISO() {
    const t = todayLocal();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function daysUntil(iso) {
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
    // "mar 8 nov" style — strip trailing dots from Italian short weekday/month
    return formatted.replace(/\./g, "").toLowerCase();
  }

  function urgencyLabel(days) {
    if (days < 0) return days === -1 ? "scaduto ieri" : `scaduto da ${-days} gg`;
    if (days === 0) return "scade oggi";
    if (days === 1) return "scade domani";
    if (days <= SOON_DAYS) return `tra ${days} giorni`;
    return `tra ${days} giorni`;
  }

  function pillClass(days) {
    if (days < 0) return "expired";
    if (days <= SOON_DAYS) return "soon";
    return "";
  }

  function sortedProducts(list) {
    return [...list].sort((a, b) => {
      const da = daysUntil(a.expiry);
      const db = daysUntil(b.expiry);
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

  function openSheet({ mode, product } = { mode: "add" }) {
    els.sheet.hidden = false;
    els.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    els.suggestions.hidden = true;
    els.suggestions.innerHTML = "";

    if (mode === "edit" && product) {
      els.sheetTitle.textContent = "Modifica";
      els.editId.value = product.id;
      els.productName.value = product.name;
      els.productExpiry.value = product.expiry || todayISO();
      els.deleteBtn.hidden = false;
      els.saveBtn.textContent = "Aggiorna";
    } else {
      els.sheetTitle.textContent = "Nuovo prodotto";
      els.editId.value = "";
      els.productName.value = "";
      els.productExpiry.value = todayISO();
      els.deleteBtn.hidden = true;
      els.saveBtn.textContent = "Salva";
    }

    window.setTimeout(() => els.productName.focus(), 50);
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.backdrop.hidden = true;
    document.body.style.overflow = "";
    els.form.reset();
    els.editId.value = "";
    els.suggestions.hidden = true;
  }

  function renderSuggestions(query) {
    const q = query.trim().toLowerCase();
    // Only show after the user has typed something — never on empty focus/open.
    if (!q) {
      els.suggestions.hidden = true;
      els.suggestions.innerHTML = "";
      return;
    }

    const matches = loadNames()
      .filter((n) => n.toLowerCase().includes(q))
      .slice(0, 8);

    if (!matches.length) {
      els.suggestions.hidden = true;
      els.suggestions.innerHTML = "";
      return;
    }

    els.suggestions.innerHTML = matches
      .map(
        (n) =>
          `<li role="option"><button type="button" data-name="${escapeAttr(n)}">${escapeHtml(n)}</button></li>`
      )
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

  function render() {
    const list = sortedProducts(loadProducts());

    els.subtitle.textContent =
      list.length === 0
        ? "I tuoi prodotti"
        : list.length === 1
          ? "1 prodotto"
          : `${list.length} prodotti`;

    els.emptyState.hidden = list.length > 0;
    els.productList.innerHTML = "";

    list.forEach((p, i) => {
      const days = daysUntil(p.expiry);
      const li = document.createElement("li");
      li.className = "product-item";
      if (days < 0) li.classList.add("expired");
      else if (days <= SOON_DAYS) li.classList.add("urgent");
      li.style.animationDelay = `${Math.min(i, 12) * 28}ms`;

      const pc = pillClass(days);
      li.innerHTML = `
        <div class="item-actions">
          <button type="button" class="icon-action" data-edit="${p.id}" aria-label="Modifica">${ICON_EDIT}</button>
          <button type="button" class="icon-action danger" data-del="${p.id}" aria-label="Elimina">${ICON_DELETE}</button>
        </div>
        <button type="button" class="product-main" data-edit="${p.id}">
          <p class="product-name">${escapeHtml(p.name)}</p>
          <p class="product-meta">${urgencyLabel(days)}</p>
        </button>
        <span class="expiry-pill ${pc}">${formatExpiryShort(p.expiry)}</span>
      `;
      els.productList.appendChild(li);
    });
  }

  function upsertProduct(name, expiry, id) {
    const products = loadProducts();
    if (id) {
      const idx = products.findIndex((p) => p.id === id);
      if (idx >= 0) {
        products[idx] = { ...products[idx], name, expiry };
      }
    } else {
      products.push({ id: uid(), name, expiry });
    }
    saveProducts(products);
    rememberName(name);
  }

  function deleteProduct(id) {
    const products = loadProducts().filter((p) => p.id !== id);
    saveProducts(products);
  }

  // Events
  els.fabAdd.addEventListener("click", () => openSheet({ mode: "add" }));
  els.sheetClose.addEventListener("click", closeSheet);
  els.backdrop.addEventListener("click", closeSheet);

  els.productName.addEventListener("input", () => {
    renderSuggestions(els.productName.value);
  });

  els.productName.addEventListener("focus", () => {
    // Hide until typing; empty focus must not reopen recent names.
    if (!els.productName.value.trim()) {
      els.suggestions.hidden = true;
      els.suggestions.innerHTML = "";
      return;
    }
    renderSuggestions(els.productName.value);
  });

  els.suggestions.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-name]");
    if (!btn) return;
    els.productName.value = btn.getAttribute("data-name") || "";
    els.suggestions.hidden = true;
    els.productExpiry.focus();
  });

  document.addEventListener("click", (e) => {
    if (!els.suggestions.hidden && !els.productName.contains(e.target) && !els.suggestions.contains(e.target)) {
      els.suggestions.hidden = true;
    }
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = els.productName.value.trim();
    const expiry = els.productExpiry.value;
    if (!name || !expiry) {
      showToast("Inserisci nome e data");
      return;
    }
    const id = els.editId.value || null;
    upsertProduct(name, expiry, id);
    closeSheet();
    render();
    showToast(id ? "Prodotto aggiornato" : "Prodotto salvato");
  });

  els.deleteBtn.addEventListener("click", () => {
    const id = els.editId.value;
    if (!id) return;
    if (!confirm("Eliminare questo prodotto?")) return;
    deleteProduct(id);
    closeSheet();
    render();
    showToast("Prodotto eliminato");
  });

  els.productList.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const id = del.getAttribute("data-del");
      const products = loadProducts();
      const p = products.find((x) => x.id === id);
      const label = p ? `"${p.name}"` : "questo prodotto";
      if (!confirm(`Eliminare ${label}?`)) return;
      deleteProduct(id);
      render();
      showToast("Prodotto eliminato");
      return;
    }
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      const id = edit.getAttribute("data-edit");
      const p = loadProducts().find((x) => x.id === id);
      if (p) openSheet({ mode: "edit", product: p });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.sheet.hidden) closeSheet();
  });

  // SW registration (needs http/https — skip file://)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  render();
})();

(() => {
  "use strict";

  const STORAGE_KEY = "scadenze.products.v1";
  const NAMES_KEY = "scadenze.names.v1";
  const SOON_DAYS = 7;

  /** @typedef {{ id: string, name: string, expiry: string }} Product */

  const $ = (id) => document.getElementById(id);

  const els = {
    productList: $("productList"),
    emptyState: $("emptyState"),
    soonBanner: $("soonBanner"),
    soonText: $("soonText"),
    subtitle: $("subtitle"),
    filterSoon: $("filterSoon"),
    fabAdd: $("fabAdd"),
    navHome: $("navHome"),
    navAdd: $("navAdd"),
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

  let filterSoonOnly = false;
  let toastTimer = 0;

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
      els.productExpiry.value = product.expiry;
      els.deleteBtn.hidden = false;
      els.saveBtn.textContent = "Aggiorna";
    } else {
      els.sheetTitle.textContent = "Nuovo prodotto";
      els.editId.value = "";
      els.productName.value = "";
      els.productExpiry.value = "";
      els.deleteBtn.hidden = true;
      els.saveBtn.textContent = "Salva";
    }

    setNav("add");
    window.setTimeout(() => els.productName.focus(), 50);
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.backdrop.hidden = true;
    document.body.style.overflow = "";
    els.form.reset();
    els.editId.value = "";
    els.suggestions.hidden = true;
    setNav("home");
  }

  function setNav(view) {
    els.navHome.classList.toggle("active", view === "home");
    els.navAdd.classList.toggle("active", view === "add");
  }

  function renderSuggestions(query) {
    const q = query.trim().toLowerCase();
    const names = loadNames();
    const matches = q
      ? names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8)
      : names.slice(0, 6);

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
    const all = sortedProducts(loadProducts());
    const soonCount = all.filter((p) => daysUntil(p.expiry) <= SOON_DAYS).length;
    const expiredCount = all.filter((p) => daysUntil(p.expiry) < 0).length;
    const list = filterSoonOnly
      ? all.filter((p) => daysUntil(p.expiry) <= SOON_DAYS)
      : all;

    els.subtitle.textContent =
      all.length === 0
        ? "I tuoi prodotti"
        : all.length === 1
          ? "1 prodotto"
          : `${all.length} prodotti`;

    if (all.length === 0) {
      els.soonBanner.hidden = true;
    } else if (expiredCount > 0) {
      els.soonBanner.hidden = false;
      els.soonBanner.dataset.level = "expired";
      els.soonText.textContent =
        expiredCount === 1
          ? "1 prodotto scaduto — controlla prima"
          : `${expiredCount} prodotti scaduti — controlla prima`;
    } else if (soonCount > 0) {
      els.soonBanner.hidden = false;
      els.soonBanner.dataset.level = "soon";
      els.soonText.textContent =
        soonCount === 1
          ? "1 prodotto prossimo alla scadenza"
          : `${soonCount} prodotti prossimi alla scadenza`;
    } else {
      els.soonBanner.hidden = false;
      els.soonBanner.dataset.level = "ok";
      els.soonText.textContent = "Niente in scadenza nei prossimi 7 giorni";
    }

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
        <button type="button" class="product-main" data-edit="${p.id}">
          <p class="product-name">${escapeHtml(p.name)}</p>
          <p class="product-meta">${urgencyLabel(days)}</p>
        </button>
        <span class="expiry-pill ${pc}">${formatExpiryShort(p.expiry)}</span>
        <div class="item-actions">
          <button type="button" class="tiny" data-edit="${p.id}">Modifica</button>
          <button type="button" class="tiny danger" data-del="${p.id}">Elimina</button>
        </div>
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
  els.navAdd.addEventListener("click", () => openSheet({ mode: "add" }));
  els.navHome.addEventListener("click", () => {
    closeSheet();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  els.sheetClose.addEventListener("click", closeSheet);
  els.backdrop.addEventListener("click", closeSheet);

  els.filterSoon.addEventListener("click", () => {
    filterSoonOnly = !filterSoonOnly;
    els.filterSoon.setAttribute("aria-pressed", String(filterSoonOnly));
    els.filterSoon.textContent = filterSoonOnly ? "Tutti" : "Presto";
    render();
  });

  els.productName.addEventListener("input", () => {
    renderSuggestions(els.productName.value);
  });

  els.productName.addEventListener("focus", () => {
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

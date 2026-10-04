"use strict";
(() => {
  // plugins/addon-reorder/order.ts
  var metaClaim = ({ manifest }) => {
    const resource = (manifest.resources ?? []).find((entry) => (typeof entry === "string" ? entry : entry.name) === "meta");
    if (resource === void 0) return null;
    const own = typeof resource === "string" ? {} : resource;
    return {
      types: own.types ?? manifest.types ?? [],
      idPrefixes: own.idPrefixes ?? manifest.idPrefixes ?? null
    };
  };
  var prefixesOverlap = (a, b) => a === null || b === null || a.length === 0 || b.length === 0 || a.some((left) => b.some((right) => left.startsWith(right) || right.startsWith(left)));
  var sharedTypes = (a, b) => prefixesOverlap(a.idPrefixes, b.idPrefixes) ? a.types.filter((type) => b.types.includes(type)) : [];
  var metadataRivals = (addons) => {
    const claims = addons.map((addon) => ({ addon, claim: metaClaim(addon) }));
    const rivals = /* @__PURE__ */ new Map();
    claims.forEach(({ addon, claim }) => {
      if (claim === null) return;
      const found = claims.flatMap((other) => {
        if (other.addon === addon || other.claim === null) return [];
        const types = sharedTypes(claim, other.claim);
        return types.length > 0 ? [{ name: other.addon.manifest.name, types }] : [];
      });
      if (found.length > 0) {
        rivals.set(addon.transportUrl, found);
      }
    });
    return rivals;
  };
  var move = (items, from, before) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(before > from ? before - 1 : before, 0, item);
    return next;
  };
  var isSameOrder = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  var isPermutation = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((value) => b.includes(value));
  var listNames = (names) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  var unlockMessage = (name, rivals) => {
    const types = [...new Set(rivals.flatMap((rival) => rival.types))];
    return `${name} and ${listNames(rivals.map((rival) => rival.name))} can all describe the same titles (${listNames(types)}). Stremio uses whichever is higher in the list, so moving this addon can change titles, posters and episode lists.`;
  };

  // plugins/addon-reorder/styles.css
  var styles_default = '[data-mys-reorder-list] { position: relative; }\n[data-mys-reorder] { position: relative; }\n[data-mys-reorder][data-mys-movable="true"] { cursor: grab; }\n[data-mys-reorder-active], [data-mys-reorder-active] * { cursor: grabbing !important; user-select: none; }\n[data-mys-reorder][data-mys-dragging] { opacity: .4; }\n\n.mys-reorder-handle {\n    position: absolute;\n    top: 50%;\n    left: 2px;\n    transform: translateY(-50%);\n    width: 26px;\n    height: 26px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    border-radius: 8px;\n    opacity: .6;\n}\n.mys-reorder-handle svg { width: 18px; height: 18px; fill: currentColor; }\n.mys-reorder-handle[data-state="locked"],\n.mys-reorder-handle[data-state="unlocked"] { cursor: pointer; opacity: .8; }\n.mys-reorder-handle[data-state="locked"] { color: #f5b942; }\n.mys-reorder-handle:hover { opacity: 1; background: rgba(255, 255, 255, .1); }\n\n.mys-reorder-indicator {\n    position: absolute;\n    left: 0;\n    right: 0;\n    height: 3px;\n    margin-top: -2px;\n    border-radius: 2px;\n    background: #7b5bf5;\n    pointer-events: none;\n}\n';

  // plugins/addon-reorder/index.ts
  var ICONS = {
    grip: '<svg viewBox="0 0 24 24"><path d="M9 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9-14a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>',
    locked: '<svg viewBox="0 0 24 24"><path d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z"/></svg>',
    unlocked: '<svg viewBox="0 0 24 24"><path d="M17 9H9V7a3 3 0 0 1 5.8-1.1l1.9-.7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Z"/></svg>'
  };
  var DRAG_THRESHOLD = 6;
  var activate = (api) => {
    let addons = [];
    let rivals = /* @__PURE__ */ new Map();
    let saving = false;
    const unlocked = () => new Set(api.storage.get("unlocked", []));
    const stateOf = (addon) => {
      if (!rivals.has(addon.transportUrl)) return "movable";
      return unlocked().has(addon.transportUrl) ? "unlocked" : "locked";
    };
    const toggleLock = async (addon) => {
      const urls = unlocked();
      if (urls.has(addon.transportUrl)) {
        urls.delete(addon.transportUrl);
      } else {
        const accepted = await api.ui.confirm({
          title: `Unlock ${addon.manifest.name}?`,
          message: unlockMessage(addon.manifest.name, rivals.get(addon.transportUrl) ?? []),
          confirmLabel: "Unlock"
        });
        if (!accepted) return;
        urls.add(addon.transportUrl);
      }
      api.storage.set("unlocked", [...urls]);
    };
    const save = async (from, before) => {
      const current2 = addons.map((addon) => addon.transportUrl);
      const next = move(current2, from, before);
      if (saving || isSameOrder(current2, next)) return;
      saving = true;
      try {
        const collection = await api.account.getAddonCollection();
        if (!isPermutation(current2, collection.map((addon) => addon.transportUrl))) {
          throw new Error("Your addon list changed in the meantime. Try again.");
        }
        await api.account.setAddonCollection(next.map((url) => collection.find((addon) => addon.transportUrl === url)));
        api.ui.toast({ type: "success", title: "Addon order saved" });
      } catch (error) {
        api.ui.toast({ type: "error", title: error instanceof Error ? error.message : String(error) });
      } finally {
        saving = false;
      }
    };
    api.anchors.watch("addons.installed.list", (list) => {
      const indicator = document.createElement("div");
      indicator.className = "mys-reorder-indicator";
      let disposed = false;
      const cards = () => [...list.children].filter((child) => child instanceof HTMLElement && !child.matches(".mys-reorder-indicator"));
      const refresh = async () => {
        const [ctx, installed] = await Promise.all([api.core.getState("ctx"), api.core.getState("installed_addons")]);
        if (disposed) return;
        addons = ctx.profile.addons;
        rivals = metadataRivals(addons);
        const search = list.closest('[class*="addons-content-"]')?.querySelector('[class*="search-bar-"] input');
        const reorderable = !ctx.profile.addonsLocked && installed?.selected?.request?.type === null && (search?.value ?? "") === "" && cards().length === addons.length;
        cards().forEach((card, index) => {
          let handle = card.querySelector(":scope > .mys-reorder-handle");
          const addon = addons[index];
          if (!reorderable || addon === void 0) {
            handle?.remove();
            delete card.dataset.mysReorder;
            delete card.dataset.mysMovable;
            return;
          }
          if (handle === null) {
            handle = document.createElement("div");
            handle.className = "mys-reorder-handle";
            handle.addEventListener("click", (event) => {
              event.stopPropagation();
              const target = addons[Number(card.dataset.mysReorder)];
              if (target !== void 0 && stateOf(target) !== "movable") {
                toggleLock(target);
              }
            });
            card.append(handle);
          }
          const state = stateOf(addon);
          card.dataset.mysReorder = String(index);
          card.dataset.mysMovable = String(state !== "locked");
          if (handle.dataset.state !== state) {
            handle.dataset.state = state;
            handle.innerHTML = ICONS[state === "movable" ? "grip" : state];
            handle.title = {
              movable: "Drag to reorder",
              locked: "Locked: its position decides where titles get their details. Click to unlock.",
              unlocked: "Unlocked. Drag to reorder, or click to lock again."
            }[state];
          }
        });
      };
      const dropIndex = (y) => {
        const index = cards().findIndex((card) => {
          const { top, height } = card.getBoundingClientRect();
          return y < top + height / 2;
        });
        return index === -1 ? cards().length : index;
      };
      const showIndicator = (before) => {
        const all = cards();
        const edge = before < all.length ? all[before].getBoundingClientRect().top : all[all.length - 1].getBoundingClientRect().bottom;
        indicator.style.top = `${edge - list.getBoundingClientRect().top + list.scrollTop}px`;
        list.append(indicator);
      };
      const onPointerDown = (down) => {
        const target = down.target;
        const card = target.closest("[data-mys-reorder]");
        const inner = target.closest("[tabindex], a, button, .mys-reorder-handle");
        if (down.button !== 0 || !card || card.dataset.mysMovable !== "true" || inner !== null && inner !== card) return;
        const from = Number(card.dataset.mysReorder);
        let dragging = false;
        const onMove = (event) => {
          if (!dragging && Math.abs(event.clientY - down.clientY) < DRAG_THRESHOLD) return;
          dragging = true;
          card.dataset.mysDragging = "";
          list.dataset.mysReorderActive = "";
          showIndicator(dropIndex(event.clientY));
        };
        const stop = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", stop);
          indicator.remove();
          delete card.dataset.mysDragging;
          delete list.dataset.mysReorderActive;
        };
        const onUp = (event) => {
          stop();
          if (!dragging) return;
          document.addEventListener("click", (click) => click.stopPropagation(), { capture: true, once: true });
          setTimeout(() => save(from, dropIndex(event.clientY)));
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", stop);
      };
      list.dataset.mysReorderList = "";
      list.addEventListener("pointerdown", onPointerDown);
      const observer = new MutationObserver(() => refresh());
      observer.observe(list, { childList: true });
      document.addEventListener("input", refresh, true);
      const stopState = api.core.on("state", (models) => {
        if (models.includes("ctx") || models.includes("installed_addons")) refresh();
      });
      const stopSettings = api.storage.onChange(refresh);
      refresh();
      return () => {
        disposed = true;
        observer.disconnect();
        stopState();
        stopSettings();
        document.removeEventListener("input", refresh, true);
        list.removeEventListener("pointerdown", onPointerDown);
        indicator.remove();
        delete list.dataset.mysReorderList;
        cards().forEach((card) => {
          card.querySelector(":scope > .mys-reorder-handle")?.remove();
          delete card.dataset.mysReorder;
          delete card.dataset.mysMovable;
        });
      };
    });
  };
  var addonReorder = {
    manifest: {
      id: "addon-reorder",
      name: "Addon order",
      version: "1.0.0",
      apiVersion: 0,
      description: "Drag installed addons to change their order. Addons whose position affects title details are locked until you unlock them.",
      entry: "index.js",
      anchors: ["addons.installed.list"]
    },
    css: styles_default,
    activate
  };

  // src/host/account.ts
  var API_URL = "https://api.strem.io/api/";
  var BACKUPS_KEY = "mystremio:addon-backups";
  var MAX_BACKUPS = 10;
  var PROFILE_KEY = "profile";
  var core;
  var startAccount = (transport) => {
    core = transport;
  };
  var request = async (path, body) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const { result, error } = await response.json();
    if (error || result === void 0) {
      throw new Error(`Stremio account request failed: ${error?.message ?? response.status}`);
    }
    return result;
  };
  var authKey = async () => (await core.getState("ctx")).profile.auth?.key ?? null;
  var listBackups = () => {
    try {
      const backups = JSON.parse(localStorage.getItem(BACKUPS_KEY) ?? "[]");
      return Array.isArray(backups) ? backups : [];
    } catch {
      return [];
    }
  };
  var saveBackup = (addons) => {
    const backups = [{ savedAt: Date.now(), addons }, ...listBackups()].slice(0, MAX_BACKUPS);
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups));
  };
  var readStoredProfile = async () => {
    if (localStorage.getItem(PROFILE_KEY) === null) {
      const { settings } = (await core.getState("ctx")).profile;
      const update = (value) => core.dispatch({ action: "Ctx", args: { action: "UpdateSettings", args: value } });
      await update({ ...settings, bingeWatching: !settings.bingeWatching });
      await update(settings);
    }
    const stored = localStorage.getItem(PROFILE_KEY);
    if (stored === null) {
      throw new Error("The local profile could not be read");
    }
    return JSON.parse(stored);
  };
  var getAddonCollection = async () => {
    const key = await authKey();
    if (key === null) {
      return (await readStoredProfile()).addons;
    }
    const { addons } = await request("addonCollectionGet", {
      type: "AddonCollectionGet",
      authKey: key,
      update: true
    });
    return addons;
  };
  var setAddonCollection = async (addons) => {
    const previous = await getAddonCollection();
    saveBackup(previous);
    const key = await authKey();
    if (key === null) {
      const profile = await readStoredProfile();
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, addons }));
      window.location.reload();
      return;
    }
    await request("addonCollectionSet", { type: "AddonCollectionSet", authKey: key, addons });
    await core.dispatch({ action: "Ctx", args: { action: "PullAddonsFromAPI" } });
  };

  // src/host/anchors.ts
  var ANCHORS = {
    "addons.installed.list": '[class*="addons-container-"] [class*="addons-list-container-"]',
    "addons.toolbar": '[class*="addons-container-"] [class*="selectable-inputs-container-"]',
    "streams.list": '[class*="streams-list-container-"] [class*="streams-container-"]',
    "streams.toolbar": '[class*="streams-list-container-"] [class*="select-choices-wrapper-"]',
    "settings.menu": '[class*="settings-content-"] > [class*="menu-"]',
    "nav.vertical": '[class*="vertical-nav-bar-container-"]'
  };
  var watchers = /* @__PURE__ */ new Set();
  var scheduled = false;
  var scan = () => {
    scheduled = false;
    watchers.forEach((watcher) => {
      const present = new Set(document.querySelectorAll(watcher.selector));
      watcher.active.forEach((dispose, element) => {
        if (!present.has(element)) {
          watcher.active.delete(element);
          dispose?.();
        }
      });
      present.forEach((element) => {
        if (!watcher.active.has(element)) {
          try {
            watcher.active.set(element, watcher.onElement(element));
          } catch (error) {
            console.error("[mystremio] anchor handler failed", error);
          }
        }
      });
    });
  };
  var schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  };
  var startAnchors = () => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  };
  var isKnownAnchor = (name) => Object.prototype.hasOwnProperty.call(ANCHORS, name);
  var watchAnchor = (name, onElement) => {
    const selector = ANCHORS[name];
    if (selector === void 0) {
      throw new Error(`Unknown anchor: ${name}`);
    }
    const watcher = { selector, onElement, active: /* @__PURE__ */ new Map() };
    watchers.add(watcher);
    schedule();
    return () => {
      watchers.delete(watcher);
      watcher.active.forEach((dispose) => dispose?.());
      watcher.active.clear();
    };
  };

  // src/host/backend.ts
  var toBase64 = (bytes) => {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 32768) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    }
    return btoa(binary);
  };
  var fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  var encodeFiles = (files) => Object.fromEntries([...files].map(([path, data]) => [path, toBase64(data)]));
  var DEV_STORAGE_KEY = "mystremio:dev-plugins";
  var createDevBackend = () => {
    const read = () => JSON.parse(localStorage.getItem(DEV_STORAGE_KEY) ?? "[]");
    const write = (plugins2) => localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(plugins2));
    return {
      kind: "dev",
      listPlugins: async () => read(),
      savePlugin: async (plugin) => write([...read().filter(({ id }) => id !== plugin.id), plugin]),
      removePlugin: async (id) => write(read().filter((plugin) => plugin.id !== id)),
      fetchUrl: async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Download failed with status ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      }
    };
  };
  var REQUEST_TIMEOUT = 6e4;
  var createShellBackend = (webview) => {
    const pending = /* @__PURE__ */ new Map();
    let lastRequestId = 0;
    webview.addEventListener("message", ({ data }) => {
      if (typeof data !== "string") return;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      const [name, payload] = Array.isArray(message?.args) ? message.args : [];
      if (name !== "overlay-response") return;
      const request2 = pending.get(payload.requestId);
      if (!request2) return;
      pending.delete(payload.requestId);
      if (typeof payload.error === "string") {
        request2.reject(new Error(payload.error));
      } else {
        request2.resolve(payload.result);
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++lastRequestId;
      pending.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(requestId)) {
          reject(new Error(`The shell did not answer "${method}"`));
        }
      }, REQUEST_TIMEOUT);
      webview.postMessage(JSON.stringify({ id: 1, args: ["overlay-request", { requestId, method, params }] }));
    });
    return {
      kind: "shell",
      listPlugins: () => call("list-plugins"),
      savePlugin: (plugin) => call("save-plugin", plugin),
      removePlugin: (id) => call("remove-plugin", { id }),
      fetchUrl: async (url) => fromBase64(await call("fetch-url", { url }))
    };
  };
  var createBackend = () => {
    const webview = window.chrome?.webview;
    return webview ? createShellBackend(webview) : createDevBackend();
  };

  // src/host/core.ts
  var listeners = {
    state: /* @__PURE__ */ new Set(),
    event: /* @__PURE__ */ new Set()
  };
  var safely = (fn) => {
    try {
      fn();
    } catch (error) {
      console.error("[mystremio] core listener failed", error);
    }
  };
  var notify = (event) => {
    if (event.name === "NewState") {
      listeners.state.forEach((listener) => safely(() => listener(event.args)));
    } else if (event.name === "CoreEvent") {
      listeners.event.forEach((listener) => safely(() => listener(event.args.event, event.args.args)));
    }
  };
  var tapCoreEvents = () => {
    let inner = window.onCoreEvent;
    const tapped = (event) => {
      notify(event);
      return inner?.(event);
    };
    Object.defineProperty(window, "onCoreEvent", {
      configurable: true,
      get: () => inner ? tapped : void 0,
      set: (handler) => {
        inner = handler;
      }
    });
  };
  var waitForCore = () => new Promise((resolve) => {
    const check = () => {
      if (window.core) {
        resolve(window.core);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
  var onCore = (type, listener) => {
    listeners[type].add(listener);
    return () => {
      listeners[type].delete(listener);
    };
  };

  // src/host/types.ts
  var API_VERSION = 0;

  // src/host/package.ts
  var ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
  var SAFE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._\-/]+$/;
  var parseManifest = (raw) => {
    const value = JSON.parse(raw);
    const fail = (reason) => {
      throw new Error(`Invalid plugin.json: ${reason}`);
    };
    if (typeof value !== "object" || value === null) fail("not an object");
    if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) fail("id must be lowercase letters, digits and dashes");
    if (typeof value.name !== "string" || value.name.length === 0) fail("name is required");
    if (typeof value.version !== "string") fail("version is required");
    if (value.apiVersion !== API_VERSION) fail(`apiVersion must be ${API_VERSION}`);
    if (typeof value.entry !== "string" || !SAFE_PATH.test(value.entry)) fail("entry must be a relative file path");
    if (value.styles !== void 0 && (typeof value.styles !== "string" || !SAFE_PATH.test(value.styles))) fail("styles must be a relative file path");
    if (value.anchors !== void 0 && !(Array.isArray(value.anchors) && value.anchors.every((anchor) => typeof anchor === "string"))) fail("anchors must be a list of names");
    return {
      id: value.id,
      name: value.name,
      version: value.version,
      apiVersion: value.apiVersion,
      description: typeof value.description === "string" ? value.description : void 0,
      entry: value.entry,
      styles: value.styles,
      anchors: value.anchors
    };
  };
  var readPluginFiles = (archive) => {
    const manifestPath = [...archive.keys()].filter((path) => path === "plugin.json" || /^[^/]+\/plugin\.json$/.test(path)).sort((a, b) => a.length - b.length)[0];
    if (manifestPath === void 0) {
      throw new Error("The archive has no plugin.json");
    }
    const prefix = manifestPath.slice(0, manifestPath.length - "plugin.json".length);
    const files = /* @__PURE__ */ new Map();
    archive.forEach((data, path) => {
      if (!path.startsWith(prefix)) return;
      const relative = path.slice(prefix.length);
      if (!SAFE_PATH.test(relative)) {
        throw new Error(`Unsafe file path in plugin: ${path}`);
      }
      files.set(relative, data);
    });
    const decoder2 = new TextDecoder();
    const manifest = parseManifest(decoder2.decode(files.get("plugin.json")));
    if (!files.has(manifest.entry)) {
      throw new Error(`The plugin entry file is missing: ${manifest.entry}`);
    }
    if (manifest.styles !== void 0 && !files.has(manifest.styles)) {
      throw new Error(`The plugin styles file is missing: ${manifest.styles}`);
    }
    return { manifest, files };
  };

  // src/host/settings.ts
  var STORAGE_KEY = "mystremio:settings";
  var defaults = () => ({
    version: 1,
    updatedAt: 0,
    sync: { enabled: true },
    plugins: {}
  });
  var parseSettings = (raw) => {
    if (raw === null) return defaults();
    try {
      const value = JSON.parse(raw);
      if (value?.version !== 1 || typeof value.plugins !== "object" || value.plugins === null) {
        return defaults();
      }
      return {
        version: 1,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
        sync: { enabled: value.sync?.enabled !== false },
        plugins: value.plugins
      };
    } catch {
      return defaults();
    }
  };
  var current = defaults();
  var listeners2 = /* @__PURE__ */ new Set();
  var store = (settings) => {
    current = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    listeners2.forEach((listener) => listener(current));
  };
  var loadSettings = () => {
    current = parseSettings(localStorage.getItem(STORAGE_KEY));
    return current;
  };
  var getSettings = () => current;
  var updateSettings = (update) => {
    const next = structuredClone(current);
    update(next);
    next.updatedAt = Date.now();
    store(next);
  };
  var onSettingsChange = (listener) => {
    listeners2.add(listener);
    return () => {
      listeners2.delete(listener);
    };
  };
  var pluginState = (id, bundled) => current.plugins[id] ?? { enabled: bundled, data: {} };

  // src/host/ui.ts
  var STYLES = `
#mystremio-root { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: inherit; color: #fff; }
#mystremio-root > * { pointer-events: auto; }
.mys-toasts { position: absolute; right: 24px; bottom: 24px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.mys-toast { padding: 12px 16px; border-radius: 12px; background: #1f1d36; box-shadow: 0 8px 24px rgba(0,0,0,.5); border-left: 4px solid #7b5bf5; max-width: 360px; }
.mys-toast[data-type="error"] { border-left-color: #e5484d; }
.mys-toast[data-type="success"] { border-left-color: #22b365; }
.mys-backdrop { position: absolute; inset: 0; background: rgba(4,3,16,.7); display: flex; align-items: center; justify-content: center; }
.mys-panel { background: #15132b; border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.6); padding: 24px; max-height: 84vh; overflow: auto; }
.mys-panel h2 { margin: 0 0 4px; font-size: 22px; font-weight: 600; }
.mys-panel h3 { margin: 24px 0 8px; font-size: 15px; font-weight: 600; opacity: .9; }
.mys-muted { opacity: .65; font-size: 13px; line-height: 1.5; }
.mys-row { display: flex; align-items: center; gap: 12px; }
.mys-spacer { flex: 1; }
.mys-button { border: 0; border-radius: 20px; padding: 9px 18px; background: rgba(255,255,255,.08); color: inherit; font: inherit; cursor: pointer; }
.mys-button:hover { background: rgba(255,255,255,.16); }
.mys-button[data-primary] { background: #7b5bf5; }
.mys-button[data-primary]:hover { background: #8f73f7; }
.mys-button[data-danger]:hover { background: #e5484d; }
.mys-input { flex: 1; min-width: 0; border: 0; border-radius: 20px; padding: 9px 16px; background: rgba(255,255,255,.08); color: inherit; font: inherit; outline: none; }
.mys-switch { appearance: none; width: 40px; height: 22px; border-radius: 11px; background: rgba(255,255,255,.18); position: relative; cursor: pointer; flex: none; margin: 0; }
.mys-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .12s; }
.mys-switch:checked { background: #7b5bf5; }
.mys-switch:checked::after { left: 21px; }
.mys-plugin { padding: 14px 0; border-top: 1px solid rgba(255,255,255,.08); }
.mys-plugin-name { font-weight: 600; }
.mys-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: rgba(255,255,255,.1); margin-left: 8px; font-weight: 400; }
.mys-badge[data-kind="error"] { background: #e5484d; }
`;
  var root = null;
  var toasts = null;
  var h = (tag, props = {}, children = []) => {
    const { dataset, ...rest } = props;
    const element = Object.assign(document.createElement(tag), rest);
    Object.assign(element.dataset, dataset);
    element.append(...children);
    return element;
  };
  var startUi = () => {
    document.head.append(h("style", { textContent: STYLES }));
    toasts = h("div", { className: "mys-toasts" });
    root = h("div", { id: "mystremio-root" }, [toasts]);
    document.body.append(root);
  };
  var toast = ({ type = "info", title }) => {
    const element = h("div", { className: "mys-toast", textContent: title, dataset: { type } });
    toasts?.append(element);
    setTimeout(() => element.remove(), 5e3);
  };
  var openPanel = (content, onClose) => {
    const backdrop = h("div", { className: "mys-backdrop" }, [content]);
    const close = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      onClose?.();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", onKeyDown, true);
    root?.append(backdrop);
    return close;
  };
  var confirm = ({ title, message, confirmLabel = "Continue" }) => new Promise((resolve) => {
    let answer = false;
    const cancel = h("button", { className: "mys-button", textContent: "Cancel" });
    const accept = h("button", { className: "mys-button", textContent: confirmLabel, dataset: { primary: "" } });
    const panel = h("div", { className: "mys-panel" }, [
      h("h2", { textContent: title }),
      h("p", { className: "mys-muted", textContent: message }),
      h("div", { className: "mys-row" }, [h("div", { className: "mys-spacer" }), cancel, accept])
    ]);
    panel.style.width = "440px";
    panel.dataset.mysConfirm = "";
    const close = openPanel(panel, () => resolve(answer));
    cancel.addEventListener("click", close);
    accept.addEventListener("click", () => {
      answer = true;
      close();
    });
  });

  // src/host/zip.ts
  var EOCD_SIGNATURE = 101010256;
  var CENTRAL_SIGNATURE = 33639248;
  var inflate = async (data) => {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  var unzip = async (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = bytes.length - 22;
    while (eocd >= 0 && view.getUint32(eocd, true) !== EOCD_SIGNATURE) {
      eocd -= 1;
    }
    if (eocd < 0) {
      throw new Error("Not a zip file");
    }
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder2 = new TextDecoder();
    const files = /* @__PURE__ */ new Map();
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
        throw new Error("Corrupt zip file");
      }
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder2.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      offset += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith("/")) continue;
      const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) {
        files.set(name, data);
      } else if (method === 8) {
        files.set(name, await inflate(data));
      } else {
        throw new Error(`Unsupported zip compression method ${method} for ${name}`);
      }
    }
    return files;
  };

  // src/host/plugins.ts
  var hooks = /* @__PURE__ */ new Map();
  var plugins = /* @__PURE__ */ new Map();
  var listeners3 = /* @__PURE__ */ new Set();
  var decoder = new TextDecoder();
  var core2;
  var backend;
  var changed = () => listeners3.forEach((listener) => listener());
  var runHook = (name, value, context) => {
    let result = value;
    hooks.get(name)?.forEach((hook) => {
      try {
        result = hook(result, context);
      } catch (error) {
        console.error(`[mystremio] hook "${name}" failed`, error);
      }
    });
    return result;
  };
  var createApi = (plugin) => {
    const { id } = plugin.manifest;
    const track = (dispose) => {
      plugin.disposers.push(dispose);
      return dispose;
    };
    return {
      id,
      apiVersion: API_VERSION,
      core: {
        dispatch: (action, model) => core2.dispatch(action, model),
        getState: (model) => core2.getState(model),
        on: (type, listener) => track(onCore(type, listener))
      },
      anchors: {
        watch: (name, onElement) => track(watchAnchor(name, onElement))
      },
      slots: {
        add: (name, { placement = "after", mount }) => track(watchAnchor(name, (anchor) => {
          const container = h("div", { dataset: { mystremioSlot: `${id}:${name}` } });
          const insert = { before: "beforebegin", after: "afterend", prepend: "afterbegin", append: "beforeend" };
          anchor.insertAdjacentElement(insert[placement], container);
          const unmount = mount(container);
          return () => {
            unmount?.();
            container.remove();
          };
        }))
      },
      hooks: {
        add: (name, hook) => {
          const set = hooks.get(name) ?? /* @__PURE__ */ new Set();
          hooks.set(name, set);
          set.add(hook);
          return track(() => {
            set.delete(hook);
          });
        },
        run: runHook
      },
      storage: {
        get: (key, fallback) => {
          const data = pluginState(id, plugin.bundled).data;
          return key in data ? data[key] : fallback;
        },
        set: (key, value) => updateSettings((settings) => {
          const state = settings.plugins[id] ?? pluginState(id, plugin.bundled);
          settings.plugins[id] = { ...state, data: { ...state.data, [key]: value } };
        }),
        onChange: (listener) => {
          let previous = JSON.stringify(pluginState(id, plugin.bundled).data);
          return track(onSettingsChange(() => {
            const next = JSON.stringify(pluginState(id, plugin.bundled).data);
            if (next !== previous) {
              previous = next;
              listener();
            }
          }));
        }
      },
      account: { getAddonCollection, setAddonCollection },
      ui: { toast, confirm }
    };
  };
  var deactivate = (plugin) => {
    plugin.disposers.splice(0).reverse().forEach((dispose) => {
      try {
        dispose();
      } catch (error) {
        console.error(`[mystremio] plugin "${plugin.manifest.id}" failed to clean up`, error);
      }
    });
    document.querySelector(`style[data-mystremio-plugin="${plugin.manifest.id}"]`)?.remove();
    plugin.active = false;
  };
  var activate2 = async (plugin) => {
    const { id, anchors = [] } = plugin.manifest;
    plugin.error = null;
    try {
      const unknown = anchors.filter((anchor) => !isKnownAnchor(anchor));
      if (unknown.length > 0) {
        throw new Error(`Needs anchors this version does not have: ${unknown.join(", ")}`);
      }
      if (plugin.css !== null) {
        const style = h("style", { textContent: plugin.css });
        style.dataset.mystremioPlugin = id;
        document.head.append(style);
      }
      const run = await plugin.load();
      const dispose = await run(createApi(plugin));
      if (typeof dispose === "function") {
        plugin.disposers.push(dispose);
      }
      plugin.active = true;
    } catch (error) {
      deactivate(plugin);
      plugin.error = error instanceof Error ? error.message : String(error);
      console.error(`[mystremio] plugin "${id}" failed to start`, error);
    }
  };
  var importActivate = (code) => async () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try {
      const module = await import(
        /* @vite-ignore */
        url
      );
      if (typeof module.default !== "function") {
        throw new Error("The entry file must export a default function");
      }
      return module.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  var fromStored = ({ files }) => {
    const text = (path) => {
      const data = files[path];
      if (data === void 0) {
        throw new Error(`Missing plugin file: ${path}`);
      }
      return decoder.decode(fromBase64(data));
    };
    const manifest = parseManifest(text("plugin.json"));
    return {
      manifest,
      bundled: false,
      active: false,
      error: null,
      css: manifest.styles !== void 0 ? text(manifest.styles) : null,
      load: importActivate(text(manifest.entry)),
      disposers: []
    };
  };
  var register = async (plugin) => {
    const previous = plugins.get(plugin.manifest.id);
    if (previous) {
      deactivate(previous);
    }
    plugins.set(plugin.manifest.id, plugin);
    if (pluginState(plugin.manifest.id, plugin.bundled).enabled) {
      await activate2(plugin);
    }
  };
  var startPlugins = async (transport, container, bundled) => {
    core2 = transport;
    backend = container;
    for (const { manifest, css, activate: run } of bundled) {
      await register({ manifest, bundled: true, active: false, error: null, css: css ?? null, load: async () => run, disposers: [] });
    }
    for (const stored of await backend.listPlugins()) {
      try {
        const plugin = fromStored(stored);
        if (!plugins.get(plugin.manifest.id)?.bundled) {
          await register(plugin);
        }
      } catch (error) {
        console.error(`[mystremio] cannot load installed plugin "${stored.id}"`, error);
      }
    }
    changed();
  };
  var listPlugins = () => [...plugins.values()].map(({ manifest, bundled, active, error }) => ({ manifest, bundled, active, error }));
  var onPluginsChange = (listener) => {
    listeners3.add(listener);
    return () => {
      listeners3.delete(listener);
    };
  };
  var setPluginEnabled = async (id, enabled) => {
    const plugin = plugins.get(id);
    if (!plugin) return;
    updateSettings((settings) => {
      settings.plugins[id] = { ...pluginState(id, plugin.bundled), enabled };
    });
    if (enabled && !plugin.active) {
      await activate2(plugin);
    } else if (!enabled) {
      deactivate(plugin);
    }
    changed();
  };
  var installPlugin = async (archive) => {
    const { manifest, files } = readPluginFiles(await unzip(archive));
    if (plugins.get(manifest.id)?.bundled) {
      throw new Error(`"${manifest.name}" is built in and cannot be replaced`);
    }
    const stored = { id: manifest.id, files: encodeFiles(files) };
    await backend.savePlugin(stored);
    updateSettings((settings) => {
      settings.plugins[manifest.id] = { ...pluginState(manifest.id, false), enabled: true };
    });
    await register(fromStored(stored));
    changed();
    return manifest;
  };
  var installPluginFromUrl = async (url) => installPlugin(await backend.fetchUrl(url));
  var removePlugin = async (id) => {
    const plugin = plugins.get(id);
    if (!plugin || plugin.bundled) return;
    deactivate(plugin);
    plugins.delete(id);
    await backend.removePlugin(id);
    if (id in getSettings().plugins) {
      updateSettings((settings) => {
        delete settings.plugins[id];
      });
    }
    changed();
  };

  // src/host/pluginsPage.ts
  var INSTALL_WARNING = "A plugin runs inside the app with full access, including your account and the keys stored in your addon URLs. Install only plugins you trust.";
  var report = async (action) => {
    try {
      toast({ type: "success", title: await action() });
    } catch (error) {
      toast({ type: "error", title: error instanceof Error ? error.message : String(error) });
    }
  };
  var confirmInstall = () => confirm({ title: "Install plugin?", message: INSTALL_WARNING, confirmLabel: "Install" });
  var renderList = (list) => {
    const entries = listPlugins();
    list.replaceChildren(...entries.map(({ manifest, bundled, active, error }) => {
      const toggle = h("input", { type: "checkbox", className: "mys-switch", checked: active, title: "Enabled" });
      toggle.addEventListener("change", () => setPluginEnabled(manifest.id, toggle.checked));
      const remove = h("button", { className: "mys-button", textContent: "Remove", dataset: { danger: "" } });
      remove.addEventListener("click", async () => {
        if (await confirm({ title: `Remove ${manifest.name}?`, message: "The plugin and its files are deleted from this device.", confirmLabel: "Remove" })) {
          await report(async () => {
            await removePlugin(manifest.id);
            return `${manifest.name} removed`;
          });
        }
      });
      return h("div", { className: "mys-plugin mys-row", dataset: { plugin: manifest.id } }, [
        h("div", {}, [
          h("div", { className: "mys-plugin-name" }, [
            manifest.name,
            h("span", { className: "mys-badge", textContent: `v${manifest.version}` }),
            ...bundled ? [h("span", { className: "mys-badge", textContent: "Built in" })] : [],
            ...error !== null ? [h("span", { className: "mys-badge", textContent: "Failed", title: error, dataset: { kind: "error" } })] : []
          ]),
          h("div", { className: "mys-muted", textContent: error ?? manifest.description ?? "" })
        ]),
        h("div", { className: "mys-spacer" }),
        ...bundled ? [] : [remove],
        toggle
      ]);
    }));
    if (entries.length === 0) {
      list.append(h("div", { className: "mys-plugin mys-muted", textContent: "No plugins installed." }));
    }
  };
  var openPluginsPage = () => {
    const list = h("div", { dataset: { mysPluginList: "" } });
    const url = h("input", { className: "mys-input", placeholder: "https://example.com/plugin.zip", type: "url" });
    const installUrl = h("button", { className: "mys-button", textContent: "Install", dataset: { primary: "" } });
    const file = h("input", { type: "file", accept: ".zip", hidden: true });
    const chooseFile = h("button", { className: "mys-button", textContent: "Choose .zip file" });
    installUrl.addEventListener("click", async () => {
      const value = url.value.trim();
      if (value.length === 0 || !await confirmInstall()) return;
      await report(async () => {
        const manifest = await installPluginFromUrl(value);
        url.value = "";
        return `${manifest.name} installed`;
      });
    });
    chooseFile.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const selected = file.files?.[0];
      file.value = "";
      if (!selected || !await confirmInstall()) return;
      await report(async () => {
        const manifest = await installPlugin(new Uint8Array(await selected.arrayBuffer()));
        return `${manifest.name} installed`;
      });
    });
    const panel = h("div", { className: "mys-panel", dataset: { mysPluginsPage: "" } }, [
      h("h2", { textContent: "Plugins" }),
      h("div", { className: "mys-muted", textContent: "Plugins change how the app looks and behaves." }),
      h("h3", { textContent: "Installed" }),
      list,
      h("h3", { textContent: "Install a plugin" }),
      h("div", { className: "mys-row" }, [url, installUrl, chooseFile, file]),
      h("p", { className: "mys-muted", textContent: INSTALL_WARNING })
    ]);
    panel.style.width = "640px";
    renderList(list);
    const stop = onPluginsChange(() => renderList(list));
    openPanel(panel, stop);
  };
  var startPluginsPage = () => {
    watchAnchor("settings.menu", (menu) => {
      const sibling = menu.querySelector("[data-section]");
      if (!sibling) return;
      const button = h("div", { textContent: "Plugins", title: "Plugins", tabIndex: 0 });
      button.className = [...sibling.classList].filter((name) => !name.startsWith("selected-")).join(" ");
      button.dataset.mysPluginsButton = "";
      button.addEventListener("click", openPluginsPage);
      const lastSection = [...menu.querySelectorAll("[data-section]")].pop();
      lastSection.insertAdjacentElement("afterend", button);
      return () => button.remove();
    });
  };

  // src/host/index.ts
  var BUNDLED = [addonReorder];
  var whenBodyExists = () => new Promise((resolve) => {
    if (document.body) {
      resolve();
    } else {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    }
  });
  var start = async (backend2) => {
    const core3 = await waitForCore();
    await whenBodyExists();
    loadSettings();
    startAccount(core3);
    startUi();
    startAnchors();
    startPluginsPage();
    await startPlugins(core3, backend2, BUNDLED);
  };
  if (window.self === window.top && !window.__mystremio) {
    tapCoreEvents();
    const backend2 = createBackend();
    window.__mystremio = { version: "0.1.0", backend: backend2.kind, ready: start(backend2) };
    window.__mystremio.ready.catch((error) => console.error("[mystremio] host failed to start", error));
  }
})();

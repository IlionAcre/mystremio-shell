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
  var lockedAddons = (addons) => {
    const rivals = metadataRivals(addons);
    addons.forEach((addon) => {
      if (addon.flags?.protected !== true) {
        rivals.delete(addon.transportUrl);
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
    return `${name} and ${listNames(rivals.map((rival) => rival.name))} can ${rivals.length > 1 ? "all" : "both"} describe the same titles (${listNames(types)}). Stremio uses whichever is higher in the list, so moving this addon can change titles, posters and episode lists.`;
  };

  // plugins/addon-reorder/styles.css
  var styles_default = `[data-mys-reorder] { position: relative; }
[data-mys-reorder][data-mys-movable="true"] { cursor: grab; }

/* While a card is dragged, the others slide out of its way. */
[data-mys-reorder-active] > [data-mys-reorder] { transition: transform .18s ease; }
[data-mys-reorder-active], [data-mys-reorder-active] * { cursor: grabbing !important; user-select: none; }
[data-mys-reorder-active] > [data-mys-dragging],
[data-mys-reorder-active] > [data-mys-dropping] {
    z-index: 5;
    /* The app's cards are translucent; a floating card must hide what is under it. */
    background-color: #1f1d3a;
    box-shadow: 0 18px 40px rgba(0, 0, 0, .55), 0 0 0 2px #7b5bf5;
}
[data-mys-reorder-active] > [data-mys-dragging] { transition: none; }
[data-mys-reorder-settling] > [data-mys-reorder] { transition: none !important; }

.mys-reorder-handle {
    position: absolute;
    top: 50%;
    left: 2px;
    transform: translateY(-50%);
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    opacity: .6;
}
.mys-reorder-handle svg { width: 18px; height: 18px; fill: currentColor; }
.mys-reorder-handle[data-state="locked"],
.mys-reorder-handle[data-state="unlocked"] { cursor: pointer; opacity: .8; }
.mys-reorder-handle[data-state="locked"] { color: #f5b942; }
.mys-reorder-handle:hover { opacity: 1; background: rgba(255, 255, 255, .1); }
`;

  // plugins/addon-reorder/index.ts
  var ICONS = {
    grip: '<svg viewBox="0 0 24 24"><path d="M9 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9-14a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>',
    locked: '<svg viewBox="0 0 24 24"><path d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z"/></svg>',
    unlocked: '<svg viewBox="0 0 24 24"><path d="M17 9H9V7a3 3 0 0 1 5.8-1.1l1.9-.7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Z"/></svg>'
  };
  var DRAG_THRESHOLD = 6;
  var SETTLE_DURATION = 180;
  var RENDER_TIMEOUT = 4e3;
  var SCROLL_EDGE = 70;
  var SCROLL_SPEED = 14;
  var scrollParent = (element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
        return parent;
      }
    }
    return document.documentElement;
  };
  var activate = (api) => {
    let addons = [];
    let rivals = /* @__PURE__ */ new Map();
    let busy = false;
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
    const save = async (from, to) => {
      const current2 = addons.map((addon) => addon.transportUrl);
      const next = move(current2, from, to > from ? to + 1 : to);
      if (isSameOrder(current2, next)) return null;
      try {
        const collection = await api.account.getAddonCollection();
        if (!isPermutation(current2, collection.map((addon) => addon.transportUrl))) {
          throw new Error("Your addon list changed in the meantime. Try again.");
        }
        await api.account.setAddonCollection(next.map((url) => collection.find((addon) => addon.transportUrl === url)));
        api.ui.toast({ type: "success", title: "Addon order saved" });
        return next;
      } catch (error) {
        api.ui.toast({ type: "error", title: error instanceof Error ? error.message : String(error) });
        return null;
      }
    };
    api.anchors.watch("addons.installed.list", (list) => {
      let disposed = false;
      const cards = () => [...list.children].filter((child) => child instanceof HTMLElement);
      const refresh = async () => {
        const [ctx, installed] = await Promise.all([api.core.getState("ctx"), api.core.getState("installed_addons")]);
        if (disposed) return;
        addons = ctx.profile.addons;
        rivals = lockedAddons(addons);
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
      const rendered = (order) => new Promise((resolve) => {
        const matches = () => isSameOrder(addons.map((addon) => addon.transportUrl), order);
        const check = async () => {
          await refresh();
          if (matches()) {
            requestAnimationFrame(() => requestAnimationFrame(finish));
          }
        };
        const stop = api.core.on("state", (models) => {
          if (models.includes("ctx")) check();
        });
        const timeout = setTimeout(finish, RENDER_TIMEOUT);
        function finish() {
          stop();
          clearTimeout(timeout);
          resolve();
        }
        check();
      });
      const onPointerDown = (down) => {
        const target = down.target;
        const card = target.closest("[data-mys-reorder]");
        const inner = target.closest("[tabindex], a, button, .mys-reorder-handle");
        if (busy || down.button !== 0 || !card || card.dataset.mysMovable !== "true" || inner !== null && inner !== card) return;
        const all = cards();
        const from = all.indexOf(card);
        const scroller = scrollParent(list);
        let rects = [];
        let step = 0;
        let startScroll = 0;
        let to = from;
        let pointerY = down.clientY;
        let scrolling = 0;
        let dragging = false;
        const shiftOf = (index) => {
          if (index < from && index >= to) return step;
          if (index > from && index <= to) return -step;
          return 0;
        };
        const draw = () => {
          const offset = pointerY - down.clientY + scroller.scrollTop - startScroll;
          const center = rects[from].top + rects[from].height / 2 + offset;
          to = rects.filter((rect, index) => index !== from && rect.top + rect.height / 2 < center).length;
          card.style.transform = `translateY(${offset}px)`;
          all.forEach((other, index) => {
            if (other !== card) {
              other.style.transform = `translateY(${shiftOf(index)}px)`;
            }
          });
        };
        const autoScroll = () => {
          const { top, bottom } = scroller === document.documentElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
          const speed = pointerY < top + SCROLL_EDGE ? -SCROLL_SPEED : pointerY > bottom - SCROLL_EDGE ? SCROLL_SPEED : 0;
          if (speed !== 0) {
            scroller.scrollTop += speed;
            draw();
          }
          scrolling = requestAnimationFrame(autoScroll);
        };
        const begin = () => {
          dragging = true;
          rects = all.map((other) => other.getBoundingClientRect());
          const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
          step = rects[from].height + gap;
          startScroll = scroller.scrollTop;
          card.dataset.mysDragging = "";
          list.dataset.mysReorderActive = "";
          scrolling = requestAnimationFrame(autoScroll);
        };
        const clear = () => {
          list.dataset.mysReorderSettling = "";
          all.forEach((other) => {
            other.style.transform = "";
          });
          delete card.dataset.mysDragging;
          delete card.dataset.mysDropping;
          delete list.dataset.mysReorderActive;
          requestAnimationFrame(() => delete list.dataset.mysReorderSettling);
        };
        const onMove = (event) => {
          pointerY = event.clientY;
          if (!dragging) {
            if (Math.abs(event.clientY - down.clientY) < DRAG_THRESHOLD) return;
            begin();
          }
          draw();
        };
        const stop = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onCancel);
          cancelAnimationFrame(scrolling);
        };
        const onCancel = () => {
          stop();
          if (dragging) clear();
        };
        const onUp = async () => {
          stop();
          if (!dragging) return;
          const swallow = (click) => click.stopPropagation();
          document.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => document.removeEventListener("click", swallow, true));
          busy = true;
          const slot = to === from ? 0 : to > from ? rects[to].bottom - rects[from].bottom : rects[to].top - rects[from].top;
          delete card.dataset.mysDragging;
          card.dataset.mysDropping = "";
          card.style.transform = `translateY(${slot}px)`;
          await new Promise((resolve) => setTimeout(resolve, SETTLE_DURATION));
          const order = await save(from, to);
          if (order !== null) {
            await rendered(order);
          }
          clear();
          busy = false;
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
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
        delete list.dataset.mysReorderList;
        cards().forEach((card) => {
          card.querySelector(":scope > .mys-reorder-handle")?.remove();
          card.style.transform = "";
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
      version: "1.2.0",
      apiVersion: 0,
      description: "Drag installed addons to change their order. Built-in Stremio addons are locked while another addon can replace their title details.",
      entry: "index.js",
      anchors: ["addons.installed.list"]
    },
    css: styles_default,
    activate
  };

  // plugins/streams/languages.ts
  var language = (code, name, flags, labels, tags) => ({ code, name, flags, labels, tags });
  var LANGUAGES = [
    language("en", "English", ["\u{1F1EC}\u{1F1E7}", "\u{1F1FA}\u{1F1F8}"], ["english"], /\b(eng|english)\b/i),
    language("es-419", "Spanish (Latino)", ["\u{1F1F2}\u{1F1FD}"], ["latino"], /\b(lat|latino|latam|dual-lat)\b|español latino/i),
    language("es-ES", "Spanish (Spain)", ["\u{1F1EA}\u{1F1F8}"], ["castilian"], /\b(cast|castellano)\b|\besp\b(?![.\s-]*lat)/i),
    language("es", "Spanish (any)", [], ["spanish"], /\b(spa|spanish)\b|español/i),
    language("ja", "Japanese", ["\u{1F1EF}\u{1F1F5}"], ["japanese"], /\b(jap|jpn|japanese)\b/i),
    language("ko", "Korean", ["\u{1F1F0}\u{1F1F7}"], ["korean"], /\b(kor|korean)\b/i),
    language("zh", "Chinese", ["\u{1F1E8}\u{1F1F3}", "\u{1F1F9}\u{1F1FC}"], ["chinese", "taiwanese"], /\b(chi|chinese|mandarin|cantonese)\b|[一-鿿]{2}/i),
    language("fr", "French", ["\u{1F1EB}\u{1F1F7}"], ["french"], /\b(fre|french|truefrench|vff|vf2?|vostfr)\b/i),
    language("de", "German", ["\u{1F1E9}\u{1F1EA}"], ["german"], /\b(ger|german|deutsch)\b/i),
    language("it", "Italian", ["\u{1F1EE}\u{1F1F9}"], ["italian"], /\b(ita|italian)\b/i),
    language("pt", "Portuguese", ["\u{1F1F5}\u{1F1F9}", "\u{1F1E7}\u{1F1F7}"], ["portuguese"], /\b(portuguese|dublado|pt-br)\b/i),
    language("ru", "Russian", ["\u{1F1F7}\u{1F1FA}"], ["russian"], /\b(rus|russian)\b|[Ѐ-ӿ]{3}/i),
    language("uk", "Ukrainian", ["\u{1F1FA}\u{1F1E6}"], ["ukrainian"], /\b(ukr|ukrainian)\b/i),
    language("hi", "Hindi", ["\u{1F1EE}\u{1F1F3}"], ["hindi", "tamil", "telugu"], /\b(hin|hindi|tamil|telugu)\b/i),
    language("pl", "Polish", ["\u{1F1F5}\u{1F1F1}"], ["polish"], /\b(pol|polish|lektor)\b/i),
    language("nl", "Dutch", ["\u{1F1F3}\u{1F1F1}"], ["dutch"], /\b(dutch)\b/i),
    language("tr", "Turkish", ["\u{1F1F9}\u{1F1F7}"], ["turkish"], /\b(tur|turkish)\b/i),
    language("ar", "Arabic", ["\u{1F1F8}\u{1F1E6}"], ["arabic"], /\b(ara|arabic)\b/i),
    language("he", "Hebrew", ["\u{1F1EE}\u{1F1F1}"], ["hebrew"], /\b(heb|hebrew)\b/i),
    language("cs", "Czech", ["\u{1F1E8}\u{1F1FF}"], ["czech"], /\b(cze|czech)\b/i)
  ];
  var ORIGINAL = "original";
  var languageName = (code) => code === ORIGINAL ? "Original language" : LANGUAGES.find((entry) => entry.code === code)?.name ?? code;
  var accepts = (wanted, actual) => actual === wanted || actual.startsWith(`${wanted}-`);
  var COUNTRY_LANGUAGES = {
    "japan": "ja",
    "south korea": "ko",
    "china": "zh",
    "hong kong": "zh",
    "taiwan": "zh",
    "france": "fr",
    "germany": "de",
    "italy": "it",
    "spain": "es-ES",
    "mexico": "es-419",
    "argentina": "es-419",
    "colombia": "es-419",
    "chile": "es-419",
    "brazil": "pt",
    "portugal": "pt",
    "russia": "ru",
    "india": "hi",
    "turkey": "tr",
    "poland": "pl",
    "netherlands": "nl"
  };
  var languageOfCountry = (countries) => {
    const first = countries?.split(",")[0]?.trim().toLowerCase() ?? "";
    return COUNTRY_LANGUAGES[first] ?? "en";
  };

  // plugins/streams/detect.ts
  var QUALITIES = ["4k", "1080p", "720p", "other"];
  var QUALITY_LABELS = { "4k": "4K", "1080p": "1080p", "720p": "720p", "other": "Other" };
  var UNITS = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  var quality = (text) => {
    if (/\b(2160p|4k|uhd)\b/i.test(text)) return "4k";
    if (/\b1080[pi]\b/i.test(text)) return "1080p";
    if (/\b720p\b/i.test(text)) return "720p";
    return "other";
  };
  var size = (stream, description) => {
    const hinted = stream.behaviorHints?.videoSize;
    if (typeof hinted === "number" && hinted > 0) return hinted;
    const match = /💾\s*([\d.]+)\s*(kb|mb|gb|tb)/i.exec(description);
    return match ? Math.round(Number(match[1]) * UNITS[match[2].toLowerCase()]) : null;
  };
  var labelled = (description) => {
    const spoken = /🗣️?\s*([^\n]*)/u.exec(description)?.[1]?.toLowerCase().split(",").map((part) => part.trim()) ?? [];
    return LANGUAGES.filter(({ flags, labels }) => flags.some((flag) => description.includes(flag)) || labels.some((label) => spoken.includes(label))).map(({ code }) => code);
  };
  var tagged = (description, filename) => {
    const text = [...description.split("\n").filter((line) => !/[👤💾⚙️🗣📂📺🔊📅]/u.test(line)), filename].join("\n");
    return LANGUAGES.filter(({ tags }) => tags?.test(text)).map(({ code }) => code);
  };
  var MULTI_AUDIO = /\bdual\b|\bmulti\b(?![ ._-]*sub)/i;
  var SUBTITLES = /multi(ple)?[ ._-]*sub|\bsub(s|bed|titulad[oa]s?|titled?)?[ ._-]+(en[ ._-]+)?(espa[nñ]ol|esp|spa|lat|eng|ita|fre)|\bvose?\b|\bvostfr\b/i;
  var DUBBED = /\b(dub|dubbed|doblad[oa]|dual|audio)\b|\bmulti\b(?![ ._-]*sub)/i;
  var describeStream = (stream) => {
    const name = stream.name ?? "";
    const description = stream.description ?? "";
    const filename = stream.behaviorHints?.filename ?? "";
    const everything = `${name}
${description}
${filename}`;
    const stated = [.../* @__PURE__ */ new Set([...labelled(description), ...tagged(description, filename)])];
    return {
      stated,
      multi: MULTI_AUDIO.test(everything),
      subtitledOnly: SUBTITLES.test(everything) && !DUBBED.test(everything),
      quality: quality(name) !== "other" ? quality(name) : quality(`${description}
${filename}`),
      sizeBytes: size(stream, description),
      seeders: Number(/👤\s*(\d+)/u.exec(description)?.[1] ?? NaN) || null,
      title: description.split("\n")[0]?.trim() || filename || name.replace(/\n/g, " ")
    };
  };
  var audioLanguages = (info, original) => {
    if (info.stated.length === 0 || info.subtitledOnly) return [original];
    return info.multi && !info.stated.includes(original) ? [...info.stated, original] : info.stated;
  };

  // plugins/streams/rules.ts
  var DEFAULT_RULES = [
    { audio: "es-419", subtitles: null },
    { audio: "es", subtitles: null },
    { audio: "en", subtitles: "es" }
  ];
  var ruleLabel = ({ audio, subtitles }) => subtitles === null ? languageName(audio) : `${languageName(audio)} + ${languageName(subtitles)} subtitles`;
  var rank = (languages, rules, original) => rules.findIndex(({ audio }) => languages.some((language2) => accepts(audio === ORIGINAL ? original : audio, language2)));
  var sections = (candidates) => QUALITIES.map((quality2) => ({
    quality: quality2,
    streams: candidates.filter(({ candidate }) => candidate.quality === quality2).sort((a, b) => a.rank - b.rank).map(({ candidate }) => candidate.stream)
  })).filter(({ streams: streams2 }) => streams2.length > 0);
  var selectStreams = (candidates, rules, original, order) => {
    const ranked = candidates.map((candidate) => ({ candidate, rank: rank(candidate.languages, rules, original) }));
    const matching = ranked.filter((entry) => entry.rank !== -1);
    if (matching.length === 0) {
      return { rule: null, shown: sections(ranked), others: [] };
    }
    const best = Math.min(...matching.map((entry) => entry.rank));
    const isShown = (entry) => order === "language-first" ? entry.rank === best : entry.rank !== -1;
    return {
      rule: best,
      shown: sections(ranked.filter(isShown)),
      others: sections(ranked.filter((entry) => !isShown(entry)).map((entry) => ({ ...entry, rank: entry.rank === -1 ? rules.length : entry.rank })))
    };
  };

  // plugins/streams/editor.ts
  var el = (tag, className = "", text = "") => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  var languageSelect = (value, withNone, onChange) => {
    const select = el("select", "mys-input mys-streams-select");
    const options = [
      ...withNone ? [["", "No subtitles"]] : [],
      [ORIGINAL, languageName(ORIGINAL)],
      ...LANGUAGES.map(({ code, name }) => [code, name])
    ];
    options.forEach(([code, name]) => select.append(new Option(name, code, false, code === (value ?? ""))));
    select.addEventListener("change", () => onChange(select.value === "" ? null : select.value));
    return select;
  };
  var rulesEditor = (initial, onChange) => {
    let rules = initial.map((rule) => ({ ...rule }));
    const list = el("div", "mys-streams-rules");
    const commit = (next) => {
      rules = next;
      onChange(rules.map((rule) => ({ ...rule })));
      render2();
    };
    const move2 = (index, offset) => {
      const next = [...rules];
      const [rule] = next.splice(index, 1);
      next.splice(index + offset, 0, rule);
      commit(next);
    };
    const render2 = () => {
      list.replaceChildren(...rules.map((rule, index) => {
        const row2 = el("div", "mys-row mys-streams-rule");
        row2.dataset.rule = String(index);
        const up = el("button", "mys-button mys-streams-icon", "\u2191");
        const down = el("button", "mys-button mys-streams-icon", "\u2193");
        const remove = el("button", "mys-button mys-streams-icon", "\u2715");
        up.title = "Move up";
        down.title = "Move down";
        remove.title = "Remove";
        up.disabled = index === 0;
        down.disabled = index === rules.length - 1;
        remove.disabled = rules.length === 1;
        up.addEventListener("click", () => move2(index, -1));
        down.addEventListener("click", () => move2(index, 1));
        remove.addEventListener("click", () => commit(rules.filter((_, other) => other !== index)));
        row2.append(
          el("span", "mys-streams-rank", `${index + 1}.`),
          el("span", "mys-muted", "Audio"),
          languageSelect(rule.audio, false, (audio) => commit(rules.map((other, at) => at === index ? { ...other, audio } : other))),
          el("span", "mys-muted", "Subtitles"),
          languageSelect(rule.subtitles, true, (subtitles) => commit(rules.map((other, at) => at === index ? { ...other, subtitles } : other))),
          up,
          down,
          remove
        );
        return row2;
      }));
      const add = el("button", "mys-button", "Add a language");
      add.dataset.mysAddRule = "";
      add.addEventListener("click", () => commit([...rules, { audio: "en", subtitles: null }]));
      list.append(add);
    };
    render2();
    return list;
  };
  var languagePanel = (options) => {
    const panel = el("div", "mys-panel");
    panel.style.width = "680px";
    panel.dataset.mysStreamsPanel = "";
    panel.append(el("h2", "", "Stream languages"));
    panel.append(el("div", "mys-muted", "Streams are chosen by the first line that has results. Releases that do not state a language count as the original language of the title."));
    if (options.titleName !== null) {
      const section = el("div");
      section.dataset.mysTitleRules = "";
      const render2 = (rules) => {
        section.replaceChildren(el("h3", "", `For ${options.titleName}`));
        if (rules === null) {
          const customise = el("button", "mys-button", "Set languages for this title");
          customise.addEventListener("click", () => {
            options.onTitleRules(options.defaultRules);
            render2(options.defaultRules);
          });
          section.append(el("div", "mys-muted", `Uses the default: ${options.defaultRules.map(ruleLabel).join(", then ")}.`), customise);
          return;
        }
        const reset = el("button", "mys-button", "Use the default instead");
        reset.addEventListener("click", () => {
          options.onTitleRules(null);
          render2(null);
        });
        section.append(rulesEditor(rules, options.onTitleRules), reset);
      };
      render2(options.titleRules);
      panel.append(section);
    }
    const defaults2 = el("div");
    defaults2.dataset.mysDefaultRules = "";
    defaults2.append(el("h3", "", "Default for all titles"), rulesEditor(options.defaultRules, options.onDefaultRules));
    panel.append(defaults2);
    const order = el("label", "mys-row");
    const quality2 = el("input", "mys-switch");
    quality2.type = "checkbox";
    quality2.checked = options.defaultOrder === "quality-first";
    quality2.addEventListener("change", () => options.onDefaultOrder(quality2.checked ? "quality-first" : "language-first"));
    order.append(quality2, el("span", "", "Put quality before language by default"));
    panel.append(el("h3", "", "Order"), order, el("div", "mys-muted", "Off: only your best available language is shown, best quality first. On: every language in your list is shown, grouped by quality."));
    return panel;
  };

  // plugins/streams/styles.css
  var styles_default2 = `[data-mys-streams-native] { display: none !important; }
/* The app's addon filter is replaced by the one in our toolbar. */
[data-mys-streams-toolbar] [class*="select-input-container-"] { display: none !important; }

.mys-streams {
    flex: 1;
    align-self: stretch;
    min-height: 0;
    overflow-y: auto;
    padding: 0 16px 16px;
    color: #fff;
}
.mys-streams-toolbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 0 10px; }
.mys-streams-status { font-size: 13px; opacity: .8; padding-bottom: 8px; }
.mys-streams-select { flex: 0 1 auto; appearance: auto; }
.mys-streams-select option { color: #000; }

.mys-streams-heading {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 10px 4px 6px;
    font-weight: 600;
    background: #14122b;
}
.mys-streams-divider {
    margin-top: 18px;
    padding: 12px 4px 0;
    border-top: 1px solid rgba(255, 255, 255, .15);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: .06em;
    opacity: .7;
}
.mys-streams-more { display: block; margin: 16px auto 0; }

.mys-stream {
    display: flex;
    gap: 14px;
    padding: 12px;
    margin-bottom: 6px;
    border-radius: 12px;
    background: rgba(255, 255, 255, .05);
    color: inherit;
    text-decoration: none;
    cursor: pointer;
}
.mys-stream:hover, .mys-stream:focus { background: rgba(255, 255, 255, .12); outline: none; }
.mys-stream-label { flex: 0 0 96px; white-space: pre-line; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.mys-stream-body { flex: 1; min-width: 0; }
.mys-stream-title { font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.mys-stream-facts { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 6px; font-size: 12px; opacity: .85; }
.mys-stream-language { padding: 1px 8px; border-radius: 9px; background: rgba(123, 91, 245, .45); }

.mys-streams-rules { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.mys-streams-rule { gap: 8px; }
.mys-streams-rank { width: 18px; opacity: .7; }
.mys-streams-icon { padding: 6px 11px; }
.mys-streams-icon:disabled { opacity: .3; cursor: default; }
`;

  // plugins/streams/view.ts
  var el2 = (tag, className = "", text = "") => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  var formatSize = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
  var hrefOf = ({ deepLinks }) => deepLinks?.player ?? deepLinks?.externalPlayer?.web ?? deepLinks?.externalPlayer?.streaming ?? deepLinks?.externalPlayer?.download ?? null;
  var row = ({ stream, addon, info, languages }) => {
    const href = hrefOf(stream);
    const element = el2("a", "mys-stream");
    if (href !== null) {
      element.href = href;
      if (!href.startsWith("#")) element.target = "_blank";
    }
    const label = el2("div", "mys-stream-label", stream.name ?? addon);
    const body = el2("div", "mys-stream-body");
    const facts = el2("div", "mys-stream-facts");
    languages.forEach((code) => facts.append(el2("span", "mys-stream-language", languageName(code))));
    if (info.stated.length === 0) facts.lastElementChild?.setAttribute("title", "Assumed: the release does not state a language");
    if (info.sizeBytes !== null) facts.append(el2("span", "", formatSize(info.sizeBytes)));
    if (info.seeders !== null) facts.append(el2("span", "", `${info.seeders} seeders`));
    facts.append(el2("span", "mys-muted", addon));
    body.append(el2("div", "mys-stream-title", info.title), facts);
    element.append(label, body);
    return element;
  };
  var sections2 = (parts) => parts.flatMap(({ quality: quality2, streams: streams2 }) => {
    const heading = el2("div", "mys-streams-heading", `${QUALITY_LABELS[quality2]} `);
    heading.append(el2("span", "mys-muted", String(streams2.length)));
    heading.dataset.quality = quality2;
    return [heading, ...streams2.map(row)];
  });
  var count = (parts) => parts.reduce((total, { streams: streams2 }) => total + streams2.length, 0);
  var summary = ({ rules, selection, order, loading }) => {
    if (selection.rule === null) {
      return loading > 0 ? "Looking for streams\u2026" : "None of your languages were found. Showing everything.";
    }
    if (order === "quality-first") {
      return `Showing ${rules.map(ruleLabel).join(", ")}`;
    }
    const shown = `Showing ${ruleLabel(rules[selection.rule])}`;
    return selection.rule === 0 || loading > 0 ? shown : `${shown}. No ${ruleLabel(rules[0])} found.`;
  };
  var render = (container, model, actions) => {
    const toolbar = el2("div", "mys-streams-toolbar");
    const languages = el2("button", "mys-button", model.usesTitleRules ? "Languages (this title)" : "Languages");
    languages.dataset.mysLanguages = "";
    languages.addEventListener("click", actions.onEditLanguages);
    const order = el2("button", "mys-button", model.order === "language-first" ? "Language first" : "Quality first");
    order.dataset.mysOrder = model.order;
    order.title = "Switch between best language first and best quality first";
    order.addEventListener("click", actions.onToggleOrder);
    toolbar.append(languages, order);
    if (model.addons.length > 1) {
      const addon = el2("select", "mys-input mys-streams-select");
      addon.append(new Option("All addons", "", false, model.addon === null));
      model.addons.forEach((name) => addon.append(new Option(name, name, false, model.addon === name)));
      addon.addEventListener("change", () => actions.onAddon(addon.value === "" ? null : addon.value));
      toolbar.append(addon);
    }
    const status = el2("div", "mys-streams-status", summary(model));
    status.dataset.mysStreamsStatus = "";
    if (model.loading > 0) {
      status.append(el2("span", "mys-muted", `  ${model.loading} addon${model.loading === 1 ? "" : "s"} still loading`));
    }
    const list = el2("div", "mys-streams-list");
    list.append(...sections2(model.selection.shown));
    const hidden = count(model.selection.others);
    if (hidden > 0 && !model.showOthers) {
      const more = el2("button", "mys-button mys-streams-more", `Show other languages (${hidden})`);
      more.dataset.mysShowOthers = "";
      more.addEventListener("click", actions.onShowOthers);
      list.append(more);
    } else if (hidden > 0) {
      const divider = el2("div", "mys-streams-divider", "Other languages");
      divider.dataset.mysOthers = "";
      list.append(divider, ...sections2(model.selection.others));
    }
    container.replaceChildren(toolbar, status, list);
  };

  // plugins/streams/index.ts
  var CINEMETA = "https://v3-cinemeta.strem.io/meta";
  var activate2 = (api) => {
    const originals = /* @__PURE__ */ new Map();
    const toasted = /* @__PURE__ */ new Set();
    const originalLanguage = (type, id) => {
      const known = originals.get(id);
      if (known) return known;
      const lookup = (id.startsWith("tt") ? fetch(`${CINEMETA}/${type}/${id}.json`) : Promise.reject(new Error("unknown id"))).then((response) => response.json()).then(({ meta }) => languageOfCountry(meta?.country)).catch(() => "en");
      originals.set(id, lookup);
      return lookup;
    };
    const defaultRules = () => api.storage.get("rules", DEFAULT_RULES);
    const titleRules = (id) => api.storage.get("titleRules", {})[id] ?? null;
    const defaultOrder = () => api.storage.get("order", "language-first");
    const setTitleRules = (id, rules) => {
      const all = { ...api.storage.get("titleRules", {}) };
      if (rules === null) {
        delete all[id];
      } else {
        all[id] = rules;
      }
      api.storage.set("titleRules", all);
    };
    const openLanguages = (title) => {
      api.ui.panel(languagePanel({
        titleName: title?.name ?? null,
        titleRules: title ? titleRules(title.id) : null,
        defaultRules: defaultRules(),
        defaultOrder: defaultOrder(),
        onTitleRules: (rules) => title && setTitleRules(title.id, rules),
        onDefaultRules: (rules) => api.storage.set("rules", rules),
        onDefaultOrder: (order) => api.storage.set("order", order)
      }));
    };
    api.ui.settingsEntry("Stream languages", () => openLanguages(null));
    api.anchors.watch("streams.toolbar", (toolbar) => {
      toolbar.dataset.mysStreamsToolbar = "";
      return () => delete toolbar.dataset.mysStreamsToolbar;
    });
    api.anchors.watch("streams.list", (native) => {
      const container = document.createElement("div");
      container.className = "mys-streams";
      container.dataset.mysStreams = "";
      native.dataset.mysStreamsNative = "";
      native.insertAdjacentElement("afterend", container);
      let disposed = false;
      let showOthers = false;
      let orderOverride = null;
      let addon = null;
      let current2 = "";
      let drawing = 0;
      const draw = async () => {
        const turn = ++drawing;
        const state = await api.core.getState("meta_details");
        const meta = state.selected?.metaPath;
        if (disposed || !meta) return;
        const original = await originalLanguage(meta.type, meta.id);
        if (disposed || turn !== drawing) return;
        const video = state.selected?.streamPath?.id ?? meta.id;
        if (video !== current2) {
          current2 = video;
          showOthers = false;
          addon = null;
        }
        const ready = state.streams.filter((group) => group.content.type === "Ready");
        const addons = ready.map((group) => group.addon.manifest.name);
        const rows = ready.filter((group) => addon === null || group.addon.manifest.name === addon).flatMap((group) => (group.content.type === "Ready" ? group.content.content : []).map((stream) => {
          const info = describeStream(stream);
          return { stream, addon: group.addon.manifest.name, info, languages: audioLanguages(info, original) };
        }));
        const rules = titleRules(meta.id) ?? defaultRules();
        const order = orderOverride ?? defaultOrder();
        const selection = selectStreams(rows.map((entry) => ({ stream: entry, languages: entry.languages, quality: entry.info.quality })), rules, original, order);
        const loading = state.streams.filter((group) => group.content.type === "Loading").length;
        const name = state.metaItem?.content?.content?.name ?? "this title";
        render(container, {
          loading,
          rules,
          usesTitleRules: titleRules(meta.id) !== null,
          order,
          selection,
          showOthers,
          addons,
          addon: addons.includes(addon ?? "") ? addon : null
        }, {
          onEditLanguages: () => openLanguages({ id: meta.id, name }),
          onToggleOrder: () => {
            orderOverride = order === "language-first" ? "quality-first" : "language-first";
            draw();
          },
          onShowOthers: () => {
            showOthers = true;
            draw();
          },
          onAddon: (value) => {
            addon = value;
            draw();
          }
        });
        if (loading === 0 && rows.length > 0 && addon === null && order === "language-first" && !toasted.has(video)) {
          toasted.add(video);
          if (selection.rule === null) {
            api.ui.toast({ title: "None of your languages were found. Showing every stream." });
          } else if (selection.rule > 0) {
            api.ui.toast({ title: `No ${ruleLabel(rules[0])} audio found. Showing ${ruleLabel(rules[selection.rule])}.` });
          }
        }
      };
      const stopState = api.core.on("state", (models) => {
        if (models.includes("meta_details")) draw();
      });
      const stopStorage = api.storage.onChange(draw);
      draw();
      return () => {
        disposed = true;
        stopState();
        stopStorage();
        container.remove();
        delete native.dataset.mysStreamsNative;
      };
    });
  };
  var streams = {
    manifest: {
      id: "streams",
      name: "Stream languages",
      version: "1.0.0",
      apiVersion: 0,
      description: "Shows streams in your languages first, grouped by quality, with a language list per title.",
      entry: "index.js",
      anchors: ["streams.list", "streams.toolbar"]
    },
    css: styles_default2,
    activate: activate2
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
  var settingsEntry = (label, onOpen) => watchAnchor("settings.menu", (menu) => {
    const sections3 = [...menu.querySelectorAll("[data-section], [data-mys-settings-entry]")];
    const sibling = menu.querySelector("[data-section]");
    const last = sections3[sections3.length - 1];
    if (!sibling || !last) return;
    const button = h("div", { textContent: label, title: label, tabIndex: 0 });
    button.className = [...sibling.classList].filter((name) => !name.startsWith("selected-")).join(" ");
    button.dataset.mysSettingsEntry = label;
    button.addEventListener("click", onOpen);
    last.insertAdjacentElement("afterend", button);
    return () => button.remove();
  });
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
    const count2 = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder2 = new TextDecoder();
    const files = /* @__PURE__ */ new Map();
    for (let index = 0; index < count2; index += 1) {
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
      ui: {
        toast,
        confirm,
        panel: (content, onClose) => track(openPanel(content, onClose)),
        settingsEntry: (label, onOpen) => track(settingsEntry(label, onOpen))
      }
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
  var activate3 = async (plugin) => {
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
      await activate3(plugin);
    }
  };
  var startPlugins = async (transport, container, bundled) => {
    core2 = transport;
    backend = container;
    for (const { manifest, css, activate: run } of bundled) {
      await register({ manifest, bundled: true, active: false, error: null, css: css ?? null, load: async () => run, disposers: [] });
    }
    const installed = await backend.listPlugins().catch((error) => {
      console.error("[mystremio] cannot list installed plugins", error);
      return [];
    });
    for (const stored of installed) {
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
      await activate3(plugin);
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
  var startPluginsPage = () => settingsEntry("Plugins", openPluginsPage);

  // src/host/index.ts
  var BUNDLED = [addonReorder, streams];
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

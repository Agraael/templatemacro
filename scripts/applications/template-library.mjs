/* global FormApplication, Dialog, foundry, game, CONFIG, Hooks */
import { MODULE } from "../constants.mjs";
import { openEntryGraphicsConfig } from "./graphics-config.mjs";

const PROTECTED_KINDS = {
  danger: { label: "Dangerous Zone", color: "#c44", icon: "fa-radiation" },
  status: { label: "Status Zone",    color: "#48c", icon: "fa-bolt" }
};

const DAMAGE_TYPES = ["kinetic", "explosive", "energy", "heat", "burn", "variable"];

let _activeEntryId = null;
let _activeOverrides = null;
export function getActiveEntryId() { return _activeEntryId; }
export function getActiveOverrides() { return _activeOverrides; }
export function setActiveEntryId(id, overrides = null) {
  _activeEntryId = id;
  _activeOverrides = overrides;
  Hooks.callAll("templatemacro.activeLibraryEntryChanged", id);
}

const _elevTool = { aware: false, manual: false, height: 0, elevation: 0 };
let _elevToolHydrated = false;
function _hydrateElevTool() {
  if (_elevToolHydrated) return;
  _elevToolHydrated = true;
  try {
    const saved = game.settings.get(MODULE, "templateLibraryElevTool") ?? {};
    if (saved.aware !== undefined) _elevTool.aware = !!saved.aware;
    if (saved.manual !== undefined) _elevTool.manual = !!saved.manual;
    if (saved.height !== undefined) _elevTool.height = Number(saved.height) || 0;
    if (saved.elevation !== undefined) _elevTool.elevation = Number(saved.elevation) || 0;
  } catch { /* setting not registered yet */ }
}
export function getLibraryElevTool() { _hydrateElevTool(); return { ..._elevTool }; }
export function setLibraryElevTool(patch = {}) {
  _hydrateElevTool();
  if (patch.aware !== undefined) _elevTool.aware = !!patch.aware;
  if (patch.manual !== undefined) _elevTool.manual = !!patch.manual;
  if (patch.height !== undefined) _elevTool.height = Number(patch.height) || 0;
  if (patch.elevation !== undefined) _elevTool.elevation = Number(patch.elevation) || 0;
  try { game.settings.set(MODULE, "templateLibraryElevTool", { ..._elevTool }); }
  catch { /* setting not registered yet */ }
}

function _defaultGraphics() {
  return {
    useCustomRender: true,
    radiusOffset: 0,
    lineType: 2, // DASHED
    lineWidth: 2,
    lineColor: "#000000",
    lineOpacity: 1,
    lineDashSize: 15,
    lineGapSize: 10,
    lineDashOffsetAnimation: 0,
    lineColorAnimation: null,
    fillType: 1, // SOLID
    fillColor: "#ffffff",
    fillOpacity: 0.25,
    fillColorAnimation: null,
    fillTexture: "",
    fillTextureOffset: { x: 0, y: 0 },
    fillTextureOffsetAnimation: null,
    fillTextureScale: { x: 100, y: 100 },
    centerLabel: "",
    movementPenalty: 0,
    flatMovementPenalty: true,
    elevationGated: false,
    elevationRangeManual: false,
    elevationRange: 0,
    innerRadius: 0,
    actions: []
  };
}

function _readDefaultGraphicsForZone(zoneType) {
  const prefix = zoneType === "difficult" ? "difficultTerrainDefault" : `${zoneType}ZoneDefault`;
  const read = (field, fb) => {
    try { return game.settings.get(MODULE, `${prefix}${field}`) ?? fb; }
    catch { return fb; }
  };
  return {
    useCustomRender: read("UseCustomRender", true),
    radiusOffset: read("RadiusOffset", 0),
    lineType: read("LineType", 1),
    lineWidth: read("LineWidth", 2),
    lineColor: read("LineColor", read("BorderColor", "#000000")),
    lineOpacity: read("LineOpacity", read("BorderOpacity", 0.5)),
    lineDashSize: read("LineDashSize", 15),
    lineGapSize: read("LineGapSize", 10),
    lineDashOffsetAnimation: read("LineDashOffsetAnimation", 0),
    lineColorAnimation: read("LineColorAnimation", null),
    fillType: read("FillType", 1),
    fillColor: read("FillColor", "#ff6400"),
    fillOpacity: read("FillOpacity", 0.5),
    fillColorAnimation: read("FillColorAnimation", null),
    fillTexture: read("FillTexture", "") || read("Texture", ""),
    fillTextureOffset: read("FillTextureOffset", { x: 0, y: 0 }),
    fillTextureOffsetAnimation: read("FillTextureOffsetAnimation", null),
    fillTextureScale: read("FillTextureScale", { x: 100, y: 100 }),
    centerLabel: "",
    movementPenalty: 0,
    flatMovementPenalty: true,
    actions: []
  };
}

function makeEntry(overrides = {}) {
  const protectedKind = overrides.protectedKind ?? null;
  return {
    id: foundry.utils.randomID(),
    name: overrides.name ?? "New Template",
    icon: overrides.icon ?? (protectedKind ? PROTECTED_KINDS[protectedKind].icon : "fa-circle"),
    folder: overrides.folder ?? "",
    protected: !!overrides.protected,
    protectedKind,
    graphicsState: overrides.graphicsState ?? (protectedKind ? _readDefaultGraphicsForZone(protectedKind) : _defaultGraphics())
  };
}

export function getLibrary() {
  try { return game.settings.get(MODULE, "templateLibrary") ?? []; }
  catch { return []; }
}

export async function setLibrary(entries) {
  await game.settings.set(MODULE, "templateLibrary", entries);
}

export function getSpawnLibrary() {
  try { return game.settings.get(MODULE, "templateLibrarySpawn") ?? []; }
  catch { return []; }
}

export async function setSpawnLibrary(entries) {
  await game.settings.set(MODULE, "templateLibrarySpawn", entries);
}

const TEMPLATE_TYPES = ["Blast", "Burst", "Cone", "Line"];

function makeSpawnEntry(overrides = {}) {
  return {
    id: foundry.utils.randomID(),
    name: overrides.name ?? "New Template",
    icon: overrides.icon ?? "fa-circle",
    folder: overrides.folder ?? "",
    size: overrides.size ?? 1,
    templateType: overrides.templateType ?? "Blast",
    graphicsState: overrides.graphicsState ?? _defaultGraphics()
  };
}

export async function spawnLibraryEntry(entry) {
  setActiveEntryId(entry.id, null);
  try {
    if (game.system.id === "lancer" && game.lancer?.canvas?.WeaponRangeTemplate) {
      const preview = game.lancer.canvas.WeaponRangeTemplate.fromRange({ type: entry.templateType ?? "Blast", val: Math.max(entry.size ?? 1, 0) });
      await preview.placeTemplate();
    } else {
      const cx = canvas.scene.dimensions.sceneX + canvas.scene.dimensions.sceneWidth / 2;
      const cy = canvas.scene.dimensions.sceneY + canvas.scene.dimensions.sceneHeight / 2;
      const tMap = { blast: "circle", burst: "circle", cone: "cone", line: "ray" };
      await getDocumentClass("MeasuredTemplate").create({
        t: tMap[(entry.templateType ?? "Blast").toLowerCase()] ?? "circle",
        user: game.user.id,
        x: cx, y: cy,
        distance: entry.size ?? 1
      }, { parent: canvas.scene });
    }
  } finally {
    setActiveEntryId(null);
  }
}

export async function seedLibraryIfEmpty() {
  if (!game.user.isGM) return;
  if (game.system.id !== "lancer") return;
  const decorate = (entry, fill, line) => {
    entry.graphicsState.fillColor = fill;
    entry.graphicsState.lineColor = line;
    entry.graphicsState.fillOpacity = 0.15;
    entry.graphicsState.fillColorAnimation = null;
    entry.graphicsState.lineType = 2; // DASHED
    entry.graphicsState.lineWidth = 3;
    entry.graphicsState.lineOpacity = 0.8;
    entry.graphicsState.lineDashSize = 15;
    entry.graphicsState.lineGapSize = 10;
    entry.graphicsState.lineDashOffsetAnimation = 0;
  };

  const danger = makeEntry({ name: "Dangerous Zone", protectedKind: "danger", icon: "icons/svg/radiation.svg", protected: true });
  danger.seedKey = "danger";
  decorate(danger, "#ff6400", "#ff6400");

  const status = makeEntry({ name: "Status Zone", protectedKind: "status", icon: "icons/svg/dice-target.svg", protected: true });
  status.seedKey = "status";
  decorate(status, "#0088ff", "#0088ff");

  const difficult = makeEntry({ name: "Difficult Zone", icon: "icons/svg/mountain.svg" });
  difficult.seedKey = "difficult";
  decorate(difficult, "#e83bd1", "#e83bd1");
  difficult.graphicsState.fillType = 2; // PATTERN
  difficult.graphicsState.fillTexture = "modules/templatemacro/textures/hatching-rock.png";
  difficult.graphicsState.movementPenalty = 1;
  difficult.graphicsState.flatMovementPenalty = true;
  difficult.graphicsState.centerLabel = "Difficult\nZone";

  const lib = getLibrary();

  // Migrate pre-seedKey entries so renames don't trigger duplicates.
  const legacyNameToKey = {
    "Dangerous Zone": "danger",
    "Status Zone": "status",
    "Difficult Terrain": "difficult",
    "Difficult Zone": "difficult"
  };
  for (const e of lib) {
    if (!e.seedKey && legacyNameToKey[e.name]) e.seedKey = legacyNameToKey[e.name];
  }

  const upsert = (seed) => {
    const idx = lib.findIndex(e => e.seedKey === seed.seedKey);
    if (idx >= 0) {
      if (seed.protected) {
        lib[idx].protected = true;
        lib[idx].protectedKind = seed.protectedKind;
      }
      lib[idx].icon = lib[idx].icon || seed.icon;
    } else {
      lib.push(seed);
    }
  };
  upsert(danger);
  upsert(status);
  upsert(difficult);
  await setLibrary(lib);
}

export function applyEntryToTemplateData(doc, entry) {
  if (!entry) return;
  const g = entry.graphicsState ?? {};
  const update = {};

  if (g.fillColor) update.fillColor = g.fillColor;
  if (g.lineColor) update.borderColor = g.lineColor;

  update.flags = update.flags ?? {};
  update.flags[MODULE] = {
    useCustomRender: !!g.useCustomRender,
    radiusOffset: g.radiusOffset ?? 0,
    lineType: g.lineType ?? 1,
    lineWidth: g.lineWidth ?? 2,
    lineColor: g.lineColor ?? "#000000",
    lineOpacity: g.lineOpacity ?? 0.5,
    lineDashSize: g.lineDashSize ?? 15,
    lineGapSize: g.lineGapSize ?? 10,
    lineDashOffsetAnimation: g.lineDashOffsetAnimation ?? 0,
    lineColorAnimation: g.lineColorAnimation ?? null,
    fillType: g.fillType ?? 1,
    fillColor: g.fillColor ?? "#000000",
    fillOpacity: g.fillOpacity ?? 0.25,
    fillColorAnimation: g.fillColorAnimation ?? null,
    fillTexture: g.fillTexture ?? "",
    fillTextureOffset: g.fillTextureOffset ?? { x: 0, y: 0 },
    fillTextureOffsetAnimation: g.fillTextureOffsetAnimation ?? null,
    fillTextureScale: g.fillTextureScale ?? { x: 100, y: 100 },
    centerLabel: g.centerLabel ?? "",
    actions: g.actions ?? entry.actions ?? [],
    libraryEntryId: entry.id,
    libraryEntryIcon: entry.icon ?? ""
  };

  if (g.elevationGated) {
    update.flags[MODULE].elevationGated = true;
    if (g.elevationRangeManual) {
      update.flags[MODULE].elevationRangeManual = true;
      update.flags[MODULE].elevationRange = g.elevationRange ?? 0;
    } else {
      update.flags[MODULE]["-=elevationRangeManual"] = null;
      update.flags[MODULE]["-=elevationRange"] = null;
    }
  } else {
    update.flags[MODULE]["-=elevationGated"] = null;
    update.flags[MODULE]["-=elevationRangeManual"] = null;
    update.flags[MODULE]["-=elevationRange"] = null;
  }
  if ((g.innerRadius ?? 0) > 0) update.flags[MODULE].innerRadius = g.innerRadius;
  else update.flags[MODULE]["-=innerRadius"] = null;

  if (entry.protected && entry.protectedKind) {
    const overrides = getActiveOverrides() ?? {};
    const built = _buildProtectedBehavior(entry.protectedKind, overrides);
    if (built.flags) {
      for (const [k, v] of Object.entries(built.flags)) update.flags[MODULE][k] = v;
    }
    if (built.actions?.length) {
      update.flags[MODULE].actions = [...(update.flags[MODULE].actions ?? []), ...built.actions];
    }
    if (built.movement) {
      update.flags[MODULE].movementPenalty = built.movement.movementPenalty;
      update.flags[MODULE].flatMovementPenalty = built.movement.flatMovementPenalty;
    }
  } else if ((g.movementPenalty ?? 0) !== 0) {
    update.flags[MODULE].movementPenalty = g.movementPenalty;
    update.flags[MODULE].flatMovementPenalty = g.flatMovementPenalty ?? true;
  }

  if (g.useCustomRender) {
    update.flags.tokenmagic = update.flags.tokenmagic ?? {};
    update.flags.tokenmagic.templateData = { ...(update.flags.tokenmagic.templateData ?? {}), opacity: 0 };
  }

  if (_elevTool.aware) {
    delete update.flags[MODULE]["-=elevationGated"];
    delete update.flags[MODULE]["-=elevationRangeManual"];
    delete update.flags[MODULE]["-=elevationRange"];
    update.flags[MODULE].elevationGated = true;
    if (_elevTool.manual) {
      update.flags[MODULE].elevationRangeManual = true;
      update.flags[MODULE].elevationRange = _elevTool.height;
    } else {
      update.flags[MODULE].elevationRangeManual = false;
      update.flags[MODULE].elevationRange = 0;
    }
    update.elevation = _elevTool.elevation;
  }

  doc.updateSource(update);
}

export function registerLibraryHooks() {
  Hooks.on("preCreateMeasuredTemplate", (doc, _data, _options, _userId) => {
    const id = getActiveEntryId();
    if (!id) return;
    const entry = getLibrary().find(e => e.id === id) ?? getSpawnLibrary().find(e => e.id === id);
    if (!entry) return;
    applyEntryToTemplateData(doc, entry);
  });

  Hooks.on("dropCanvasData", async (_canvas, data) => {
    if (data?.type !== "templatemacro-entry") return;
    const entry = (data.kind === "preset" ? getLibrary() : getSpawnLibrary()).find(e => e.id === data.id);
    if (!entry) return false;
    if (data.kind === "spawn") {
      setActiveEntryId(entry.id, null);
      try {
        const tMap = { blast: "circle", burst: "circle", cone: "cone", line: "ray" };
        const t = tMap[(entry.templateType ?? "Blast").toLowerCase()] ?? "circle";
        await getDocumentClass("MeasuredTemplate").create({
          t, user: game.user.id,
          x: data.x, y: data.y,
          distance: entry.size ?? 1
        }, { parent: canvas.scene });
      } finally {
        setActiveEntryId(null);
      }
    } else {
      const overrides = await _promptForKind(entry);
      if (overrides === null && _kindNeedsPrompt(entry.protectedKind)) return false;
      setActiveEntryId(entry.id, overrides ?? {});
    }
    return false;
  });
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TemplateLibraryConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "templatemacro-library",
    classes: ["templatemacro", "tmac-library-config"],
    tag: "form",
    window: { title: "Template Library", icon: "fa-solid fa-folder-open", resizable: true },
    position: { width: 320, height: "auto" }
  };

  static PARTS = {
    body: { template: "modules/templatemacro/templates/template-library.html" }
  };

  constructor(options = {}) {
    super(options);
    this._activeHookId = Hooks.on("templatemacro.activeLibraryEntryChanged", () => this.render());
    this._activeTab = "presets";
    this._collapsedFolders = new Set();
  }

  async _preClose() {
    if (this._activeHookId) Hooks.off("templatemacro.activeLibraryEntryChanged", this._activeHookId);
    if (getActiveEntryId()) setActiveEntryId(null);
  }

  _openFolderMenu(folder, isPreset) {
    const settingKey = isPreset ? "templateLibraryFolders" : "templateLibrarySpawnFolders";
    const libGet = isPreset ? getLibrary : getSpawnLibrary;
    const libSet = isPreset ? setLibrary : setSpawnLibrary;
    new Dialog({
      title: `Folder: ${folder}`,
      content: `<form><div class="form-group"><label>Rename to</label><input type="text" name="folder" value="${String(folder).replaceAll('"', '&quot;')}" autofocus></div></form>`,
      buttons: {
        rename: {
          icon: '<i class="fa-solid fa-pen"></i>',
          label: "Rename",
          callback: async (html) => {
            const newName = String(html.find('input[name="folder"]').val() ?? "").trim();
            if (!newName || newName === folder) return;
            const list = (game.settings.get(MODULE, settingKey) ?? []).filter(f => f !== folder);
            if (!list.includes(newName)) list.push(newName);
            await game.settings.set(MODULE, settingKey, list);
            const lib = libGet();
            for (const e of lib) if (e.folder === folder) e.folder = newName;
            await libSet(lib);
            this.render();
          }
        },
        remove: {
          icon: '<i class="fa-solid fa-trash"></i>',
          label: "Remove",
          callback: async () => {
            const list = (game.settings.get(MODULE, settingKey) ?? []).filter(f => f !== folder);
            await game.settings.set(MODULE, settingKey, list);
            const lib = libGet();
            for (const e of lib) if (e.folder === folder) e.folder = "";
            await libSet(lib);
            this.render();
          }
        },
        cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel" }
      },
      default: "rename"
    }).render(true);
  }

  _onClose() {
    ui.controls?.initialize?.();
  }

  async _onFirstRender(_context, _options) {
    ui.controls?.initialize?.();
  }

  // crlngn-ui's `change-windows` rules lock left/top with !important, so bypass setPosition.
  _positionNextToSidebar() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sidebar = document.getElementById("sidebar") ?? ui.sidebar?.element;
      const sidebarLeft = sidebar?.getBoundingClientRect?.().left;
      if (!sidebarLeft) return;
      const myWidth = this.element?.offsetWidth || 320;
      const target = Math.round(sidebarLeft - myWidth - 15);
      this.setPosition({ left: target, top: 5 });
      this.element.style.setProperty("left", target + "px", "important");
      this.element.style.setProperty("top", "5px", "important");
    }));
  }

  async _prepareContext() {
    const active = getActiveEntryId();
    const decorateEntry = (e) => {
      const kindMeta = e.protectedKind ? PROTECTED_KINDS[e.protectedKind] : null;
      const fill = e.graphicsState?.fillColor ?? (kindMeta?.color ?? "#888");
      const isSvg = typeof e.icon === "string" && e.icon.toLowerCase().endsWith(".svg");
      const isFa = typeof e.icon === "string" && e.icon.startsWith("fa-");
      const iconUrl = (typeof e.icon === "string" && !isFa && !/^(https?:|\/)/i.test(e.icon))
        ? "/" + e.icon
        : e.icon;
      return {
        ...e,
        iconUrl,
        zoneLabel: kindMeta?.label ?? "Template",
        zoneColor: fill,
        iconIsFa: isFa,
        iconIsSvg: isSvg && !isFa,
        iconIsImg: !isFa && !isSvg,
        isActive: e.id === active,
        protected: !!e.protected
      };
    };
    const groupByFolder = (entries, knownFolders) => {
      const groups = new Map();
      groups.set("", []);
      for (const f of knownFolders) if (f) groups.set(f, []);
      for (const e of entries) {
        const key = (e.folder ?? "").trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      const orderedKeys = [...groups.keys()].sort((a, b) => {
        if (!a) return -1;
        if (!b) return 1;
        return a.localeCompare(b);
      });
      return orderedKeys.map(name => ({ name, entries: groups.get(name) }));
    };
    const presetFolders = game.settings.get(MODULE, "templateLibraryFolders") ?? [];
    const spawnFolders = game.settings.get(MODULE, "templateLibrarySpawnFolders") ?? [];
    return {
      tab: this._activeTab ?? "presets",
      isPresetsTab: (this._activeTab ?? "presets") === "presets",
      isSpawnTab: (this._activeTab ?? "presets") === "spawn",
      presetGroups: groupByFolder(getLibrary().map(decorateEntry), presetFolders),
      spawnGroups: groupByFolder(getSpawnLibrary().map(decorateEntry), spawnFolders),
      isGM: game.user.isGM,
      hasActive: !!active,
      elevTool: { ..._elevTool }
    };
  }

  _onRender(_context, _options) {
    this._positionNextToSidebar();
    const root = this.element;
    const on = (sel, evt, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn));

    on("[data-tmac-lib-elev-aware]", "change", (ev) => {
      setLibraryElevTool({ aware: ev.currentTarget.checked });
      this.render();
    });
    on("[data-tmac-lib-elev-manual]", "change", (ev) => {
      setLibraryElevTool({ manual: ev.currentTarget.checked });
      this.render();
    });
    on("[data-tmac-lib-elev-height]", "change", (ev) => {
      setLibraryElevTool({ height: ev.currentTarget.value });
    });
    on("[data-tmac-lib-elev-elevation]", "change", (ev) => {
      setLibraryElevTool({ elevation: ev.currentTarget.value });
    });

    on("[data-tmac-entry-id]", "dragstart", (ev) => {
      const kind = ev.currentTarget.dataset.tmacEntryKind;
      const id = ev.currentTarget.dataset.tmacEntryId;
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "templatemacro-entry", kind, id }));
      ev.dataTransfer.effectAllowed = "move";
    });

    on("[data-tmac-folder-drop]", "click", (ev) => {
      const folder = ev.currentTarget.dataset.tmacFolderDrop ?? "";
      if (!folder) return;
      const tab = this._activeTab ?? "presets";
      const key = `${tab}|${folder}`;
      if (this._collapsedFolders.has(key)) this._collapsedFolders.delete(key);
      else this._collapsedFolders.add(key);
      const list = ev.currentTarget.nextElementSibling;
      if (list?.classList?.contains("tmac-lib-list")) list.classList.toggle("collapsed");
      ev.currentTarget.classList.toggle("collapsed");
    });

    on("[data-tmac-folder-drop]", "contextmenu", (ev) => {
      ev.preventDefault();
      const folder = ev.currentTarget.dataset.tmacFolderDrop ?? "";
      if (!folder) return;
      const isPreset = (this._activeTab ?? "presets") === "presets";
      this._openFolderMenu(folder, isPreset);
    });

    {
      const tab = this._activeTab ?? "presets";
      for (const header of root.querySelectorAll("[data-tmac-folder-drop]")) {
        const folder = header.dataset.tmacFolderDrop ?? "";
        if (!folder) continue;
        if (this._collapsedFolders.has(`${tab}|${folder}`)) {
          header.classList.add("collapsed");
          const list = header.nextElementSibling;
          if (list?.classList?.contains("tmac-lib-list")) list.classList.add("collapsed");
        }
      }
    }

    on("[data-tmac-folder-drop]", "dragover", (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; });
    on("[data-tmac-folder-drop]", "dragenter", (ev) => ev.currentTarget.classList.add("tmac-drag-over"));
    on("[data-tmac-folder-drop]", "dragleave", (ev) => ev.currentTarget.classList.remove("tmac-drag-over"));
    on("[data-tmac-folder-drop]", "drop", async (ev) => {
      ev.currentTarget.classList.remove("tmac-drag-over");
      ev.preventDefault();
      let payload;
      try { payload = JSON.parse(ev.dataTransfer.getData("text/plain")); }
      catch { return; }
      if (payload?.type !== "templatemacro-entry") return;
      const folder = ev.currentTarget.dataset.tmacFolderDrop ?? "";
      const isPreset = payload.kind === "preset";
      const lib = isPreset ? getLibrary() : getSpawnLibrary();
      const idx = lib.findIndex(e => e.id === payload.id);
      if (idx < 0) return;
      lib[idx] = { ...lib[idx], folder };
      await (isPreset ? setLibrary : setSpawnLibrary)(lib);
      this.render();
    });

    on("[data-tmac-lib-select]", "click", async (ev) => {
      if (ev.target.closest("[data-tmac-lib-edit], [data-tmac-lib-clone], [data-tmac-lib-delete]")) return;
      const id = ev.currentTarget.dataset.tmacLibSelect;
      if (getActiveEntryId() === id) { setActiveEntryId(null); return; }
      const entry = getLibrary().find(e => e.id === id);
      if (!entry) return;
      const overrides = await _promptForKind(entry);
      if (overrides === null && _kindNeedsPrompt(entry.protectedKind)) return;
      setActiveEntryId(id, overrides ?? {});
    });

    on("[data-tmac-lib-clear]", "click",() => setActiveEntryId(null));

    on("[data-tmac-lib-edit]", "click",async (ev) => {
      const id = ev.currentTarget.dataset.tmacLibEdit;
      const lib = getLibrary();
      const entry = lib.find(e => e.id === id);
      if (!entry) return;
      openEntryGraphicsConfig(foundry.utils.duplicate(entry), async (updated) => {
        const fresh = getLibrary();
        const idx = fresh.findIndex(e => e.id === id);
        if (idx >= 0) fresh[idx] = { ...fresh[idx], name: updated.name, icon: updated.icon, graphicsState: updated.graphicsState };
        await setLibrary(fresh);
        this.render();
      });
    });

    on("[data-tmac-lib-clone]", "click",async (ev) => {
      const id = ev.currentTarget.dataset.tmacLibClone;
      const lib = getLibrary();
      const src = lib.find(e => e.id === id);
      if (!src) return;

      if (src.protected && src.protectedKind) {
        const overrides = await _promptForKind(src);
        if (overrides === null && _kindNeedsPrompt(src.protectedKind)) return;
        const built = _buildProtectedBehavior(src.protectedKind, overrides ?? {});
        const dup = foundry.utils.duplicate(src);
        dup.id = foundry.utils.randomID();
        dup.name = _suggestName(src, overrides);
        dup.protected = false;
        dup.protectedKind = null;
        dup.graphicsState = dup.graphicsState ?? {};
        dup.graphicsState.actions = [...(dup.graphicsState.actions ?? []), ...(built.actions ?? [])];
        if (built.movement) {
          dup.graphicsState.movementPenalty = built.movement.movementPenalty;
          dup.graphicsState.flatMovementPenalty = built.movement.flatMovementPenalty;
        }
        lib.push(dup);
        await setLibrary(lib);
        this.render();
        return;
      }

      const dup = foundry.utils.duplicate(src);
      dup.id = foundry.utils.randomID();
      dup.name = `${src.name} (copy)`;
      dup.protected = false;
      lib.push(dup);
      await setLibrary(lib);
      this.render();
    });

    on("[data-tmac-lib-delete]", "click",async (ev) => {
      const id = ev.currentTarget.dataset.tmacLibDelete;
      const entry = getLibrary().find(e => e.id === id);
      if (!entry) return;
      if (entry.protected) {
        ui.notifications?.warn("Default templates can't be deleted.");
        return;
      }
      const safeName = String(entry.name).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const ok = await Dialog.confirm({
        title: "Delete Template",
        content: `<p>Delete <strong>${safeName}</strong> from the library?</p>`
      });
      if (!ok) return;
      const lib = getLibrary().filter(e => e.id !== id);
      await setLibrary(lib);
      this.render();
    });

    on("[data-tmac-lib-add]", "click",() => {
      const newEntry = makeEntry();
      openEntryGraphicsConfig(newEntry, async (saved) => {
        const lib = getLibrary();
        lib.push(saved);
        await setLibrary(lib);
        this.render();
      });
    });

    on("[data-tmac-lib-paste]", "click", () => {
      _showJsonImportDialog("Import Preset from JSON", async (data) => {
        const entry = Array.isArray(data) ? data[0] : data;
        if (!entry || typeof entry !== "object" || !entry.graphicsState) {
          ui.notifications?.error("Invalid preset JSON.");
          return;
        }
        const dup = foundry.utils.duplicate(entry);
        dup.id = foundry.utils.randomID();
        dup.protected = false;
        dup.protectedKind = null;
        const lib = getLibrary();
        lib.push(dup);
        await setLibrary(lib);
        this.render();
      });
    });

    on("[data-tmac-lib-export]", "click",() => _exportLibrary());
    on("[data-tmac-lib-import]", "click",() => _importLibrary(this));
    on("[data-tmac-lib-new-folder]", "click", () => _promptNewFolder("templateLibraryFolders", this));
    on("[data-tmac-lib-entry-export]", "click",(ev) => {
      ev.stopPropagation();
      const id = ev.currentTarget.dataset.tmacLibEntryExport;
      const entry = getLibrary().find(e => e.id === id);
      if (entry) _showJsonExportDialog(`Export Preset: ${entry.name}`, entry);
    });

    on("[data-tmac-lib-tab]", "click",(ev) => {
      this._activeTab = ev.currentTarget.dataset.tmacLibTab;
      this.render();
    });

    on("[data-tmac-spawn-select]", "click",async (ev) => {
      if (ev.target.closest("[data-tmac-spawn-edit], [data-tmac-spawn-clone], [data-tmac-spawn-delete], [data-tmac-spawn-entry-export]")) return;
      const id = ev.currentTarget.dataset.tmacSpawnSelect;
      const entry = getSpawnLibrary().find(e => e.id === id);
      if (!entry) return;
      await spawnLibraryEntry(entry);
    });

    on("[data-tmac-spawn-edit]", "click",(ev) => {
      const id = ev.currentTarget.dataset.tmacSpawnEdit;
      const entry = getSpawnLibrary().find(e => e.id === id);
      if (!entry) return;
      _openSpawnEditor(foundry.utils.duplicate(entry), async (updated) => {
        const fresh = getSpawnLibrary();
        const idx = fresh.findIndex(e => e.id === id);
        if (idx >= 0) fresh[idx] = updated;
        await setSpawnLibrary(fresh);
        this.render();
      });
    });

    on("[data-tmac-spawn-clone]", "click",async (ev) => {
      const id = ev.currentTarget.dataset.tmacSpawnClone;
      const lib = getSpawnLibrary();
      const src = lib.find(e => e.id === id);
      if (!src) return;
      const dup = foundry.utils.duplicate(src);
      dup.id = foundry.utils.randomID();
      dup.name = `${src.name} (copy)`;
      lib.push(dup);
      await setSpawnLibrary(lib);
      this.render();
    });

    on("[data-tmac-spawn-delete]", "click",async (ev) => {
      const id = ev.currentTarget.dataset.tmacSpawnDelete;
      const entry = getSpawnLibrary().find(e => e.id === id);
      if (!entry) return;
      const safeName = String(entry.name).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const ok = await Dialog.confirm({
        title: "Delete Template",
        content: `<p>Delete <strong>${safeName}</strong> from the spawn library?</p>`
      });
      if (!ok) return;
      const lib = getSpawnLibrary().filter(e => e.id !== id);
      await setSpawnLibrary(lib);
      this.render();
    });

    on("[data-tmac-spawn-add]", "click",() => {
      const newEntry = makeSpawnEntry();
      _openSpawnEditor(newEntry, async (saved) => {
        const lib = getSpawnLibrary();
        lib.push(saved);
        await setSpawnLibrary(lib);
        this.render();
      });
    });

    on("[data-tmac-spawn-paste]", "click", () => {
      _showJsonImportDialog("Import Template from JSON", async (data) => {
        const entry = Array.isArray(data) ? data[0] : data;
        if (!entry || typeof entry !== "object" || !entry.graphicsState) {
          ui.notifications?.error("Invalid template JSON.");
          return;
        }
        const dup = foundry.utils.duplicate(entry);
        dup.id = foundry.utils.randomID();
        const lib = getSpawnLibrary();
        lib.push(dup);
        await setSpawnLibrary(lib);
        this.render();
      });
    });

    on("[data-tmac-spawn-export]", "click",() => _downloadJson("templatemacro-spawn-library.json", getSpawnLibrary()));
    on("[data-tmac-spawn-import]", "click",() => _importSpawnLibrary(this));
    on("[data-tmac-spawn-new-folder]", "click", () => _promptNewFolder("templateLibrarySpawnFolders", this));
    on("[data-tmac-spawn-entry-export]", "click",(ev) => {
      ev.stopPropagation();
      const id = ev.currentTarget.dataset.tmacSpawnEntryExport;
      const entry = getSpawnLibrary().find(e => e.id === id);
      if (entry) _showJsonExportDialog(`Export Template: ${entry.name}`, entry);
    });
  }

}

function _buildProtectedBehavior(kind, overrides = {}) {
  const out = { flags: {}, actions: [] };
  if (kind === "danger") {
    const dt = overrides.damageType ?? "kinetic";
    const dv = overrides.damageValue ?? 5;
    const cmd = `if (token) await game.modules.get('templatemacro').api.triggerDangerousZoneFlow(token, "${dt}", ${dv});`;
    out.actions.push(
      { id: foundry.utils.randomID(), trigger: "whenEntered", actionType: "code", asGM: false, code: cmd, macroUuid: "", effectName: "", effectMode: "apply" },
      { id: foundry.utils.randomID(), trigger: "whenTurnStart", actionType: "code", asGM: false, code: cmd, macroUuid: "", effectName: "", effectMode: "apply" }
    );
  } else if (kind === "status") {
    const effects = overrides.statusEffects ?? [];
    for (const sid of effects) {
      out.actions.push(
        { id: foundry.utils.randomID(), trigger: "whenCreated", actionType: "effect", asGM: false, code: "", macroUuid: "", effectName: sid, effectMode: "apply" },
        { id: foundry.utils.randomID(), trigger: "whenEntered", actionType: "effect", asGM: false, code: "", macroUuid: "", effectName: sid, effectMode: "apply" },
        { id: foundry.utils.randomID(), trigger: "whenLeft", actionType: "effect", asGM: false, code: "", macroUuid: "", effectName: sid, effectMode: "remove" },
        { id: foundry.utils.randomID(), trigger: "whenDeleted", actionType: "effect", asGM: false, code: "", macroUuid: "", effectName: sid, effectMode: "remove" }
      );
    }
  }
  return out;
}

function _slug(s) {
  return String(s ?? "template").toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "template";
}

function _esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function _showJsonExportDialog(title, data) {
  const json = JSON.stringify(data, null, 2);
  new Dialog({
    title,
    content: `<form><textarea style="width:100%;height:300px;font-family:monospace;font-size:0.82em;" readonly>${_esc(json)}</textarea></form>`,
    buttons: { close: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Close" } },
    default: "close",
    render: (html) => html.find("textarea").focus().select()
  }, { width: 600, height: 420, resizable: true }).render(true);
}

function _promptNewFolder(settingKey, parent) {
  new Dialog({
    title: "New Folder",
    content: `<form><div class="form-group"><label>Name</label><input type="text" name="folder" autofocus></div></form>`,
    buttons: {
      create: {
        icon: '<i class="fa-solid fa-folder-plus"></i>',
        label: "Create",
        callback: async (html) => {
          const name = String(html.find('input[name="folder"]').val() ?? "").trim();
          if (!name) return;
          const list = game.settings.get(MODULE, settingKey) ?? [];
          if (!list.includes(name)) list.push(name);
          await game.settings.set(MODULE, settingKey, list);
          parent?.render();
        }
      },
      cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel" }
    },
    default: "create"
  }).render(true);
}

function _showJsonImportDialog(title, onImport) {
  new Dialog({
    title,
    content: `<form><textarea style="width:100%;height:300px;font-family:monospace;font-size:0.82em;" placeholder="Paste JSON here..."></textarea></form>`,
    buttons: {
      import: {
        icon: '<i class="fa-solid fa-file-import"></i>',
        label: "Import",
        callback: (html) => {
          const raw = html.find("textarea").val();
          let data;
          try { data = JSON.parse(raw); }
          catch (e) { ui.notifications?.error(`Invalid JSON: ${e.message}`); return; }
          try { onImport(data); }
          catch (e) { ui.notifications?.error(`Import failed: ${e.message}`); }
        }
      },
      cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel" }
    },
    default: "import"
  }, { width: 600, height: 420, resizable: true }).render(true);
}

function _downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _openSpawnEditor(entry, onSubmit) {
  return new Promise((resolve) => {
    const opts = TEMPLATE_TYPES.map(t => `<option value="${t}" ${t === entry.templateType ? "selected" : ""}>${t}</option>`).join("");
    new Dialog({
      title: `Spawn Template: ${entry.name}`,
      content: `
        <form>
          <div class="form-group">
            <label>Shape</label>
            <select name="templateType">${opts}</select>
          </div>
          <div class="form-group">
            <label>Size (grid units)</label>
            <input type="number" name="size" value="${entry.size ?? 1}" step="any" min="0">
          </div>
        </form>`,
      buttons: {
        next: {
          icon: '<i class="fa-solid fa-arrow-right"></i>',
          label: "Configure Graphics",
          callback: async (html) => {
            entry.templateType = html.find('[name="templateType"]').val();
            entry.size = Number(html.find('[name="size"]').val()) || 1;
            const { openEntryGraphicsConfig } = await import("./graphics-config.mjs");
            openEntryGraphicsConfig(entry, async (saved) => {
              await onSubmit?.(saved);
              resolve(saved);
            });
          }
        },
        cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => resolve(null) }
      },
      close: () => resolve(null),
      default: "next"
    }).render(true);
  });
}

function _importSpawnLibrary(parent) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { ui.notifications?.error(`Invalid JSON: ${e.message}`); return; }
    const incoming = Array.isArray(data) ? data : [data];
    const lib = getSpawnLibrary();
    const existingIds = new Set(lib.map(e => e.id));
    for (const e of incoming) {
      if (!e || typeof e !== "object" || !e.graphicsState) continue;
      const dup = foundry.utils.duplicate(e);
      if (!dup.id || existingIds.has(dup.id)) dup.id = foundry.utils.randomID();
      lib.push(dup);
      existingIds.add(dup.id);
    }
    await setSpawnLibrary(lib);
    parent?.render(false);
    ui.notifications?.info(`Imported ${incoming.length} template${incoming.length === 1 ? "" : "s"}.`);
  });
  input.click();
}

function _exportLibrary() {
  _downloadJson("templatemacro-library.json", getLibrary());
}

function _importLibrary(parent) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { ui.notifications?.error(`Invalid JSON: ${e.message}`); return; }
    const incoming = Array.isArray(data) ? data : [data];
    const lib = getLibrary();
    const existingIds = new Set(lib.map(e => e.id));
    for (const e of incoming) {
      if (!e || typeof e !== "object" || !e.graphicsState) continue;
      const dup = foundry.utils.duplicate(e);
      if (!dup.id || existingIds.has(dup.id)) dup.id = foundry.utils.randomID();
      dup.protected = false;
      dup.protectedKind = null;
      lib.push(dup);
      existingIds.add(dup.id);
    }
    await setLibrary(lib);
    parent?.render(false);
    ui.notifications?.info(`Imported ${incoming.length} template${incoming.length === 1 ? "" : "s"}.`);
  });
  input.click();
}

function _kindNeedsPrompt(kind) {
  return kind === "danger" || kind === "status";
}

async function _promptForKind(entry) {
  if (entry.protectedKind === "danger") return _promptDangerous(entry);
  if (entry.protectedKind === "status") return _promptStatus(entry);
  return null;
}

function _suggestName(src, overrides) {
  if (src.protectedKind === "danger" && overrides?.damageType) {
    const dt = overrides.damageType.charAt(0).toUpperCase() + overrides.damageType.slice(1);
    return `${dt} ${overrides.damageValue ?? ""}`.trim();
  }
  if (src.protectedKind === "status" && overrides?.statusEffects?.length) {
    return overrides.statusEffects.join(", ");
  }
  return `${src.name} (copy)`;
}

function _promptDangerous(entry) {
  return new Promise(resolve => {
    const opts = DAMAGE_TYPES.map(d => `<option value="${d}" ${d === entry.damageType ? "selected" : ""}>${d}</option>`).join("");
    new Dialog({
      title: `Activate: ${entry.name}`,
      content: `
        <form>
          <div class="form-group">
            <label>Damage Type</label>
            <select name="damageType">${opts}</select>
          </div>
          <div class="form-group">
            <label>Damage Value</label>
            <input type="number" name="damageValue" value="${entry.damageValue ?? 5}" min="0">
          </div>
        </form>`,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Activate",
          callback: (html) => resolve({
            damageType: html.find('[name="damageType"]').val(),
            damageValue: Number(html.find('[name="damageValue"]').val()) || 0
          })
        },
        cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => resolve(null) }
      },
      close: () => resolve(null),
      default: "ok"
    }).render(true);
  });
}

function _promptStatus(entry) {
  return new Promise(resolve => {
    const statusEffects = CONFIG.statusEffects || [];
    const rows = statusEffects.map(s => {
      let label = s.name || s.label || s.id;
      if (typeof label === "string" && label.startsWith("lancer.")) label = label.split(".").pop();
      label = label.charAt(0).toUpperCase() + label.slice(1);
      return { id: s.id, label };
    }).sort((a, b) => a.label.localeCompare(b.label));
    const opts = rows.map(r => {
      const sel = (entry.statusEffects ?? []).includes(r.id) ? "selected" : "";
      return `<option value="${r.id}" ${sel}>${r.label}</option>`;
    }).join("");
    new Dialog({
      title: `Activate: ${entry.name}`,
      content: `
        <form>
          <div class="form-group">
            <label>Status Effects (Ctrl+Click for multiple)</label>
            <select name="statusEffects" multiple size="8" style="width:100%">${opts}</select>
          </div>
        </form>`,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Activate",
          callback: (html) => {
            const vals = html.find('[name="statusEffects"]').val() || [];
            resolve({ statusEffects: Array.isArray(vals) ? vals : [vals] });
          }
        },
        cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => resolve(null) }
      },
      close: () => resolve(null),
      default: "ok"
    }).render(true);
  });
}


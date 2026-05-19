// Shared tabbed V2 form for editing templateMacro graphics options.
// Reused for per-template config, world defaults, and placement-time overrides.

import { MODULE, LINE_TYPES, TRIGGERS } from "../constants.mjs";
import { FILL_TYPES, DEFAULT_PATTERN_TEXTURE } from "../patternFill.mjs";
import { buildPulseAnimation, hexToInt, sampleColorAnimation } from "../color-animation.mjs";
import { easingFunctions } from "../easing.mjs";

const EASING_BUTTONS = [
  { key: "linear",         label: "Linear",       svg: "M0,100 L100,0" },
  { key: "easeInCubic",    label: "Ease In",      svg: "M0,100 C32,100 67,100 100,0" },
  { key: "easeOutCubic",   label: "Ease Out",     svg: "M0,100 C33,0 68,0 100,0" },
  { key: "easeInOutCubic", label: "Ease In/Out",  svg: "M0,100 C65,100 35,0 100,0" }
];

function intToHex(n) {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function rgbaCss(n, alpha = 1) {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

const MODES = { TEMPLATE: "template", DEFAULTS: "defaults", PLACEMENT: "placement", ENTRY: "entry" };

const ZONE_LABELS = {
  danger: "Dangerous Zone",
  status: "Status Zone",
  difficult: "Difficult Terrain"
};

const EASING_OPTIONS = [
  { value: "linear", label: "Linear" },
  { value: "easeInQuad", label: "Ease In Quad" },
  { value: "easeOutQuad", label: "Ease Out Quad" },
  { value: "easeInOutQuad", label: "Ease In/Out Quad" },
  { value: "easeInCubic", label: "Ease In Cubic" },
  { value: "easeOutCubic", label: "Ease Out Cubic" },
  { value: "easeInOutCubic", label: "Ease In/Out Cubic" }
];

const ACTION_TYPES = { CODE: "code", MACRO: "macro", EFFECT: "effect" };

const ACTION_ICON = {
  [ACTION_TYPES.CODE]: "fa-code",
  [ACTION_TYPES.MACRO]: "fa-cube",
  [ACTION_TYPES.EFFECT]: "fa-bolt"
};

function makeAction(overrides = {}) {
  return {
    id: foundry.utils.randomID(),
    trigger: "whenEntered",
    actionType: ACTION_TYPES.CODE,
    targetFilter: "ALL",
    asGM: false,
    code: "",
    macroUuid: "",
    effectName: "",
    effectMode: "apply",
    ...overrides
  };
}

function _listTargetFilterGroups() {
  const flat = [{ value: "ALL", label: "All" }];
  const groups = [
    { label: "Token Disposition", options: [
      { value: "FRIENDLY", label: "Friendly" },
      { value: "NEUTRAL", label: "Neutral" },
      { value: "HOSTILE", label: "Hostile" }
    ]}
  ];
  const types = Object.keys(game.model?.Actor ?? {}).filter(t => t !== "base");
  if (types.length) {
    groups.push({ label: "Type", options: types.map(t => {
      const localized = game.i18n.localize(`TYPES.Actor.${t}`);
      return { value: `ACTORTYPE_${t}`, label: localized === `TYPES.Actor.${t}` ? t : localized };
    })});
  }
  // advanced teams from token-factions, only when "color-from" is set to advanced-factions
  if (game.modules.get("token-factions")?.active) {
    let useAdvanced = false;
    try { useAdvanced = game.settings.get("token-factions", "color-from") === "advanced-factions"; }
    catch { /* setting missing */ }
    if (useAdvanced) {
      let teams = [];
      try { teams = game.settings.get("token-factions", "team-setup") ?? []; }
      catch { /* setting missing */ }
      if (teams.length) {
        groups.push({ label: "Advanced Team", options: teams.filter(t => t?.id).map(t => ({ value: `TEAM_${t.id}`, label: t.name ?? t.id })) });
      }
    }
  }
  return { flat, groups };
}

const DEFAULT_STATE = () => ({
  // Entry mode (library entry editing)
  entryName: "New Template",
  entryIcon: "fa-circle",
  // Native MeasuredTemplate fields (template mode only)
  t: "circle",
  x: 0,
  y: 0,
  elevation: 0,
  sort: 0,
  direction: 0,
  angle: 0,
  distance: 1,
  width: 1,
  borderColorNative: "#000000",
  fillColorNative: "#0d0d0d",
  textureNative: "",
  hidden: false,
  attachedTokenId: "",
  // Rendering mode
  useCustomRender: false,
  // Geometry
  radiusOffset: 0,
  // Border
  lineType: LINE_TYPES.SOLID,
  lineWidth: 2,
  lineColor: "#000000",
  lineOpacity: 0.5,
  lineDashSize: 15,
  lineGapSize: 10,
  lineDashOffsetAnimation: 0,
  lineColorAnimation: null,
  // Fill
  fillType: FILL_TYPES.SOLID,
  fillColor: "#000000",
  fillOpacity: 0.25,
  fillColorAnimation: null,
  fillTexture: DEFAULT_PATTERN_TEXTURE,
  fillTextureOffset: { x: 0, y: 0 },
  fillTextureOffsetAnimation: null,
  fillTextureScale: { x: 100, y: 100 },
  // Label
  centerLabel: "",
  // Misc (elevationruler integration)
  movementPenalty: 0,
  flatMovementPenalty: true,
  elevationGated: false,
  elevationRangeManual: false,
  elevationRange: 0,
  innerRadius: 0,
  // Actions (template mode only)
  actions: []
});

function settingKey(zoneType, field) {
  const prefix = zoneType === "difficult" ? "difficultTerrainDefault" : `${zoneType}ZoneDefault`;
  return `${prefix}${field}`;
}

function readDefaults(zoneType) {
  const state = DEFAULT_STATE();
  for (const field of Object.keys(state)) {
    if (field === "macros") continue;
    const key = settingKey(zoneType, field.charAt(0).toUpperCase() + field.slice(1));
    try {
      const value = game.settings.get(MODULE, key);
      if (value !== undefined && value !== null) state[field] = value;
    } catch {
      // Setting not registered, fall back to default
    }
  }
  return state;
}

function readTemplateDoc(doc) {
  const state = DEFAULT_STATE();
  const flag = (key, fallback) => doc.getFlag(MODULE, key) ?? fallback;
  // Native template fields
  state.t = doc.t ?? "circle";
  state.x = doc.x ?? 0;
  state.y = doc.y ?? 0;
  state.elevation = doc.elevation ?? 0;
  state.sort = doc.sort ?? 0;
  state.direction = doc.direction ?? 0;
  state.angle = doc.angle ?? 0;
  state.distance = doc.distance ?? 1;
  state.width = doc.width ?? 1;
  state.borderColorNative = doc.borderColor ?? "#000000";
  state.fillColorNative = doc.fillColor ?? "#0d0d0d";
  state.textureNative = doc.texture ?? "";
  state.hidden = !!doc.hidden;
  state.attachedTokenId = flag("attachedTokenId", "");
  state.useCustomRender = !!flag("useCustomRender", false);
  state.radiusOffset = flag("radiusOffset", 0);
  state.lineType = flag("lineType", LINE_TYPES.SOLID);
  state.lineWidth = flag("lineWidth", 2);
  state.lineColor = flag("lineColor", doc.borderColor ?? "#000000");
  state.lineOpacity = flag("lineOpacity", doc.getFlag(MODULE, "borderOpacity") ?? 0.5);
  state.lineDashSize = flag("lineDashSize", 15);
  state.lineGapSize = flag("lineGapSize", 10);
  state.lineDashOffsetAnimation = flag("lineDashOffsetAnimation", 0);
  state.lineColorAnimation = flag("lineColorAnimation", null);
  state.fillType = flag("fillType", FILL_TYPES.SOLID);
  state.fillColor = flag("fillColor", doc.fillColor ?? "#000000");
  state.fillOpacity = flag("fillOpacity", 0.25);
  state.fillColorAnimation = flag("fillColorAnimation", null);
  state.fillTexture = flag("fillTexture", DEFAULT_PATTERN_TEXTURE);
  state.fillTextureOffset = flag("fillTextureOffset", { x: 0, y: 0 });
  state.fillTextureOffsetAnimation = flag("fillTextureOffsetAnimation", null);
  state.fillTextureScale = flag("fillTextureScale", { x: 100, y: 100 });
  state.centerLabel = flag("centerLabel", "");
  state.movementPenalty = doc.getFlag("elevationruler", "movementPenalty") ?? 0;
  state.flatMovementPenalty = doc.getFlag("elevationruler", "flatMovementPenalty") ?? true;
  state.elevationGated = !!flag("elevationGated", false);
  state.elevationRangeManual = !!flag("elevationRangeManual", false);
  state.elevationRange = flag("elevationRange", 0);
  state.innerRadius = flag("innerRadius", 0);

  const storedActions = flag("actions", null);
  if (Array.isArray(storedActions) && storedActions.length) {
    state.actions = storedActions.map(a => makeAction(a));
  } else {
    state.actions = [];
    for (const trig of TRIGGERS) {
      if (trig === "never") continue;
      const legacy = doc.getFlag(MODULE, trig);
      if (legacy?.command) {
        state.actions.push(makeAction({
          trigger: trig,
          actionType: ACTION_TYPES.CODE,
          code: legacy.command,
          asGM: !!legacy.asGM
        }));
      }
    }
  }
  return state;
}

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TemplatemacroGraphicsConfig extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    id: "templatemacro-graphics-config",
    classes: ["templatemacro", "tmac-graphics-config"],
    tag: "form",
    window: { title: "Template Macro Sheet", resizable: true },
    position: { width: 640, height: "auto" },
    form: {
      handler: TemplatemacroGraphicsConfig._formHandler,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: { template: "modules/templatemacro/templates/graphics-config.html" }
  };

  constructor(options = {}) {
    super(options);
    // V2 doc-sheet path passes {document}; other modes pass {mode, target, zoneType, onSubmit}
    if (options.document?.documentName === "MeasuredTemplate") {
      this.mode = MODES.TEMPLATE;
      this.target = options.document;
    } else {
      this.mode = options.mode ?? MODES.TEMPLATE;
      this.target = options.target;
      this.zoneType = options.zoneType;
      this.onSubmit = options.onSubmit;
    }
    this._formState = this._initState();
    this._activeTab = this.mode === MODES.TEMPLATE ? "template" : "geometry";
    this._editingActionId = null;
    if (this.mode === MODES.TEMPLATE && this.target?.documentName === "MeasuredTemplate") {
      this._saved = false;
      this._originalSnapshot = this._captureDocSnapshot();
    }
  }

  // bypass doc-sheet defaults that assume a real document with .pack/.testUserPermission
  get isEditable() { return true; }
  _canRender() { return true; }
  _canUserView() { return true; }
  _canUserEdit() { return true; }

  // DocumentSheetV2 expects a real document; supply a synthetic stub for non-template modes
  _initializeApplicationOptions(options) {
    if (!options.document) {
      const stubId = foundry.utils.randomID();
      options.document = {
        uuid: `templatemacro.${options.mode ?? "entry"}.${stubId}`,
        id: stubId,
        apps: {},
        pack: null,
        testUserPermission: () => true,
        getFlag: () => undefined,
        constructor: { metadata: { label: "Template" } }
      };
    }
    return super._initializeApplicationOptions(options);
  }

  _captureDocSnapshot() {
    const doc = this.target;
    return foundry.utils.deepClone({
      t: doc.t, x: doc.x, y: doc.y, elevation: doc.elevation, sort: doc.sort,
      direction: doc.direction, angle: doc.angle, distance: doc.distance, width: doc.width,
      borderColor: doc.borderColor, fillColor: doc.fillColor, texture: doc.texture, hidden: doc.hidden,
      tmacFlags: doc.flags?.templatemacro ?? {},
      tokenmagicFlags: doc.flags?.tokenmagic ?? null,
      elevationrulerFlags: doc.flags?.elevationruler ?? null
    });
  }

  _initState() {
    if (this.mode === MODES.TEMPLATE && this.target?.documentName === "MeasuredTemplate")
      return readTemplateDoc(this.target);
    if (this.mode === MODES.DEFAULTS && this.zoneType)
      return readDefaults(this.zoneType);
    if (this.mode === MODES.PLACEMENT && this.target && typeof this.target === "object")
      return { ...DEFAULT_STATE(), ...this.target };
    if (this.mode === MODES.ENTRY && this.target && typeof this.target === "object") {
      return {
        ...DEFAULT_STATE(),
        ...(this.target.graphicsState ?? {}),
        entryName: this.target.name ?? "New Template",
        entryIcon: this.target.icon ?? "fa-circle"
      };
    }
    return DEFAULT_STATE();
  }

  get title() {
    if (this.mode === MODES.TEMPLATE) {
      const t = this.target;
      return t?.id ? `Template Macro: ${t.t ?? "Template"} @ ${t.x},${t.y}` : "Template Macro Sheet";
    }
    const z = ZONE_LABELS[this.zoneType] ?? "Zone";
    if (this.mode === MODES.DEFAULTS) return `${z} Defaults`;
    return `${z} Graphics`;
  }

  async _prepareContext() {
    const s = this._formState;
    const showMacros = this.mode === MODES.TEMPLATE || this.mode === MODES.PLACEMENT || this.mode === MODES.ENTRY;
    const showTemplate = this.mode === MODES.TEMPLATE;
    const showEntryHeader = this.mode === MODES.ENTRY;
    const templateTypes = [
      { value: "circle", label: "Circle", selected: s.t === "circle" },
      { value: "rect", label: "Rectangle", selected: s.t === "rect" },
      { value: "cone", label: "Cone", selected: s.t === "cone" },
      { value: "ray", label: "Ray", selected: s.t === "ray" }
    ];
    const sceneTokens = (showTemplate && this.target?.parent?.tokens?.contents) || [];
    const tokenOptions = sceneTokens.map(t => ({
      value: t.id,
      label: t.name,
      selected: t.id === s.attachedTokenId
    }));
    tokenOptions.unshift({ value: "", label: "None", selected: !s.attachedTokenId });
    const lineEasing = s.lineColorAnimation?.easingFunc;
    const fillEasing = s.fillColorAnimation?.easingFunc;
    const triggerOptions = TRIGGERS.filter(t => t !== "never").map(t => ({ value: t, label: t }));
    const actionTypeOptions = [
      { value: ACTION_TYPES.CODE, label: "Code" },
      { value: ACTION_TYPES.MACRO, label: "Macro" },
      { value: ACTION_TYPES.EFFECT, label: "Effect" }
    ];
    const effectModeOptions = [
      { value: "apply", label: "Apply" },
      { value: "remove", label: "Remove" }
    ];
    const _filters = _listTargetFilterGroups();
    const actionRows = (s.actions ?? []).map((a, i) => {
      const macroName = a.actionType === ACTION_TYPES.MACRO && a.macroUuid
        ? (fromUuidSync(a.macroUuid)?.name ?? a.macroUuid)
        : "";
      const summary = a.actionType === ACTION_TYPES.CODE
        ? (a.code?.split("\n")[0]?.trim().slice(0, 60) || "(empty)")
        : a.actionType === ACTION_TYPES.MACRO
          ? (macroName || "(no macro)")
          : (a.effectName || "(no effect)");
      return {
        index: i,
        ...a,
        icon: ACTION_ICON[a.actionType] ?? "fa-code",
        summary,
        editing: this._editingActionId === a.id,
        triggerOptions: triggerOptions.map(o => ({ ...o, selected: o.value === a.trigger })),
        actionTypeOptions: actionTypeOptions.map(o => ({ ...o, selected: o.value === a.actionType })),
        effectModeOptions: effectModeOptions.map(o => ({ ...o, selected: o.value === a.effectMode })),
        targetFilterFlat: _filters.flat.map(o => ({ ...o, selected: o.value === (a.targetFilter ?? "ALL") })),
        targetFilterGroups: _filters.groups.map(g => ({
          label: g.label,
          options: g.options.map(o => ({ ...o, selected: o.value === (a.targetFilter ?? "ALL") }))
        })),
        isCode: a.actionType === ACTION_TYPES.CODE,
        isMacro: a.actionType === ACTION_TYPES.MACRO,
        isEffect: a.actionType === ACTION_TYPES.EFFECT
      };
    });
    return {
      mode: this.mode,
      showMacros,
      showTemplate,
      showEntryHeader,
      isTemplateMode: this.mode === MODES.TEMPLATE,
      hasMovementRuler: !!game.modules.get("elevationruler")?.active,
      isCircle: s.t === "circle",
      templateTypes,
      tokenOptions,
      state: s,
      activeTab: this._activeTab,
      lineTypes: [
        { value: LINE_TYPES.NONE, label: "None", selected: s.lineType === LINE_TYPES.NONE },
        { value: LINE_TYPES.SOLID, label: "Solid", selected: s.lineType === LINE_TYPES.SOLID },
        { value: LINE_TYPES.DASHED, label: "Dashed", selected: s.lineType === LINE_TYPES.DASHED }
      ],
      fillTypes: [
        { value: FILL_TYPES.NONE, label: "None", selected: s.fillType === FILL_TYPES.NONE },
        { value: FILL_TYPES.SOLID, label: "Solid", selected: s.fillType === FILL_TYPES.SOLID },
        { value: FILL_TYPES.PATTERN, label: "Pattern", selected: s.fillType === FILL_TYPES.PATTERN }
      ],
      lineEasings: EASING_OPTIONS.map(e => ({ ...e, selected: e.value === lineEasing })),
      fillEasings: EASING_OPTIONS.map(e => ({ ...e, selected: e.value === fillEasing })),
      actionRows,
      lineAnimationOn: !!s.lineColorAnimation,
      fillAnimationOn: !!s.fillColorAnimation,
      textureOffsetAnimationOn: !!s.fillTextureOffsetAnimation,
      hasTexture: s.fillType === FILL_TYPES.PATTERN,
      hasLine: s.lineType !== LINE_TYPES.NONE,
      isDashed: s.lineType === LINE_TYPES.DASHED
    };
  }

  _onRender(_context, _options) {
    const html = $(this.element);

    html.find("[data-tmac-tab]").on("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const tab = ev.currentTarget.dataset.tmacTab;
      this._activeTab = tab;
      html.find("[data-tmac-tab]").removeClass("active");
      html.find(`[data-tmac-tab="${tab}"]`).addClass("active");
      html.find("[data-tmac-pane]").hide();
      html.find(`[data-tmac-pane="${tab}"]`).show();
    });
    html.find(`[data-tmac-tab="${this._activeTab}"]`).addClass("active");
    html.find("[data-tmac-pane]").hide();
    html.find(`[data-tmac-pane="${this._activeTab}"]`).show();

    html.find("input[name='useCustomRender']").on("change", (ev) => {
      this._snapshot(html);
      this._formState.useCustomRender = !!ev.currentTarget.checked;
      this.render();
    });

    html.find("select[name='lineType']").on("change", (ev) => {
      this._snapshot(html);
      this._formState.lineType = Number(ev.currentTarget.value);
      this.render();
    });
    html.find("select[name='fillType']").on("change", (ev) => {
      this._snapshot(html);
      this._formState.fillType = Number(ev.currentTarget.value);
      this.render();
    });

    html.find("[data-tmac-toggle-anim='line']").on("click", () => {
      this._snapshot(html);
      this._formState.lineColorAnimation = this._formState.lineColorAnimation
        ? null
        : buildPulseAnimation(this._formState.lineColor, this._formState.lineOpacity, 2500);
      this.render();
    });
    html.find("[data-tmac-toggle-anim='fill']").on("click", () => {
      this._snapshot(html);
      this._formState.fillColorAnimation = this._formState.fillColorAnimation
        ? null
        : buildPulseAnimation(this._formState.fillColor, this._formState.fillOpacity, 2500);
      this.render();
    });
    html.find("[data-tmac-toggle-anim='offset']").on("click", () => {
      this._snapshot(html);
      this._formState.fillTextureOffsetAnimation = this._formState.fillTextureOffsetAnimation ? null : { x: 30, y: 0 };
      this.render();
    });

    html.find("[data-tmac-add-kf]").on("click", (ev) => {
      this._snapshot(html);
      const which = ev.currentTarget.dataset.tmacAddKf;
      const anim = this._formState[which];
      if (!anim) return;
      const last = anim.keyframes.at(-1);
      anim.keyframes.push({ color: last.color, alpha: last.alpha, position: Math.min(1, last.position + 0.1) });
      this.render();
    });
    html.find("[data-tmac-remove-kf]").on("click", (ev) => {
      this._snapshot(html);
      const which = ev.currentTarget.dataset.tmacRemoveKf;
      const idx = Number(ev.currentTarget.dataset.tmacKfIndex);
      const anim = this._formState[which];
      if (!anim || anim.keyframes.length <= 1) return;
      anim.keyframes.splice(idx, 1);
      this.render();
    });

    html.find("[data-tmac-action-add]").on("click", () => {
      this._snapshot(html);
      const newAction = makeAction();
      this._formState.actions.push(newAction);
      this._editingActionId = newAction.id;
      this._activeTab = "macros";
      this.render();
    });

    html.find("[data-tmac-action-edit]").on("click", (ev) => {
      this._snapshot(html);
      const id = ev.currentTarget.dataset.tmacActionEdit;
      this._editingActionId = this._editingActionId === id ? null : id;
      this.render();
    });

    html.find("[data-tmac-action-remove]").on("click", (ev) => {
      this._snapshot(html);
      const id = ev.currentTarget.dataset.tmacActionRemove;
      this._formState.actions = this._formState.actions.filter(a => a.id !== id);
      if (this._editingActionId === id) this._editingActionId = null;
      this.render();
    });

    html.find("[data-tmac-action-duplicate]").on("click", (ev) => {
      this._snapshot(html);
      const id = ev.currentTarget.dataset.tmacActionDuplicate;
      const src = this._formState.actions.find(a => a.id === id);
      if (!src) return;
      const dup = makeAction({ ...src, id: undefined });
      this._formState.actions.push(dup);
      this._editingActionId = dup.id;
      this.render();
    });

    html.find("[data-tmac-action-actiontype]").on("change", (ev) => {
      this._snapshot(html);
      const id = ev.currentTarget.dataset.tmacActionActiontype;
      const action = this._formState.actions.find(a => a.id === id);
      if (action) action.actionType = ev.currentTarget.value;
      this.render();
    });

    html.find(".tmac-file-pick").on("click", (ev) => {
      ev.preventDefault();
      const target = ev.currentTarget.dataset.target;
      const input = html.find(`input[name='${target}']`)[0];
      new FilePicker({
        type: "imagevideo",
        current: input?.value,
        callback: (path) => { if (input) input.value = path; }
      }).browse();
    });

    html.find(".tmac-entry-pick-icon").on("click", (ev) => {
      ev.preventDefault();
      const input = html.find('input[name="entryIcon"]')[0];
      new FilePicker({
        type: "image",
        current: input?.value,
        callback: (path) => { if (input) input.value = path; }
      }).browse();
    });

    html.find(".tmac-macro-input").on("dragover", (ev) => ev.preventDefault());
    html.find(".tmac-macro-input").on("drop", async (ev) => {
      ev.preventDefault();
      let data;
      try { data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); } catch { return; }
      if (data?.type !== "Macro") return;
      const uuid = data.uuid ?? `Macro.${data.id}`;
      ev.currentTarget.value = uuid;
      const id = ev.currentTarget.dataset.tmacActionMacro;
      const action = this._formState.actions.find(a => a.id === id);
      if (action) action.macroUuid = uuid;
      this.render();
    });

    this._mountAnimPreview(html, "line");
    this._mountAnimPreview(html, "fill");
    this._startAnimTracker(html);

    if (this.mode === MODES.TEMPLATE) {
      html.on("change", "input, select, color-picker, range-picker, textarea", () => this._scheduleLiveApply({ snapshot: true }));
      html.find(".tmac-sheet-export").on("click", (ev) => {
        ev.preventDefault();
        this._exportSheet();
      });
      html.find(".tmac-sheet-import").on("click", (ev) => {
        ev.preventDefault();
        this._importSheet();
      });
      html.find(".tmac-sheet-save-preset").on("click", (ev) => {
        ev.preventDefault();
        this._saveAsPreset();
      });
      html.find(".tmac-sheet-save-spawn").on("click", (ev) => {
        ev.preventDefault();
        this._saveAsSpawn();
      });
    }
  }

  _buildEntryFromSheet() {
    const s = this._formState;
    const KEYS = [
      "useCustomRender", "radiusOffset",
      "lineType", "lineWidth", "lineColor", "lineOpacity",
      "lineDashSize", "lineGapSize", "lineDashOffsetAnimation", "lineColorAnimation",
      "fillType", "fillColor", "fillOpacity", "fillColorAnimation",
      "fillTexture", "fillTextureOffset", "fillTextureOffsetAnimation", "fillTextureScale",
      "centerLabel", "movementPenalty", "flatMovementPenalty", "elevationGated", "elevationRangeManual", "elevationRange", "innerRadius", "actions"
    ];
    const graphicsState = {};
    for (const k of KEYS) graphicsState[k] = s[k];
    return { graphicsState };
  }

  async _saveAsPreset() {
    const { makeEntry, getLibrary, setLibrary } = await import("./template-library.mjs");
    const name = await this._promptName("Save as Preset", "New Preset");
    if (name === null) return;
    const entry = makeEntry({ name, icon: "fa-circle" });
    Object.assign(entry.graphicsState, this._buildEntryFromSheet().graphicsState);
    const lib = getLibrary();
    lib.push(entry);
    await setLibrary(lib);
    ui.notifications?.info(`Saved "${name}" to library presets.`);
  }

  async _saveAsSpawn() {
    const { getSpawnLibrary, setSpawnLibrary } = await import("./template-library.mjs");
    const s = this._formState;
    return new Promise((resolve) => {
      const tMap = { circle: "Blast", rect: "Blast", cone: "Cone", ray: "Line" };
      const t = tMap[s.t] ?? "Blast";
      const opts = ["Blast", "Burst", "Cone", "Line"].map(x => `<option value="${x}" ${x === t ? "selected" : ""}>${x}</option>`).join("");
      new Dialog({
        title: "Save as Library Template",
        content: `
          <form>
            <div class="form-group">
              <label>Name</label>
              <input type="text" name="name" value="${(s.entryName ?? "New Template")}">
            </div>
            <div class="form-group">
              <label>Shape</label>
              <select name="shape">${opts}</select>
            </div>
            <div class="form-group">
              <label>Size (grid units)</label>
              <input type="number" name="size" value="${s.distance ?? 1}" step="any" min="0">
            </div>
          </form>`,
        buttons: {
          save: {
            icon: '<i class="fa-solid fa-save"></i>',
            label: "Save",
            callback: async (html) => {
              const name = html.find('[name="name"]').val() || "New Template";
              const shape = html.find('[name="shape"]').val() || "Blast";
              const size = Number(html.find('[name="size"]').val()) || 1;
              const entry = {
                id: foundry.utils.randomID(),
                name,
                icon: "fa-circle",
                size,
                templateType: shape,
                graphicsState: this._buildEntryFromSheet().graphicsState
              };
              const lib = getSpawnLibrary();
              lib.push(entry);
              await setSpawnLibrary(lib);
              ui.notifications?.info(`Saved "${name}" to library templates.`);
              resolve();
            }
          },
          cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => resolve() }
        },
        default: "save",
        close: () => resolve()
      }).render(true);
    });
  }

  _promptName(title, def) {
    return new Promise((resolve) => {
      new Dialog({
        title,
        content: `<form><div class="form-group"><label>Name</label><input type="text" name="name" value="${def}"></div></form>`,
        buttons: {
          save: { icon: '<i class="fa-solid fa-save"></i>', label: "Save", callback: (html) => resolve(html.find('[name="name"]').val() || def) },
          cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => resolve(null) }
        },
        default: "save",
        close: () => resolve(null)
      }).render(true);
    });
  }

  _buildSheetPayload() {
    const doc = this.target;
    if (doc?.documentName !== "MeasuredTemplate") return null;
    return {
      schema: "templatemacro-sheet/1",
      borderColor: doc.borderColor,
      fillColor: doc.fillColor,
      texture: doc.texture,
      hidden: doc.hidden,
      flags: {
        templatemacro: doc.flags?.templatemacro ?? {},
        elevationruler: doc.flags?.elevationruler ?? null,
        tokenmagic: doc.flags?.tokenmagic ?? null
      }
    };
  }

  _exportSheet() {
    const payload = this._buildSheetPayload();
    if (!payload) return;
    const json = JSON.stringify(payload, null, 2);
    const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    new Dialog({
      title: "Export Template",
      content: `<form><textarea style="width:100%;height:300px;font-family:monospace;font-size:0.82em;" readonly>${esc(json)}</textarea></form>`,
      buttons: { close: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Close" } },
      default: "close",
      render: (html) => html.find("textarea").focus().select()
    }, { width: 600, height: 420, resizable: true }).render(true);
  }

  _importSheet() {
    const doc = this.target;
    if (!doc) return;
    new Dialog({
      title: "Import Template",
      content: `<form><textarea style="width:100%;height:300px;font-family:monospace;font-size:0.82em;" placeholder="Paste JSON here..."></textarea></form>`,
      buttons: {
        import: {
          icon: '<i class="fa-solid fa-file-import"></i>',
          label: "Import",
          callback: async (html) => {
            const raw = html.find("textarea").val();
            let data;
            try { data = JSON.parse(raw); }
            catch (e) { ui.notifications?.error(`Invalid JSON: ${e.message}`); return; }
            if (!data || typeof data !== "object" || !data.flags?.templatemacro) {
              ui.notifications?.error("Not a template-macro sheet export.");
              return;
            }
            const update = {};
            if (data.borderColor) update.borderColor = data.borderColor;
            if (data.fillColor) update.fillColor = data.fillColor;
            if (typeof data.texture === "string") update.texture = data.texture;
            if (typeof data.hidden === "boolean") update.hidden = data.hidden;
            update["flags.templatemacro"] = data.flags.templatemacro;
            if (data.flags.elevationruler) update["flags.elevationruler"] = data.flags.elevationruler;
            if (data.flags.tokenmagic) update["flags.tokenmagic"] = data.flags.tokenmagic;
            await doc.update(update);
            this._formState = this._initState();
            this.render();
            ui.notifications?.info("Template imported.");
          }
        },
        cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel" }
      },
      default: "import"
    }, { width: 600, height: 420, resizable: true }).render(true);
  }

  _scheduleLiveApply({ snapshot = false } = {}) {
    if (this.mode !== MODES.TEMPLATE) return;
    if (this._livePending) clearTimeout(this._livePending);
    this._livePending = setTimeout(() => {
      this._livePending = null;
      if (snapshot && this.element) this._snapshot($(this.element));
      this._saveTemplate().catch(e => console.warn("templatemacro | live apply failed", e));
    }, 80);
  }

  // V2: refresh transform state from the doc when reopening (Foundry caches doc.sheet)
  async _preFirstRender(_context, _options) {
    if (this.mode !== MODES.TEMPLATE || this.target?.documentName !== "MeasuredTemplate") return;
    const doc = this.target;
    const s = this._formState;
    s.t = doc.t ?? s.t;
    s.x = doc.x ?? s.x;
    s.y = doc.y ?? s.y;
    s.elevation = doc.elevation ?? s.elevation;
    s.sort = doc.sort ?? s.sort;
    s.direction = doc.direction ?? s.direction;
    s.angle = doc.angle ?? s.angle;
    s.distance = doc.distance ?? s.distance;
    s.width = doc.width ?? s.width;
    this._originalSnapshot = this._captureDocSnapshot();
    this._saved = false;
  }

  async _preClose() {
    this._stopAnimTracker?.();
    if (this._livePending) { clearTimeout(this._livePending); this._livePending = null; }
    if (this.mode === MODES.TEMPLATE && this._originalSnapshot && !this._saved) {
      try { await this._revertToSnapshot(); }
      catch (e) { console.warn("templatemacro | revert failed", e); }
    }
  }

  async _revertToSnapshot() {
    const snap = this._originalSnapshot;
    if (!snap) return;
    // only roll back graphics + flag state. transform fields (x/y/elevation/distance/etc.) belong to
    // drag/scale interactions and must not be reverted by closing the sheet.
    const update = {
      borderColor: snap.borderColor, fillColor: snap.fillColor,
      texture: snap.texture, hidden: snap.hidden,
      "flags.templatemacro": snap.tmacFlags ?? {}
    };
    if (snap.tokenmagicFlags !== null) update["flags.tokenmagic"] = snap.tokenmagicFlags;
    if (snap.elevationrulerFlags !== null) update["flags.elevationruler"] = snap.elevationrulerFlags;
    await this.target.update(update);
  }

  _animKey(which) {
    return `${which}ColorAnimation`;
  }

  _mountAnimPreview(html, which) {
    const root = html.find(`.tmac-anim-preview[data-tmac-anim="${which}"]`);
    if (!root.length) return;
    const anim = this._formState[this._animKey(which)];
    if (!anim) return;
    this._selectedKfIdx ??= {};
    this._selectedKfIdx[which] ??= 0;
    if (this._selectedKfIdx[which] >= anim.keyframes.length) this._selectedKfIdx[which] = 0;
    this._renderAnimPreviewInto(root, which);
    this._attachAnimPreviewHandlers(root, which);
  }

  _renderAnimPreviewInto(root, which) {
    const anim = this._formState[this._animKey(which)];
    if (!anim) { root.empty(); return; }
    const sel = this._selectedKfIdx[which] ?? 0;
    const sorted = anim.keyframes.slice().sort((a, b) => a.position - b.position);
    const stops = sorted.map(k => {
      const c = typeof k.color === "number" ? k.color : hexToInt(k.color);
      return `${rgbaCss(c, k.alpha)} ${Math.round(k.position * 100)}%`;
    }).join(", ");

    const easingBtns = EASING_BUTTONS.map(b => `
      <button type="button" class="tmac-anim-ease-btn ${b.key === anim.easingFunc ? "active" : ""}"
              data-tmac-easing="${b.key}" title="${b.label}">
        <svg viewBox="-10 -10 120 120"><path d="${b.svg}"></path></svg>
      </button>`).join("");

    const thumbs = anim.keyframes.map((k, i) => {
      const c = typeof k.color === "number" ? k.color : hexToInt(k.color);
      return `<div class="tmac-anim-thumb ${i === sel ? "active" : ""}"
                   data-tmac-thumb="${i}"
                   style="left:${Math.round(k.position * 100)}%; background: ${rgbaCss(c, 1)};"></div>`;
    }).join("");

    const selKf = anim.keyframes[sel] ?? anim.keyframes[0];
    const selColor = typeof selKf?.color === "number" ? intToHex(selKf.color) : (selKf?.color ?? "#ff0000");

    root.html(`
      <div class="tmac-anim-controls">
        <input type="number" class="tmac-anim-duration" min="100" step="100" value="${anim.duration}">
        <span class="tmac-unit">ms</span>
        <div class="tmac-anim-easings">${easingBtns}</div>
      </div>
      <p class="hint">Click the bar to add a keyframe, right-click a thumb to delete, drag to reposition.</p>
      <div class="tmac-anim-track-wrap">
        <div class="tmac-anim-track" style="background: linear-gradient(to right, ${stops || "#888 0%"});"></div>
        <div class="tmac-anim-tracker"></div>
        ${thumbs}
      </div>
      <div class="tmac-anim-selected">
        <label>Pos</label>
        <input type="number" class="tmac-anim-sel-pos" min="0" max="100" step="1" value="${Math.round((selKf?.position ?? 0) * 100)}">
        <span class="tmac-unit">%</span>
        <label>Color</label>
        <color-picker class="tmac-anim-sel-color" value="${selColor}"></color-picker>
        <label>α</label>
        <input type="number" class="tmac-anim-sel-alpha" min="0" max="1" step="0.05" value="${selKf?.alpha ?? 1}">
      </div>
    `);
  }

  _attachAnimPreviewHandlers(root, which) {
    const refresh = () => this._renderAnimPreviewInto(root, which);
    const anim = () => this._formState[this._animKey(which)];

    root.on("input change", ".tmac-anim-duration", (ev) => {
      const v = Number(ev.currentTarget.value);
      if (Number.isFinite(v) && v >= 100) anim().duration = v;
    });

    root.on("click", ".tmac-anim-ease-btn", (ev) => {
      anim().easingFunc = ev.currentTarget.dataset.tmacEasing;
      refresh();
    });

    root.on("mousedown", ".tmac-anim-track", (ev) => {
      if (ev.button !== 0 || $(ev.target).hasClass("tmac-anim-thumb")) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const sample = sampleColorAnimation(anim(), pos * anim().duration) ?? { color: 0xff0000, alpha: 1 };
      anim().keyframes.push({ color: sample.color, alpha: sample.alpha, position: pos });
      anim().keyframes.sort((a, b) => a.position - b.position);
      this._selectedKfIdx[which] = anim().keyframes.findIndex(k => k.position === pos);
      refresh();
      this._beginThumbDrag(root, which);
    });

    root.on("contextmenu", ".tmac-anim-thumb", (ev) => {
      ev.preventDefault();
      const idx = Number(ev.currentTarget.dataset.tmacThumb);
      if (anim().keyframes.length <= 1) return;
      anim().keyframes.splice(idx, 1);
      this._selectedKfIdx[which] = Math.min(this._selectedKfIdx[which] ?? 0, anim().keyframes.length - 1);
      refresh();
    });

    root.on("mousedown", ".tmac-anim-thumb", (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const idx = Number(ev.currentTarget.dataset.tmacThumb);
      this._selectedKfIdx[which] = idx;
      refresh();
      this._beginThumbDrag(root, which);
    });

    root.on("input change", ".tmac-anim-sel-pos", (ev) => {
      const kfs = anim().keyframes;
      const sel = kfs[this._selectedKfIdx[which]];
      if (!sel) return;
      const v = Math.max(0, Math.min(100, Number(ev.currentTarget.value))) / 100;
      sel.position = v;
      kfs.sort((a, b) => a.position - b.position);
      this._selectedKfIdx[which] = kfs.indexOf(sel);
      refresh();
    });

    root.on("change", ".tmac-anim-sel-color", (ev) => {
      const kf = anim().keyframes[this._selectedKfIdx[which]];
      if (kf) kf.color = ev.currentTarget.value;
      refresh();
    });

    root.on("input change", ".tmac-anim-sel-alpha", (ev) => {
      const kf = anim().keyframes[this._selectedKfIdx[which]];
      if (kf) kf.alpha = Math.max(0, Math.min(1, Number(ev.currentTarget.value)));
      refresh();
    });
  }

  _beginThumbDrag(root, which) {
    const trackEl = root.find(".tmac-anim-track")[0];
    if (!trackEl) return;
    const move = (e) => {
      const rect = trackEl.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const kfs = this._formState[this._animKey(which)].keyframes;
      const sel = kfs[this._selectedKfIdx[which]];
      if (!sel) return;
      sel.position = pos;
      kfs.sort((a, b) => a.position - b.position);
      this._selectedKfIdx[which] = kfs.indexOf(sel);
      this._renderAnimPreviewInto(root, which);
    };
    const up = () => {
      document.body.removeEventListener("pointermove", move);
      document.body.removeEventListener("pointerup", up);
    };
    document.body.addEventListener("pointermove", move);
    document.body.addEventListener("pointerup", up);
  }

  _startAnimTracker(html) {
    this._stopAnimTracker();
    const step = () => {
      if (!this.element?.length) { this._stopAnimTracker(); return; }
      const now = Date.now();
      for (const which of ["line", "fill"]) {
        const anim = this._formState[this._animKey(which)];
        if (!anim) continue;
        const tracker = html.find(`.tmac-anim-preview[data-tmac-anim="${which}"] .tmac-anim-tracker`)[0];
        if (!tracker) continue;
        const dur = Math.max(1, anim.duration);
        const ease = easingFunctions[anim.easingFunc] ?? easingFunctions.linear;
        const t = ease((now % dur) / dur);
        tracker.style.left = `${(t * 100).toFixed(2)}%`;
      }
      this._animFrameId = requestAnimationFrame(step);
    };
    this._animFrameId = requestAnimationFrame(step);
  }

  _stopAnimTracker() {
    if (this._animFrameId != null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  _snapshot(html) {
    const fd = new FormDataExtended(html.find("form")[0] ?? html[0]).object;
    this._mergeFormData(foundry.utils.flattenObject(fd));
  }

  _mergeFormData(fd) {
    const s = this._formState;
    const num = (v, fallback) => (v === undefined || v === null || v === "") ? fallback : Number(v);
    const str = (v, fallback) => v ?? fallback;
    if (this.mode === MODES.TEMPLATE) {
      s.t = str(fd.t, s.t);
      s.x = num(fd.x, s.x);
      s.y = num(fd.y, s.y);
      s.elevation = num(fd.elevation, s.elevation);
      s.sort = num(fd.sort, s.sort);
      s.direction = num(fd.direction, s.direction);
      s.angle = num(fd.angle, s.angle);
      s.distance = num(fd.distance, s.distance);
      s.width = num(fd.width, s.width);
      s.borderColorNative = str(fd.borderColorNative, s.borderColorNative);
      s.fillColorNative = str(fd.fillColorNative, s.fillColorNative);
      s.textureNative = str(fd.textureNative, s.textureNative);
      s.hidden = !!fd.hidden;
      s.attachedTokenId = str(fd.attachedTokenId, s.attachedTokenId);
    }
    if (this.mode === MODES.ENTRY) {
      s.entryName = str(fd.entryName, s.entryName);
      s.entryIcon = str(fd.entryIcon, s.entryIcon);
    }
    if (fd.useCustomRender !== undefined) s.useCustomRender = !!fd.useCustomRender;
    s.radiusOffset = num(fd.radiusOffset, s.radiusOffset);
    s.lineType = num(fd.lineType, s.lineType);
    s.lineWidth = num(fd.lineWidth, s.lineWidth);
    s.lineColor = str(fd.lineColor, s.lineColor);
    s.lineOpacity = num(fd.lineOpacity, s.lineOpacity);
    s.lineDashSize = num(fd.lineDashSize, s.lineDashSize);
    s.lineGapSize = num(fd.lineGapSize, s.lineGapSize);
    s.lineDashOffsetAnimation = num(fd.lineDashOffsetAnimation, s.lineDashOffsetAnimation);
    s.fillType = num(fd.fillType, s.fillType);
    s.fillColor = str(fd.fillColor, s.fillColor);
    s.fillOpacity = num(fd.fillOpacity, s.fillOpacity);
    s.fillTexture = str(fd.fillTexture, s.fillTexture);
    s.fillTextureOffset = {
      x: num(fd.fillTextureOffsetX, s.fillTextureOffset.x),
      y: num(fd.fillTextureOffsetY, s.fillTextureOffset.y)
    };
    s.fillTextureScale = {
      x: num(fd.fillTextureScaleX, s.fillTextureScale.x),
      y: num(fd.fillTextureScaleY, s.fillTextureScale.y)
    };
    s.centerLabel = str(fd.centerLabel, s.centerLabel);
    s.movementPenalty = num(fd.movementPenalty, s.movementPenalty);
    s.flatMovementPenalty = !!fd.flatMovementPenalty;
    if (fd.elevationGated !== undefined) s.elevationGated = !!fd.elevationGated;
    if (fd.elevationRangeManual !== undefined) s.elevationRangeManual = !!fd.elevationRangeManual;
    s.elevationRange = num(fd.elevationRange, s.elevationRange);
    s.innerRadius = num(fd.innerRadius, s.innerRadius);

    if (s.lineColorAnimation) {
      s.lineColorAnimation.duration = num(fd.lineColorAnimationDuration, s.lineColorAnimation.duration);
      s.lineColorAnimation.easingFunc = str(fd.lineColorAnimationEasing, s.lineColorAnimation.easingFunc);
      this._mergeKeyframes(s.lineColorAnimation, fd, "line");
    }
    if (s.fillColorAnimation) {
      s.fillColorAnimation.duration = num(fd.fillColorAnimationDuration, s.fillColorAnimation.duration);
      s.fillColorAnimation.easingFunc = str(fd.fillColorAnimationEasing, s.fillColorAnimation.easingFunc);
      this._mergeKeyframes(s.fillColorAnimation, fd, "fill");
    }
    if (s.fillTextureOffsetAnimation) {
      s.fillTextureOffsetAnimation = {
        x: num(fd.fillTextureOffsetAnimationX, s.fillTextureOffsetAnimation.x),
        y: num(fd.fillTextureOffsetAnimationY, s.fillTextureOffsetAnimation.y)
      };
    }

    if (this.mode === MODES.TEMPLATE || this.mode === MODES.PLACEMENT) {
      for (let i = 0; i < (s.actions?.length ?? 0); i++) {
        const a = s.actions[i];
        a.trigger = str(fd[`action_${i}_trigger`], a.trigger);
        a.actionType = str(fd[`action_${i}_actionType`], a.actionType);
        a.targetFilter = str(fd[`action_${i}_targetFilter`], a.targetFilter ?? "ALL");
        a.asGM = !!fd[`action_${i}_asGM`];
        a.code = str(fd[`action_${i}_code`], a.code);
        a.macroUuid = str(fd[`action_${i}_macroUuid`], a.macroUuid);
        a.effectName = str(fd[`action_${i}_effectName`], a.effectName);
        a.effectMode = str(fd[`action_${i}_effectMode`], a.effectMode);
      }
    }
  }

  _mergeKeyframes(anim, fd, which) {
    if (!anim.keyframes) return;
    for (let i = 0; i < anim.keyframes.length; i++) {
      const k = anim.keyframes[i];
      const pos = fd[`${which}KfPosition_${i}`];
      const col = fd[`${which}KfColor_${i}`];
      const alpha = fd[`${which}KfAlpha_${i}`];
      if (pos !== undefined && pos !== "") k.position = Number(pos);
      if (col !== undefined && col !== null && col !== "") k.color = col;
      if (alpha !== undefined && alpha !== "") k.alpha = Number(alpha);
    }
    anim.keyframes.sort((a, b) => a.position - b.position);
  }

  // V2 form handler (registered via DEFAULT_OPTIONS.form.handler)
  static async _formHandler(_event, _form, formData) {
    this._mergeFormData(foundry.utils.flattenObject(formData.object));
    if (this.mode === MODES.TEMPLATE) { this._saved = true; return this._saveTemplate(); }
    if (this.mode === MODES.DEFAULTS) return this._saveDefaults();
    if (this.mode === MODES.PLACEMENT) return this._savePlacement();
    if (this.mode === MODES.ENTRY) return this._saveEntry();
  }

  async _saveEntry() {
    const s = this._formState;
    if (!this.target || typeof this.target !== "object") return;
    this.target.name = s.entryName;
    this.target.icon = s.entryIcon;
    this.target.graphicsState = this.target.graphicsState ?? {};
    const GRAPHICS_KEYS = [
      "useCustomRender", "radiusOffset",
      "lineType", "lineWidth", "lineColor", "lineOpacity",
      "lineDashSize", "lineGapSize", "lineDashOffsetAnimation", "lineColorAnimation",
      "fillType", "fillColor", "fillOpacity", "fillColorAnimation",
      "fillTexture", "fillTextureOffset", "fillTextureOffsetAnimation", "fillTextureScale",
      "centerLabel", "movementPenalty", "flatMovementPenalty", "elevationGated", "elevationRangeManual", "elevationRange", "innerRadius", "actions"
    ];
    for (const k of GRAPHICS_KEYS) this.target.graphicsState[k] = s[k];
    this.onSubmit?.(this.target);
  }

  async _saveTemplate() {
    const s = this._formState;
    const snap = this._originalSnapshot ?? {};
    const t = this.target;
    const prevUseCustom = !!t.getFlag(MODULE, "useCustomRender");
    // pick: if state matches snapshot, user didn't edit the field in the form; trust current doc value
    const pick = (stateKey, docKey = stateKey) => (s[stateKey] === snap[docKey]) ? t[docKey] : s[stateKey];
    const nativeUpdates = {
      t: pick("t"),
      x: pick("x"),
      y: pick("y"),
      elevation: pick("elevation"),
      sort: pick("sort"),
      direction: pick("direction"),
      angle: pick("angle"),
      distance: pick("distance"),
      width: pick("width"),
      borderColor: pick("borderColorNative", "borderColor"),
      fillColor: pick("fillColorNative", "fillColor"),
      texture: pick("textureNative", "texture"),
      hidden: pick("hidden")
    };
    const flagUpdates = {
      attachedTokenId: s.attachedTokenId || null,
      useCustomRender: s.useCustomRender,
      radiusOffset: s.radiusOffset,
      lineType: s.lineType,
      lineWidth: s.lineWidth,
      lineColor: s.lineColor,
      lineOpacity: s.lineOpacity,
      lineDashSize: s.lineDashSize,
      lineGapSize: s.lineGapSize,
      lineDashOffsetAnimation: s.lineDashOffsetAnimation,
      lineColorAnimation: s.lineColorAnimation,
      fillType: s.fillType,
      fillColor: s.fillColor,
      fillOpacity: s.fillOpacity,
      fillColorAnimation: s.fillColorAnimation,
      fillTexture: s.fillTexture,
      fillTextureOffset: s.fillTextureOffset,
      fillTextureOffsetAnimation: s.fillTextureOffsetAnimation,
      fillTextureScale: s.fillTextureScale,
      centerLabel: s.centerLabel,
      schemaVersion: 2
    };
    const update = { ...nativeUpdates };
    for (const [k, v] of Object.entries(flagUpdates)) update[`flags.${MODULE}.${k}`] = v;
    update[`flags.${MODULE}.actions`] = s.actions ?? [];
    if (s.elevationGated) {
      update[`flags.${MODULE}.elevationGated`] = true;
      if (s.elevationRangeManual) {
        update[`flags.${MODULE}.elevationRangeManual`] = true;
        update[`flags.${MODULE}.elevationRange`] = s.elevationRange ?? 0;
      } else {
        update[`flags.${MODULE}.-=elevationRangeManual`] = null;
        update[`flags.${MODULE}.-=elevationRange`] = null;
      }
    } else {
      update[`flags.${MODULE}.-=elevationGated`] = null;
      update[`flags.${MODULE}.-=elevationRangeManual`] = null;
      update[`flags.${MODULE}.-=elevationRange`] = null;
    }
    if ((s.innerRadius ?? 0) > 0) update[`flags.${MODULE}.innerRadius`] = s.innerRadius;
    else update[`flags.${MODULE}.-=innerRadius`] = null;
    // drop legacy per-trigger commands so they don't double-fire alongside the actions list
    for (const trig of TRIGGERS) {
      if (trig === "never") continue;
      update[`flags.${MODULE}.-=${trig}`] = null;
    }
    if (game.modules.get("elevationruler")?.active) {
      if ((s.movementPenalty ?? 0) !== 0) {
        update["flags.elevationruler.movementPenalty"] = s.movementPenalty;
        update["flags.elevationruler.flatMovementPenalty"] = s.flatMovementPenalty;
      } else {
        update["flags.elevationruler.-=movementPenalty"] = null;
        update["flags.elevationruler.-=flatMovementPenalty"] = null;
      }
    }
    if (s.useCustomRender && !prevUseCustom) {
      update["flags.tokenmagic.templateData.opacity"] = 0;
    }
    // suppress auto-render: we wrote this update from the sheet, no need for Foundry to rerender us
    await this.target.update(update, { render: false });
  }

  async _saveDefaults() {
    const s = this._formState;
    const set = async (field, value) => {
      const key = settingKey(this.zoneType, field.charAt(0).toUpperCase() + field.slice(1));
      try { await game.settings.set(MODULE, key, value); } catch { /* unregistered */ }
    };
    for (const [field, value] of Object.entries(s)) {
      if (field === "macros") continue;
      await set(field, value);
    }
  }

  async _savePlacement() {
    if (typeof this.target === "object" && this.target !== null) {
      const s = this._formState;
      for (const [k, v] of Object.entries(s)) {
        if (k === "macros") continue;
        this.target[k] = v;
      }
    }
    this.onSubmit?.(this._formState);
  }
}

export function openTemplateGraphicsConfig(templateDoc) {
  new TemplatemacroGraphicsConfig({ mode: MODES.TEMPLATE, target: templateDoc }).render(true);
}

export function openDefaultsGraphicsConfig(zoneType) {
  new TemplatemacroGraphicsConfig({ mode: MODES.DEFAULTS, zoneType }).render(true);
}

export function openPlacementGraphicsConfig(zoneType, state, onSubmit) {
  new TemplatemacroGraphicsConfig({ mode: MODES.PLACEMENT, zoneType, target: state, onSubmit }).render(true);
}

export function openEntryGraphicsConfig(entry, onSubmit) {
  new TemplatemacroGraphicsConfig({ mode: MODES.ENTRY, target: entry, onSubmit }).render(true);
}

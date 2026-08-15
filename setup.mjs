import {
  findGrids,
  findContained,
  findContainers,
  getTemplatesAtPoint,
  getTemplateOccupiedOffsets,
  placeZone,
  placeZoneWithStatusEffect,
  placeDangerousZone,
  triggerDangerousZoneFlow,
  placeDifficultTerrainZone,
  attachTemplateToToken,
  detachTemplateFromToken
} from "./scripts/api.mjs";
import { MODULE, LINE_TYPES } from "./scripts/constants.mjs";
import { TemplatemacroGraphicsConfig } from "./scripts/applications/graphics-config.mjs";
import { TemplateLibraryConfig, seedLibraryIfEmpty, registerLibraryHooks } from "./scripts/applications/template-library.mjs";
import {
  _createHeaderButton,
  _createTemplate,
  _deleteTemplate,
  _preCreateTemplate,
  _preUpdateCombat,
  _preUpdateTemplate,
  _preUpdateToken,
  _updateCombat,
  _updateTemplate,
  _updateToken
} from "./scripts/hooks.mjs";
import { callMacro, registerCallback, unregisterCallbacks } from "./scripts/templatemacro.mjs";
import { registerPatternFillHooks, FILL_TYPES } from "./scripts/patternFill.mjs";
import { setupThtRulerOverlay } from "./scripts/tht-ruler-overlay.mjs";
import { registerDragElevation, setPreviewElevationBase } from "./scripts/drag-elevation.mjs";
import { checkModuleUpdate } from "./scripts/version-check.mjs";

class ZoneConfig extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "Zone Configuration",
      id: "templatemacro-zone-config",
      template: "modules/templatemacro/templates/zone-config.html",
      width: 500,
      height: "auto",
      closeOnSubmit: true,
      tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "dangerous" }]
    });
  }

  getData() {
    return {
      fillTypes: { [FILL_TYPES.SOLID]: "Solid", [FILL_TYPES.PATTERN]: "Pattern" },
      dangerous: {
        fillType: game.settings.get(MODULE, "dangerZoneDefaultFillType"),
        texture: game.settings.get(MODULE, "dangerZoneDefaultTexture"),
        fillColor: game.settings.get(MODULE, "dangerZoneDefaultFillColor"),
        borderColor: game.settings.get(MODULE, "dangerZoneDefaultBorderColor"),
        fillOpacity: game.settings.get(MODULE, "dangerZoneDefaultFillOpacity"),
        borderOpacity: game.settings.get(MODULE, "dangerZoneDefaultBorderOpacity"),
        animation: game.settings.get(MODULE, "dangerZoneDefaultAnimation"),
        animationSpeed: game.settings.get(MODULE, "dangerZoneDefaultFillAnimationSpeed"),
        animationAngle: game.settings.get(MODULE, "dangerZoneDefaultFillAnimationAngle"),
        fillPulse: game.settings.get(MODULE, "dangerZoneDefaultFillPulse"),
        fillPulseSpeed: game.settings.get(MODULE, "dangerZoneDefaultFillPulseSpeed"),
        useDamageTexture: game.settings.get(MODULE, "dangerZoneUseDamageTexture")
      },
      status: {
        fillType: game.settings.get(MODULE, "statusZoneDefaultFillType"),
        texture: game.settings.get(MODULE, "statusZoneDefaultTexture"),
        fillColor: game.settings.get(MODULE, "statusZoneDefaultFillColor"),
        borderColor: game.settings.get(MODULE, "statusZoneDefaultBorderColor"),
        fillOpacity: game.settings.get(MODULE, "statusZoneDefaultFillOpacity"),
        borderOpacity: game.settings.get(MODULE, "statusZoneDefaultBorderOpacity"),
        animation: game.settings.get(MODULE, "statusZoneDefaultAnimation"),
        animationSpeed: game.settings.get(MODULE, "statusZoneDefaultFillAnimationSpeed"),
        animationAngle: game.settings.get(MODULE, "statusZoneDefaultFillAnimationAngle"),
        fillPulse: game.settings.get(MODULE, "statusZoneDefaultFillPulse"),
        fillPulseSpeed: game.settings.get(MODULE, "statusZoneDefaultFillPulseSpeed")
      },
      difficult: {
        movementPenalty: game.settings.get(MODULE, "difficultTerrainDefaultMovementPenalty"),
        flatPenalty: game.settings.get(MODULE, "difficultTerrainDefaultFlatPenalty"),
        fillType: game.settings.get(MODULE, "difficultTerrainDefaultFillType"),
        texture: game.settings.get(MODULE, "difficultTerrainDefaultTexture"),
        fillColor: game.settings.get(MODULE, "difficultTerrainDefaultFillColor"),
        borderColor: game.settings.get(MODULE, "difficultTerrainDefaultBorderColor"),
        fillOpacity: game.settings.get(MODULE, "difficultTerrainDefaultFillOpacity"),
        borderOpacity: game.settings.get(MODULE, "difficultTerrainDefaultBorderOpacity"),
        animation: game.settings.get(MODULE, "difficultTerrainDefaultAnimation"),
        animationSpeed: game.settings.get(MODULE, "difficultTerrainDefaultFillAnimationSpeed"),
        animationAngle: game.settings.get(MODULE, "difficultTerrainDefaultFillAnimationAngle"),
        fillPulse: game.settings.get(MODULE, "difficultTerrainDefaultFillPulse"),
        fillPulseSpeed: game.settings.get(MODULE, "difficultTerrainDefaultFillPulseSpeed")
      }
    };
  }

  async _updateObject(event, formData) {
    for (let [key, value] of Object.entries(formData)) {
      await game.settings.set(MODULE, key, value);
    }
  }
}

Hooks.once("init", () => {
  const tmplCls = CONFIG.MeasuredTemplate?.documentClass ?? MeasuredTemplateDocument;
  DocumentSheetConfig.unregisterSheet(tmplCls, "core", MeasuredTemplateConfig);
  DocumentSheetConfig.registerSheet(tmplCls, MODULE, TemplatemacroGraphicsConfig, {
    label: "Template Macro Sheet",
    makeDefault: true
  });

  registerLibraryHooks();
  registerDragElevation();
});

Hooks.once("setup", () => {
  game.modules.get(MODULE).api = {
    findContainers,
    findContained,
    findGrids,
    getTemplatesAtPoint,
    getTemplateOccupiedOffsets,
    placeZone,
    placeZoneWithStatusEffect,
    placeDangerousZone,
    triggerDangerousZoneFlow,
    placeDifficultTerrainZone,
    registerCallback,
    unregisterCallbacks,
    attachTemplateToToken,
    detachTemplateFromToken,
    setPreviewElevationBase
  };

  MeasuredTemplateDocument.prototype.callMacro = async function(type = "never", options = {}) {
    options.userId ??= game.user.id;
    options.gmId ??= game.users.find(u => u.active && u.isGM)?.id;
    return callMacro(this, type, options);
  }

  if (game.system.id === "dnd5e") {
    Hooks.on("getItemSheetHeaderButtons", _createHeaderButton);
    Hooks.on("preCreateMeasuredTemplate", _preCreateTemplate);
  }

  Hooks.on("createMeasuredTemplate", _createTemplate);
  Hooks.on("deleteMeasuredTemplate", _deleteTemplate);
  Hooks.on("preUpdateMeasuredTemplate", _preUpdateTemplate);
  Hooks.on("preUpdateToken", _preUpdateToken);
  Hooks.on("updateMeasuredTemplate", _updateTemplate);
  Hooks.on("updateToken", _updateToken);
  Hooks.on("preUpdateCombat", _preUpdateCombat);
  Hooks.on("updateCombat", _updateCombat);

  if (game.system.id === "lancer") {
    _registerLancerSettings();
  }
  Hooks.on("getSceneControlButtons", (controls) => {
    // v13: control name is "templates" (renamed from v12 "measure"). controls/tools are keyed objects.
    const templateControls = Array.isArray(controls)
      ? (controls.find(c => c.name === "templates") || controls.find(c => c.name === "measure"))
      : (controls?.templates ?? controls?.measure);
    if (!templateControls) return;
    const tool = {
      name: "templateLibrary",
      title: "Template Library",
      icon: "fas fa-folder-open",
      toggle: true,
      active: !!_findOpenLibrary(),
      // v13 calls onChange(event, active) with the new toggle state.
      onChange: (_event, active) => {
        if (active) {
          if (!_findOpenLibrary()) new TemplateLibraryConfig().render(true);
        } else {
          _closeTemplateLibrary();
        }
      }
    };
    if (Array.isArray(templateControls.tools)) {
      tool.onClick = () => _toggleTemplateLibrary();
      templateControls.tools.push(tool);
    } else if (templateControls.tools) {
      templateControls.tools["templateLibrary"] = tool;
    }
  });

  // Keep the toolbar toggle visually in sync when the library closes / opens by other means.
  const _refreshLibraryToggle = (active) => {
    const groups = ui.controls?.controls ?? {};
    const group = groups.templates ?? groups.measure ?? null;
    const toolsCollection = group?.tools;
    const tool = toolsCollection?.templateLibrary
      ?? (Array.isArray(toolsCollection)
        ? toolsCollection.find(t => t.name === "templateLibrary")
        : null);
    if (!tool || tool.active === active) return;
    tool.active = active;
    ui.controls?.render();
  };
  Hooks.on("renderTemplateLibraryConfig", () => _refreshLibraryToggle(true));
  Hooks.on("closeTemplateLibraryConfig", () => _refreshLibraryToggle(false));
  let _lastActiveControl = null;
  Hooks.on("renderSceneControls", (controls) => {
    // v13: SceneControls#control is the active control object; v12 had .activeControl as a string.
    const current = controls?.control?.name ?? controls?.activeControl ?? null;
    const isTemplates = current === "templates" || current === "measure";
    const wasTemplates = _lastActiveControl === "templates" || _lastActiveControl === "measure";
    const enteredTemplates = isTemplates && !wasTemplates;
    const leftTemplates = !isTemplates && wasTemplates;
    _lastActiveControl = current;
    if (leftTemplates) {
      _closeTemplateLibrary();
    } else if (enteredTemplates && game.settings.get(MODULE, "autoOpenLibrary") && !_findOpenLibrary()) {
      new TemplateLibraryConfig().render(true);
    }
  });
  Hooks.once("ready", () => {
    seedLibraryIfEmpty();
    checkModuleUpdate(MODULE);
  });

  registerPatternFillHooks();
  setupThtRulerOverlay();
});

function _registerLancerSettings() {
  // Dangerous Zone Defaults
  game.settings.register(MODULE, "dangerZoneDefaultFillType", {
    name: "Dangerous Zone: Default Fill Type",
    hint: "Default fill type for Dangerous Zone templates",
    scope: "world",
    config: false,
    type: Number,
    default: FILL_TYPES.PATTERN,
    choices: {
      [FILL_TYPES.SOLID]: "Solid",
      [FILL_TYPES.PATTERN]: "Pattern"
    }
  });

  game.settings.register(MODULE, "dangerZoneDefaultTexture", {
    name: "Dangerous Zone: Default Texture",
    hint: "Default pattern texture path for Dangerous Zone",
    scope: "world",
    config: false,
    type: String,
    filePicker: "imagevideo",
    default: "modules/templatemacro/textures/hatching-radioactive.png"
  });

  game.settings.register(MODULE, "dangerZoneDefaultFillColor", {
    name: "Dangerous Zone: Default Fill Color",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ColorField(),
    default: "#ff6400"
  });
  
  game.settings.register(MODULE, "dangerZoneDefaultBorderColor", {
    name: "Dangerous Zone: Default Border Color",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ColorField(),
    default: "#000000"
  });

  game.settings.register(MODULE, "dangerZoneDefaultFillOpacity", {
    name: "Dangerous Zone: Default Fill Opacity",
    scope: "world",
    config: false,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.05 }
  });

  game.settings.register(MODULE, "dangerZoneDefaultAnimation", {
    name: "Dangerous Zone: Animation Enabled",
    hint: "Enable fill animation by default",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE, "dangerZoneDefaultFillPulse", {
    name: "Dangerous Zone: Fill Pulse",
    hint: "Enable fill pulse animation by default",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  
  game.settings.register(MODULE, "dangerZoneUseDamageTexture", {
    name: "Dangerous Zone: Use Damage Texture",
    hint: "Automatically select texture based on damage type (overrides default texture)",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  // Status Zone Defaults
  game.settings.register(MODULE, "statusZoneDefaultFillType", {
    name: "Status Zone: Default Fill Type",
    hint: "Default fill type for Status Zone templates",
    scope: "world",
    config: false,
    type: Number,
    default: FILL_TYPES.PATTERN,
    choices: {
      [FILL_TYPES.SOLID]: "Solid",
      [FILL_TYPES.PATTERN]: "Pattern"
    }
  });

  game.settings.register(MODULE, "statusZoneDefaultTexture", {
    name: "Status Zone: Default Texture",
    hint: "Default pattern texture path for Status Zone",
    scope: "world",
    config: false,
    type: String,
    filePicker: "imagevideo",
    default: "modules/templatemacro/textures/hatching-cog.png"
  });

  game.settings.register(MODULE, "statusZoneDefaultFillColor", {
    name: "Status Zone: Default Fill Color",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ColorField(),
    default: "#0088ff"
  });
  
  game.settings.register(MODULE, "statusZoneDefaultBorderColor", {
      name: "Status Zone: Default Border Color",
      scope: "world",
      config: false,
      type: new foundry.data.fields.ColorField(),
      default: "#000000"
    });

  game.settings.register(MODULE, "statusZoneDefaultFillOpacity", {
    name: "Status Zone: Default Fill Opacity",
    scope: "world",
    config: false,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.05 }
  });

  game.settings.register(MODULE, "statusZoneDefaultAnimation", {
    name: "Status Zone: Animation Enabled",
    hint: "Enable fill animation by default",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE, "statusZoneDefaultFillPulse", {
    name: "Status Zone: Fill Pulse",
    hint: "Enable fill pulse animation by default",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE, "dangerZoneDefaultBorderOpacity", {
    scope: "world",
    config: false,
    type: Number,
    default: 0.5
  });
  game.settings.register(MODULE, "dangerZoneDefaultFillAnimationSpeed", {
    scope: "world",
    config: false,
    type: Number,
    default: 0.5
  });
  game.settings.register(MODULE, "dangerZoneDefaultFillAnimationAngle", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register(MODULE, "dangerZoneDefaultFillPulseSpeed", {
    scope: "world",
    config: false,
    type: Number,
    default: 1
  });

  // Difficult Terrain Zone Defaults
  game.settings.register(MODULE, "difficultTerrainDefaultMovementPenalty", {
    scope: "world", config: false, type: Number, default: 1
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFlatPenalty", {
    scope: "world", config: false, type: Boolean, default: true
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillType", {
    scope: "world", config: false, type: Number, default: FILL_TYPES.PATTERN,
    choices: { [FILL_TYPES.SOLID]: "Solid", [FILL_TYPES.PATTERN]: "Pattern" }
  });
  game.settings.register(MODULE, "difficultTerrainDefaultTexture", {
    scope: "world", config: false, type: String, filePicker: "imagevideo",
    default: "modules/templatemacro/textures/hatching-rock.png"
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillColor", {
    scope: "world", config: false, type: new foundry.data.fields.ColorField(), default: "#e83bd1"
  });
  game.settings.register(MODULE, "difficultTerrainDefaultBorderColor", {
    scope: "world", config: false, type: new foundry.data.fields.ColorField(), default: "#000000"
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillOpacity", {
    scope: "world", config: false, type: Number, default: 0.5,
    range: { min: 0, max: 1, step: 0.05 }
  });
  game.settings.register(MODULE, "difficultTerrainDefaultBorderOpacity", {
    scope: "world", config: false, type: Number, default: 0.5
  });
  game.settings.register(MODULE, "difficultTerrainDefaultAnimation", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillPulse", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillAnimationSpeed", {
    scope: "world", config: false, type: Number, default: 0.5
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillAnimationAngle", {
    scope: "world", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE, "difficultTerrainDefaultFillPulseSpeed", {
    scope: "world", config: false, type: Number, default: 1
  });

  // Status Zone - Additional Defaults
  game.settings.register(MODULE, "statusZoneDefaultBorderOpacity", {
    scope: "world",
    config: false,
    type: Number,
    default: 0.5
  });
  game.settings.register(MODULE, "statusZoneDefaultFillAnimationSpeed", {
    scope: "world",
    config: false,
    type: Number,
    default: 0.5
  });
  game.settings.register(MODULE, "statusZoneDefaultFillAnimationAngle", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register(MODULE, "statusZoneDefaultFillPulseSpeed", {
    scope: "world",
    config: false,
    type: Number,
    default: 1
  });

  game.settings.register(MODULE, "centerLabelSize", {
    name: "Center Label Font Size",
    hint: "Font size (in pixels) of the text shown at the center of placement zones.",
    scope: "world",
    config: true,
    type: Number,
    default: 12
  });

  game.settings.register(MODULE, "thtAutoElevation", {
    name: "THT Auto Elevation",
    hint: "When moving a template, auto-adjust its elevation by the difference in THT terrain elevation between the old and new position. Preserves any offset above ground.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE, "defaultCenterLabel", {
    name: "Default Center Label",
    hint: "Shown on templates that have no per-template label. Leave empty to disable.",
    scope: "world",
    config: true,
    type: String,
    default: "⚠"
  });

  game.settings.register(MODULE, "autoOpenLibrary", {
    name: "Auto-Open Template Library",
    hint: "Automatically open the Template Library when entering the measurement scene controls.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE, "lastNotifiedVersion", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  _registerGraphicDefaults("danger");
  _registerGraphicDefaults("status");
  _registerGraphicDefaults("difficult");

  game.settings.register(MODULE, "templateLibrary", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE, "templateLibrarySpawn", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE, "templateLibraryFolders", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE, "templateLibrarySpawnFolders", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE, "templateLibraryElevTool", {
    scope: "client",
    config: false,
    type: Object,
    default: { aware: false, manual: false, height: 0, elevation: 0 }
  });

  game.settings.registerMenu(MODULE, "templateLibrary", {
    name: "Template Library",
    label: "Open Library",
    hint: "Pre-configured templates you can spawn from the scene controls.",
    icon: "fas fa-folder-open",
    type: _makeLibraryLauncher(),
    restricted: true
  });

  game.settings.registerMenu(MODULE, "restoreDefaults", {
    name: "Restore Module Defaults",
    label: "Restore",
    hint: "Reset all templateMacro settings to their defaults and re-seed the default template library entries (Dangerous Zone, Status Zone).",
    icon: "fas fa-arrow-rotate-left",
    type: _makeRestoreDefaultsLauncher(),
    restricted: true
  });
}

function _registerGraphicDefaults(zoneType) {
  const prefix = zoneType === "difficult" ? "difficultTerrainDefault" : `${zoneType}ZoneDefault`;
  const reg = (field, type, defaultVal) => {
    const key = `${prefix}${field}`;
    if (game.settings.settings.has(`${MODULE}.${key}`)) return;
    game.settings.register(MODULE, key, { scope: "world", config: false, type, default: defaultVal });
  };
  reg("UseCustomRender", Boolean, true);
  reg("RadiusOffset", Number, 0);
  reg("LineType", Number, LINE_TYPES.SOLID);
  reg("LineWidth", Number, 2);
  reg("LineColor", String, "#000000");
  reg("LineOpacity", Number, 0.5);
  reg("LineDashSize", Number, 15);
  reg("LineGapSize", Number, 10);
  reg("LineDashOffsetAnimation", Number, 0);
  reg("LineColorAnimation", Object, null);
  reg("FillColorAnimation", Object, null);
  reg("FillTexture", String, "");
  reg("FillTextureOffset", Object, { x: 0, y: 0 });
  reg("FillTextureOffsetAnimation", Object, null);
  reg("FillTextureScale", Object, { x: 100, y: 100 });
  reg("CenterLabel", String, "");
  reg("Actions", Object, []);
}

function _buildPlacementGraphicsState(zoneType) {
  const prefix = zoneType === "difficult" ? "difficultTerrainDefault" : `${zoneType}ZoneDefault`;
  const read = (field, fallback) => {
    try { return game.settings.get(MODULE, `${prefix}${field}`) ?? fallback; }
    catch { return fallback; }
  };
  return {
    useCustomRender: read("UseCustomRender", true),
    radiusOffset: read("RadiusOffset", 0),
    lineType: read("LineType", LINE_TYPES.SOLID),
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
    centerLabel: read("CenterLabel", ""),
    actions: read("Actions", [])
  };
}

function _findOpenLibrary() {
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    if (app instanceof TemplateLibraryConfig) return app;
  }
  return Object.values(ui.windows).find(w => w instanceof TemplateLibraryConfig);
}

function _toggleTemplateLibrary() {
  const existing = _findOpenLibrary();
  if (existing) existing.close();
  else new TemplateLibraryConfig().render(true);
}

function _closeTemplateLibrary() {
  const existing = _findOpenLibrary();
  if (existing) existing.close();
}

function _makeLibraryLauncher() {
  return class TmacLibraryLauncher extends FormApplication {
    static get defaultOptions() { return super.defaultOptions; }
    render() {
      new TemplateLibraryConfig().render(true);
      return this;
    }
    async _updateObject() {}
  };
}

function _makeRestoreDefaultsLauncher() {
  return class TmacRestoreDefaultsLauncher extends FormApplication {
    static get defaultOptions() { return super.defaultOptions; }
    render() {
      Dialog.confirm({
        title: "Restore templateMacro Defaults",
        content: `<p>Reset all templateMacro world settings to their built-in defaults and re-seed the default template library entries?</p><p><strong>Custom library entries you added will be removed.</strong></p>`,
        yes: async () => {
          for (const [key, setting] of game.settings.settings) {
            if (!key.startsWith(`${MODULE}.`)) continue;
            if (setting.scope !== "world") continue;
            if (key === `${MODULE}.templateLibrary`) continue;
            try { await game.settings.set(MODULE, key.slice(MODULE.length + 1), setting.default); }
            catch { /* skip read-only or unregistered */ }
          }
          await game.settings.set(MODULE, "templateLibrary", []);
          await seedLibraryIfEmpty();
          ui.notifications?.info("templateMacro defaults restored.");
        }
      });
      return this;
    }
    async _updateObject() {}
  };
}

function _makeDefaultsLauncher(zoneType) {
  return class TmacDefaultsLauncher extends FormApplication {
    static get defaultOptions() { return super.defaultOptions; }
    render() {
      new TemplatemacroGraphicsConfig({ mode: "defaults", zoneType }).render(true);
      return this;
    }
    async _updateObject() {}
  };
}

function initDialogListeners(html) {
  const app = html.closest('.app');
  html.find('select[name="fillType"]').on('change', function() {
    const isPattern = this.value === "2";
    html.find('.pattern-options').toggle(isPattern);
    if (app.length) {
      const dialog = Object.values(ui.windows).find(w => w.element && w.element[0] === app[0]);
      if (dialog) dialog.setPosition({ height: "auto" });
    }
  });
  html.find('input[type="range"]').on('input', function() {
    $(this).siblings('.range-value').text(this.value);
  });
  html.find('.file-picker').on('click', async function(event) {
    event.preventDefault();
    const target = this.dataset.target;
    new FilePicker({
      type: "imagevideo",
      current: html.find(`[name="${target}"]`).val(),
      callback: (path) => html.find(`[name="${target}"]`).val(path)
    }).browse();
  });
}

async function _showDangerousZoneDialog() {
  const graphicsState = _buildPlacementGraphicsState("danger");

  const content = `
    <form>
      <div class="form-group">
        <label>Zone Size</label>
        <input type="number" name="size" value="1" min="0" max="10" step="0.5"/>
      </div>
      <div class="form-group">
        <label>Zone Type</label>
        <select name="type">
          <option value="Blast">Blast</option>
          <option value="Burst">Burst</option>
          <option value="Cone">Cone</option>
          <option value="Line">Line</option>
        </select>
      </div>
      <div class="form-group">
        <label>Damage Type</label>
        <select name="damageType">
          <option value="kinetic">Kinetic</option>
          <option value="explosive">Explosive</option>
          <option value="energy">Energy</option>
          <option value="heat">Heat</option>
          <option value="burn">Burn</option>
          <option value="variable">Variable</option>
        </select>
      </div>
      <div class="form-group">
        <label>Damage Value</label>
        <input type="number" name="damageValue" value="5"/>
      </div>
      <div class="form-group">
        <label>Graphics &amp; Label</label>
        <button type="button" class="tmac-configure-graphics">
          <i class="fa-solid fa-palette"></i> Configure Graphics & Label…
        </button>
        <p class="hint">Border, fill, color animation, label.</p>
      </div>
    </form>
  `;

  new Dialog({
    title: "Place Dangerous Zone",
    content,
    buttons: {
      place: {
        icon: '<i class="fas fa-check"></i>',
        label: "Place",
        callback: async (html) => {
          const size = parseFloat(html.find('[name="size"]').val()) || 1;
          const type = html.find('[name="type"]').val();
          const damageType = html.find('[name="damageType"]').val();
          const damageValue = parseInt(html.find('[name="damageValue"]').val()) || 5;
          await placeDangerousZone({ size, type, tmacGraphics: graphicsState }, damageType, damageValue);
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
    },
    default: "place",
    render: (html) => {
      html.find(".tmac-configure-graphics").on("click", async () => {
        const { openPlacementGraphicsConfig } = await import("./scripts/applications/graphics-config.mjs");
        openPlacementGraphicsConfig("danger", graphicsState, (newState) => {
          Object.assign(graphicsState, newState);
        });
      });
    }
  }).render(true);
}

async function _showStatusZoneDialog() {
  const graphicsState = _buildPlacementGraphicsState("status");
  const statusEffects = CONFIG.statusEffects || [];
  const statusOptions = statusEffects.map(s => {
    let label = s.name || s.label || s.id;
    if (label.startsWith("lancer.")) label = label.split(".").pop();
    return `<option value="${s.id}">${label.charAt(0).toUpperCase() + label.slice(1)}</option>`;
  }).join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Zone Size</label>
        <input type="number" name="size" value="1" min="0" max="10" step="0.5"/>
      </div>
      <div class="form-group">
        <label>Zone Type</label>
        <select name="type">
          <option value="Blast">Blast</option>
          <option value="Burst">Burst</option>
          <option value="Cone">Cone</option>
          <option value="Line">Line</option>
        </select>
      </div>
      <div class="form-group">
        <label>Status Effects (Ctrl+Click for multiple)</label>
        <select name="statusEffects" multiple size="8" style="width:100%">
          ${statusOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Graphics &amp; Label</label>
        <button type="button" class="tmac-configure-graphics">
          <i class="fa-solid fa-palette"></i> Configure Graphics & Label…
        </button>
        <p class="hint">Border, fill, color animation, label.</p>
      </div>
    </form>
  `;

  new Dialog({
    title: "Place Status Effect Zone",
    content,
    buttons: {
      place: {
        icon: '<i class="fas fa-check"></i>',
        label: "Place",
        callback: async (html) => {
          const size = parseFloat(html.find('[name="size"]').val()) || 1;
          const type = html.find('[name="type"]').val();
          const selected = html.find('[name="statusEffects"]').val() || [];
          if (selected.length === 0) return ui.notifications.warn("Select at least one status effect.");
          await placeZoneWithStatusEffect({ size, type, tmacGraphics: graphicsState }, selected);
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
    },
    default: "place",
    render: (html) => {
      html.find(".tmac-configure-graphics").on("click", async () => {
        const { openPlacementGraphicsConfig } = await import("./scripts/applications/graphics-config.mjs");
        openPlacementGraphicsConfig("status", graphicsState, (newState) => {
          Object.assign(graphicsState, newState);
        });
      });
    }
  }).render(true);
}

async function _showDifficultTerrainZoneDialog() {
  const graphicsState = _buildPlacementGraphicsState("difficult");
  const defaultMovementPenalty = game.settings.get(MODULE, "difficultTerrainDefaultMovementPenalty");
  const defaultFlatPenalty = game.settings.get(MODULE, "difficultTerrainDefaultFlatPenalty");

  const content = `
    <form>
      <div class="form-group">
        <label>Zone Size</label>
        <input type="number" name="size" value="1" min="0" max="10" step="0.5"/>
      </div>
      <div class="form-group">
        <label>Zone Type</label>
        <select name="type">
          <option value="Blast">Blast</option>
          <option value="Burst">Burst</option>
          <option value="Cone">Cone</option>
          <option value="Line">Line</option>
        </select>
      </div>
      <div class="form-group">
        <label>Movement Penalty (feet per hex)</label>
        <input type="number" name="movementPenalty" value="${defaultMovementPenalty}" min="1" max="20" step="1"/>
      </div>
      <div class="form-group">
        <label>Flat Penalty (adds cost; uncheck to multiply speed)</label>
        <input type="checkbox" name="isFlatPenalty" ${defaultFlatPenalty ? "checked" : ""}/>
      </div>
      <div class="form-group">
        <label>Graphics &amp; Label</label>
        <button type="button" class="tmac-configure-graphics">
          <i class="fa-solid fa-palette"></i> Configure Graphics & Label…
        </button>
        <p class="hint">Border, fill, color animation, label.</p>
      </div>
    </form>
  `;

  new Dialog({
    title: "Place Difficult Terrain Zone",
    content,
    buttons: {
      place: {
        icon: '<i class="fas fa-check"></i>',
        label: "Place",
        callback: async (html) => {
          const size = parseFloat(html.find('[name="size"]').val()) || 1;
          const type = html.find('[name="type"]').val();
          const movementPenalty = parseInt(html.find('[name="movementPenalty"]').val()) || defaultMovementPenalty;
          const isFlatPenalty = html.find('[name="isFlatPenalty"]').is(':checked');
          await placeDifficultTerrainZone({ size, type, tmacGraphics: graphicsState }, movementPenalty, isFlatPenalty);
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
    },
    default: "place",
    render: (html) => {
      html.find(".tmac-configure-graphics").on("click", async () => {
        const { openPlacementGraphicsConfig } = await import("./scripts/applications/graphics-config.mjs");
        openPlacementGraphicsConfig("difficult", graphicsState, (newState) => {
          Object.assign(graphicsState, newState);
        });
      });
    }
  }).render(true);
}

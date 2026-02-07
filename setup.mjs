import {
  findGrids,
  findContained,
  findContainers,
  placeZone,
  placeZoneWithStatusEffect,
  placeDangerousZone,
  triggerDangerousZoneFlow
} from "./scripts/api.mjs";
import { MODULE } from "./scripts/constants.mjs";
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
import { callMacro } from "./scripts/templatemacro.mjs";
import { registerPatternFillHooks, FILL_TYPES } from "./scripts/patternFill.mjs";

class ZoneConfig extends FormApplication {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
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
        fillOpacity: game.settings.get(MODULE, "dangerZoneDefaultFillOpacity"),
        borderOpacity: game.settings.get(MODULE, "dangerZoneDefaultBorderOpacity"),
        animation: game.settings.get(MODULE, "dangerZoneDefaultAnimation"),
        animationSpeed: game.settings.get(MODULE, "dangerZoneDefaultFillAnimationSpeed"),
        animationAngle: game.settings.get(MODULE, "dangerZoneDefaultFillAnimationAngle"),
        fillPulse: game.settings.get(MODULE, "dangerZoneDefaultFillPulse"),
        fillPulseSpeed: game.settings.get(MODULE, "dangerZoneDefaultFillPulseSpeed")
      },
      status: {
        fillType: game.settings.get(MODULE, "statusZoneDefaultFillType"),
        texture: game.settings.get(MODULE, "statusZoneDefaultTexture"),
        fillColor: game.settings.get(MODULE, "statusZoneDefaultFillColor"),
        fillOpacity: game.settings.get(MODULE, "statusZoneDefaultFillOpacity"),
        borderOpacity: game.settings.get(MODULE, "statusZoneDefaultBorderOpacity"),
        animation: game.settings.get(MODULE, "statusZoneDefaultAnimation"),
        animationSpeed: game.settings.get(MODULE, "statusZoneDefaultFillAnimationSpeed"),
        animationAngle: game.settings.get(MODULE, "statusZoneDefaultFillAnimationAngle"),
        fillPulse: game.settings.get(MODULE, "statusZoneDefaultFillPulse"),
        fillPulseSpeed: game.settings.get(MODULE, "statusZoneDefaultFillPulseSpeed")
      }
    };
  }

  async _updateObject(event, formData) {
    for (let [key, value] of Object.entries(formData)) {
      await game.settings.set(MODULE, key, value);
    }
  }
}

Hooks.once("setup", () => {
  game.modules.get(MODULE).api = {
    findContainers,
    findContained,
    findGrids,
    placeZone,
    placeZoneWithStatusEffect,
    placeDangerousZone,
    triggerDangerousZoneFlow
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
  Hooks.on("getMeasuredTemplateConfigHeaderButtons", _createHeaderButton);
  Hooks.on("preUpdateMeasuredTemplate", _preUpdateTemplate);
  Hooks.on("preUpdateToken", _preUpdateToken);
  Hooks.on("updateMeasuredTemplate", _updateTemplate);
  Hooks.on("updateToken", _updateToken);
  Hooks.on("preUpdateCombat", _preUpdateCombat);
  Hooks.on("updateCombat", _updateCombat);

  if (game.system.id === "lancer") {
    _registerLancerSettings();
    Hooks.on("getSceneControlButtons", (controls) => {
      const templateControls = controls.find(c => c.name === "measure");
      if (!templateControls) return;
      templateControls.tools.push(
        {
          name: "dangerousZone",
          title: "Place Dangerous Zone",
          icon: "fas fa-radiation",
          button: true,
          onClick: () => _showDangerousZoneDialog()
        },
        {
          name: "statusZone",
          title: "Place Status Effect Zone",
          icon: "fas fa-bolt",
          button: true,
          onClick: () => _showStatusZoneDialog()
        }
      );
    });
  }

  registerPatternFillHooks();
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

  // --- New Settings for Popup Configuration ---

  // Dangerous Zone - Additional Defaults
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

  game.settings.registerMenu(MODULE, "zoneConfig", {
    name: "Zone Configuration",
    label: "Configure Zones",
    hint: "Configure default settings for Dangerous and Status Zones",
    icon: "fas fa-cogs",
    type: ZoneConfig,
    restricted: true
  });
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
  // Read defaults from settings
  const defaultFillType = game.settings.get(MODULE, "dangerZoneDefaultFillType");
  const defaultTexture = game.settings.get(MODULE, "dangerZoneDefaultTexture");
  const defaultFillColor = game.settings.get(MODULE, "dangerZoneDefaultFillColor");
  const defaultFillOpacity = game.settings.get(MODULE, "dangerZoneDefaultFillOpacity");
  const defaultAnimation = game.settings.get(MODULE, "dangerZoneDefaultAnimation");
  const defaultFillPulse = game.settings.get(MODULE, "dangerZoneDefaultFillPulse");
  const defaultBorderOpacity = game.settings.get(MODULE, "dangerZoneDefaultBorderOpacity");
  const defaultAnimationSpeed = game.settings.get(MODULE, "dangerZoneDefaultFillAnimationSpeed");
  const defaultAnimationAngle = game.settings.get(MODULE, "dangerZoneDefaultFillAnimationAngle");
  const defaultFillPulseSpeed = game.settings.get(MODULE, "dangerZoneDefaultFillPulseSpeed");
  const isPattern = defaultFillType === FILL_TYPES.PATTERN;

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
        <label>Fill Type</label>
        <select name="fillType" id="dangerouszone-fillType">
          <option value="1" ${defaultFillType === FILL_TYPES.SOLID ? 'selected' : ''}>Solid</option>
          <option value="2" ${defaultFillType === FILL_TYPES.PATTERN ? 'selected' : ''}>Pattern (Stripes)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Fill Color</label>
        <input type="color" name="fillColor" value="${defaultFillColor}"/>
      </div>
      <div class="form-group">
        <label>Border Color</label>
        <input type="color" name="borderColor" value="#000000"/>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Pattern Texture</label>
        <div class="form-fields">
          <input type="text" name="fillTexture" value="${defaultTexture}"/>
          <button type="button" class="file-picker" data-type="imagevideo" data-target="fillTexture" title="Browse Files">
            <i class="fas fa-file-import"></i>
          </button>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Pattern Size</label>
        <div class="form-fields">
          <input type="range" name="fillSize" value="0.5" min="0.1" max="3" step="0.1">
          <span class="range-value">0.5</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Fill Opacity</label>
        <div class="form-fields">
          <input type="range" name="fillOpacity" value="${defaultFillOpacity}" min="0" max="1" step="0.05">
          <span class="range-value">${defaultFillOpacity}</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Border Opacity</label>
        <div class="form-fields">
          <input type="range" name="borderOpacity" value="${defaultBorderOpacity}" min="0" max="1" step="0.05">
          <span class="range-value">${defaultBorderOpacity}</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Fill Animation</label>
        <input type="checkbox" name="fillAnimation" ${defaultAnimation ? 'checked' : ''}>
      </div>
      <div class="form-group pattern-options animation-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Animation Speed</label>
        <div class="form-fields">
          <input type="range" name="fillAnimationSpeed" value="${defaultAnimationSpeed}" min="0.1" max="3" step="0.1">
          <span class="range-value">${defaultAnimationSpeed}</span>
        </div>
      </div>
      <div class="form-group pattern-options animation-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Animation Angle</label>
        <div class="form-fields">
          <input type="range" name="fillAnimationAngle" value="${defaultAnimationAngle}" min="0" max="360" step="15">
          <span class="range-value">${defaultAnimationAngle}°</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Fill Pulse</label>
        <input type="checkbox" name="fillPulse" ${defaultFillPulse ? 'checked' : ''}>
      </div>
      <div class="form-group pattern-options pulse-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Pulse Speed</label>
        <div class="form-fields">
          <input type="range" name="fillPulseSpeed" value="${defaultFillPulseSpeed}" min="0.1" max="3" step="0.1">
          <span class="range-value">${defaultFillPulseSpeed}</span>
        </div>
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
          const fillColor = html.find('[name="fillColor"]').val();
          const borderColor = html.find('[name="borderColor"]').val();
          const fillType = parseInt(html.find('[name="fillType"]').val());
          const fillTexture = html.find('[name="fillTexture"]').val();
          const fillSize = parseFloat(html.find('[name="fillSize"]').val()) || 0.5;
          const fillOpacity = parseFloat(html.find('[name="fillOpacity"]').val()) || 0.5;
          const borderOpacity = parseFloat(html.find('[name="borderOpacity"]').val()) || 0.5;
          const fillAnimation = html.find('[name="fillAnimation"]').is(':checked');
          const fillAnimationSpeed = parseFloat(html.find('[name="fillAnimationSpeed"]').val()) || 0.5;
          const fillAnimationAngle = parseFloat(html.find('[name="fillAnimationAngle"]').val()) || 0;
          const fillPulse = html.find('[name="fillPulse"]').is(':checked');
          const fillPulseSpeed = parseFloat(html.find('[name="fillPulseSpeed"]').val()) || 1;
          
          await placeDangerousZone({
            size, type, fillColor, borderColor, fillType, fillTexture, fillSize, fillOpacity, borderOpacity,
            fillAnimation, fillAnimationSpeed, fillAnimationAngle, fillPulse, fillPulseSpeed
          }, damageType, damageValue);
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
    },
    default: "place",
    render: initDialogListeners
  }).render(true);
}

async function _showStatusZoneDialog() {
  const defaults = {
    fillType: game.settings.get(MODULE, "statusZoneDefaultFillType"),
    texture: game.settings.get(MODULE, "statusZoneDefaultTexture"),
    fillColor: game.settings.get(MODULE, "statusZoneDefaultFillColor"),
    fillOpacity: game.settings.get(MODULE, "statusZoneDefaultFillOpacity"),
    animation: game.settings.get(MODULE, "statusZoneDefaultAnimation"),
    fillPulse: game.settings.get(MODULE, "statusZoneDefaultFillPulse"),
    borderOpacity: game.settings.get(MODULE, "statusZoneDefaultBorderOpacity"),
    animationSpeed: game.settings.get(MODULE, "statusZoneDefaultFillAnimationSpeed"),
    animationAngle: game.settings.get(MODULE, "statusZoneDefaultFillAnimationAngle"),
    fillPulseSpeed: game.settings.get(MODULE, "statusZoneDefaultFillPulseSpeed")
  };
  
  const isPattern = defaults.fillType === FILL_TYPES.PATTERN;
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
        <label>Fill Type</label>
        <select name="fillType" id="statuszone-fillType">
          <option value="1" ${defaults.fillType === FILL_TYPES.SOLID ? 'selected' : ''}>Solid</option>
          <option value="2" ${defaults.fillType === FILL_TYPES.PATTERN ? 'selected' : ''}>Pattern (Stripes)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Fill Color</label>
        <input type="color" name="fillColor" value="${defaults.fillColor}"/>
      </div>
      <div class="form-group">
        <label>Border Color</label>
        <input type="color" name="borderColor" value="#000000"/>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Pattern Texture</label>
        <div class="form-fields">
          <input type="text" name="fillTexture" value="${defaults.texture}"/>
          <button type="button" class="file-picker" data-type="imagevideo" data-target="fillTexture" title="Browse Files">
            <i class="fas fa-file-import"></i>
          </button>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Pattern Size</label>
        <div class="form-fields">
          <input type="range" name="fillSize" value="0.5" min="0.1" max="3" step="0.1">
          <span class="range-value">0.5</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Fill Opacity</label>
        <div class="form-fields">
          <input type="range" name="fillOpacity" value="${defaults.fillOpacity}" min="0" max="1" step="0.05">
          <span class="range-value">${defaults.fillOpacity}</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Border Opacity</label>
        <div class="form-fields">
          <input type="range" name="borderOpacity" value="${defaults.borderOpacity}" min="0" max="1" step="0.05">
          <span class="range-value">${defaults.borderOpacity}</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Fill Animation</label>
        <input type="checkbox" name="fillAnimation" ${defaults.animation ? 'checked' : ''}>
      </div>
      <div class="form-group pattern-options animation-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Animation Speed</label>
        <div class="form-fields">
          <input type="range" name="fillAnimationSpeed" value="${defaults.animationSpeed}" min="0.1" max="3" step="0.1">
          <span class="range-value">${defaults.animationSpeed}</span>
        </div>
      </div>
      <div class="form-group pattern-options animation-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Animation Angle</label>
        <div class="form-fields">
          <input type="range" name="fillAnimationAngle" value="${defaults.animationAngle}" min="0" max="360" step="15">
          <span class="range-value">${defaults.animationAngle}°</span>
        </div>
      </div>
      <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Fill Pulse</label>
        <input type="checkbox" name="fillPulse" ${defaults.fillPulse ? 'checked' : ''}>
      </div>
      <div class="form-group pattern-options pulse-options" style="${isPattern ? '' : 'display:none;'}">
        <label>Pulse Speed</label>
        <div class="form-fields">
          <input type="range" name="fillPulseSpeed" value="${defaults.fillPulseSpeed}" min="0.1" max="3" step="0.1">
          <span class="range-value">${defaults.fillPulseSpeed}</span>
        </div>
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
          const fillColor = html.find('[name="fillColor"]').val();
          const borderColor = html.find('[name="borderColor"]').val();
          const fillType = parseInt(html.find('[name="fillType"]').val());
          const fillTexture = html.find('[name="fillTexture"]').val();
          const fillSize = parseFloat(html.find('[name="fillSize"]').val()) || 0.5;
          const fillOpacity = parseFloat(html.find('[name="fillOpacity"]').val()) || 0.5;
          const borderOpacity = parseFloat(html.find('[name="borderOpacity"]').val()) || 0.5;
          const fillAnimation = html.find('[name="fillAnimation"]').is(':checked');
          const fillAnimationSpeed = parseFloat(html.find('[name="fillAnimationSpeed"]').val()) || 0.5;
          const fillAnimationAngle = parseFloat(html.find('[name="fillAnimationAngle"]').val()) || 0;
          const fillPulse = html.find('[name="fillPulse"]').is(':checked');
          const fillPulseSpeed = parseFloat(html.find('[name="fillPulseSpeed"]').val()) || 1;
          
          if (selected.length === 0) return ui.notifications.warn("Select at least one status effect.");
          
          await placeZoneWithStatusEffect({
            size, type, fillColor, borderColor, fillType, fillTexture, fillSize, fillOpacity, borderOpacity,
            fillAnimation, fillAnimationSpeed, fillAnimationAngle, fillPulse, fillPulseSpeed
          }, selected);
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
    },
    default: "place",
    render: initDialogListeners
  }).render(true);
}

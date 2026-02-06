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

  MeasuredTemplateDocument.prototype.callMacro = async function (type = "never", options = {}) {
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
});

async function _showDangerousZoneDialog() {
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
        <label>Fill Color</label>
        <input type="color" name="fillColor" value="#ff6400"/>
      </div>
      <div class="form-group">
        <label>Border Color</label>
        <input type="color" name="borderColor" value="#ffffff"/>
      </div>
      <div class="form-group">
        <label>Damage Type</label>
        <select name="damageType">
          <option value="kinetic">Kinetic</option>
          <option value="energy">Energy</option>
          <option value="explosive">Explosive</option>
          <option value="burn">Burn</option>
          <option value="heat">Heat</option>
        </select>
      </div>
      <div class="form-group">
        <label>Damage Value</label>
        <input type="number" name="damageValue" value="5" min="1"/>
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
          const sizeVal = parseFloat(html.find('[name="size"]').val());
          const size = isNaN(sizeVal) ? 1 : sizeVal;
          const type = html.find('[name="type"]').val();
          const fillColor = html.find('[name="fillColor"]').val();
          const borderColor = html.find('[name="borderColor"]').val();
          const damageType = html.find('[name="damageType"]').val();
          const damageValue = parseInt(html.find('[name="damageValue"]').val()) || 5;

          await placeDangerousZone({ size, type, fillColor, borderColor }, damageType, damageValue);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "place"
  }).render(true);
}

async function _showStatusZoneDialog() {
  const statusEffects = CONFIG.statusEffects || [];
  const statusOptions = statusEffects
    .map(s => {
      let label = s.name || s.label || s.id;
      if (label.startsWith("lancer.")) {
        label = label.split(".").pop();
      }
      label = label.charAt(0).toUpperCase() + label.slice(1);
      return { id: s.id, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(s => `<option value="${s.id}">${s.label}</option>`)
    .join("");

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
        <label>Fill Color</label>
        <input type="color" name="fillColor" value="#0088ff"/>
      </div>
      <div class="form-group">
        <label>Border Color</label>
        <input type="color" name="borderColor" value="#ffffff"/>
      </div>
      <div class="form-group">
        <label>Status Effects (Ctrl+Click for multiple)</label>
        <select name="statusEffects" multiple size="8" style="width:100%">
          ${statusOptions}
        </select>
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
          const sizeVal = parseFloat(html.find('[name="size"]').val());
          const size = isNaN(sizeVal) ? 1 : sizeVal;
          const type = html.find('[name="type"]').val();
          const fillColor = html.find('[name="fillColor"]').val();
          const borderColor = html.find('[name="borderColor"]').val();
          const selected = html.find('[name="statusEffects"]').val() || [];

          if (selected.length === 0) {
            ui.notifications.warn("Select at least one status effect.");
            return;
          }

          await placeZoneWithStatusEffect({ size, type, fillColor, borderColor }, selected);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "place"
  }).render(true);
}

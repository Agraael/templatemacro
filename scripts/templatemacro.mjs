import {MODULE, TRIGGERS} from "./constants.mjs";

/**
 * Runtime callback registry for injected functions.
 * Key: `${templateDocId}::${trigger}` (e.g. "abc123::whenEntered")
 * Value: { fn: Function, asGM: boolean }
 */
const _callbackRegistry = new Map();

/**
 * Register a runtime callback for a specific template trigger.
 * @param {string} templateId   The MeasuredTemplateDocument ID.
 * @param {string} trigger      The trigger name (e.g. "whenEntered").
 * @param {Function} fn         The function to execute: (template, scene, token, context) => {}
 * @param {boolean} [asGM=false] Whether this should only execute for the GM user.
 */
export function registerCallback(templateId, trigger, fn, asGM = false) {
  const key = `${templateId}::${trigger}`;
  _callbackRegistry.set(key, { fn, asGM });
}

/**
 * Unregister all runtime callbacks for a given template.
 * @param {string} templateId   The MeasuredTemplateDocument ID.
 */
export function unregisterCallbacks(templateId) {
  for (const key of [..._callbackRegistry.keys()]) {
    if (key.startsWith(`${templateId}::`)) {
      _callbackRegistry.delete(key);
    }
  }
}

export function renderTemplateMacroConfig(templateDocument) {
  new TemplateMacroConfig(templateDocument, {}).render(true);
}

/**
 * Execute macros.
 * First checks the runtime callback registry for an injected function.
 * Falls back to flag-based string commands if no function is registered.
 * @param {MeasuredTemplateDocument} templateDoc      The template document.
 * @param {string} whenWhat                           The trigger.
 * @param {object} context                            Object with assorted data needed to run the script.
 * @param {string} context.gmId                       The user id of the first active gm found.
 * @param {string} context.userId                     The user id of the triggering user, the one calling the script.
 */
export function callMacro(templateDoc, whenWhat, context) {
  const scene = templateDoc.parent;
  const token = scene.tokens.get(context.tokenId)?.object ?? null;

  // Check runtime callback registry first
  const registryKey = `${templateDoc.id}::${whenWhat}`;
  const registered = _callbackRegistry.get(registryKey);
  if (registered) {
    const id = registered.asGM ? context.gmId : context.userId;
    if (game.user.id !== id) return;
    templateDoc.object?.refresh();
    try {
      registered.fn(templateDoc, scene, token, context);
    } catch (e) {
      console.error(`templatemacro | Error in registered callback for ${whenWhat} on template ${templateDoc.id}:`, e);
    }
    // Runtime callback handled it — skip the flag-based command (which is the
    // auto-persisted copy of this same function, used only after page reload).
    return;
  }

  // Fall back to flag-based string commands
  const script = templateDoc.getFlag(MODULE, `${whenWhat}.command`);
  const asGM = templateDoc.getFlag(MODULE, `${whenWhat}.asGM`);
  if (!script) return;
  const body = `(async()=>{
    ${script}
  })();`;

  const id = asGM ? context.gmId : context.userId;
  if (game.user.id !== id) return;
  templateDoc.object?.refresh();
  const fn = Function("template", "scene", "token", body);

  fn.call(context, templateDoc, scene, token);
}

/**
 * Get the id of user who owns a token, but only if they are active.
 * This method prefers a player owner.
 * @param {TokenDocument} token     A token document.
 * @returns {string}                The id of a user.
 */
export function _getFirstOwnerId(token) {
  const player = game.users.find(u => !u.isGM && u.active && token.testUserPermission(u, "OWNER"));
  if (player) return player.id;
  return game.users.find(u => u.isGM && u.active)?.id;
}

export class TemplateMacroConfig extends MacroConfig {
  constructor(templateDocument, options) {
    super(templateDocument, options);
    this.initial = TRIGGERS.find(t => templateDocument.flags[MODULE]?.[t]?.command) ?? null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "modules/templatemacro/templates/templatemacro.hbs",
      classes: ["macro-sheet", "sheet", MODULE],
      tabs: [{navSelector: ".tabs", contentSelector: ".content-tabs"}],
      width: 700,
      height: 600
    });
  }

  get id() {
    return `${MODULE}-${this.object.id}`;
  }

  /** @override */
  async getData() {
    const data = await super.getData();
    data.name = `${game.i18n.localize("DOCUMENT.MeasuredTemplate")}: ${this.object.id}`;
    const flag = this.object.flags[MODULE] ?? {};
    data.triggers = TRIGGERS.map(trigger => {
      return {
        type: trigger,
        command: flag[trigger]?.command,
        asGM: flag[trigger]?.asGM,
        label: `TEMPLATEMACRO.${trigger}`,
        desc: `TEMPLATEMACRO.${trigger}Desc`,
        has: !!flag[trigger]?.command
      };
    });
    return data;
  }

  /** @override */
  async _updateObject(event, formData) {
    for (const trigger of TRIGGERS) {
      if (!formData[`flags.${MODULE}.${trigger}.command`]) {
        delete formData[`flags.${MODULE}.${trigger}.command`];
        delete formData[`flags.${MODULE}.${trigger}.asGM`];
        formData[`flags.${MODULE}.-=${trigger}`] = null;
      }
    }
    return this.object.update(formData);
  }

  /** @override */
  async _renderInner(data) {
    if (this.initial) this._tabs[0].active = this.initial;
    return super._renderInner(data);
  }
}

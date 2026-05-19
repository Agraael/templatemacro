import {MODULE, TRIGGERS} from "./constants.mjs";

// key: `${templateDocId}::${trigger}`
const _callbackRegistry = new Map();

export function registerCallback(templateId, trigger, fn, asGM = false) {
  const key = `${templateId}::${trigger}`;
  _callbackRegistry.set(key, { fn, asGM });
}

export function unregisterCallbacks(templateId) {
  for (const key of [..._callbackRegistry.keys()]) {
    if (key.startsWith(`${templateId}::`)) {
      _callbackRegistry.delete(key);
    }
  }
}

export function renderTemplateMacroConfig(document) {
  if (document?.documentName === "MeasuredTemplate") {
    document.sheet.render(true);
    return;
  }
  new TemplateMacroConfig(document, {}).render(true);
}

export function callMacro(templateDoc, whenWhat, context) {
  const scene = templateDoc.parent;
  const token = scene.tokens.get(context.tokenId)?.object ?? null;

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
    // registered callback handled it; the flag-based command is the same function persisted for reloads
    return;
  }

  const script = templateDoc.getFlag(MODULE, `${whenWhat}.command`);
  const asGM = templateDoc.getFlag(MODULE, `${whenWhat}.asGM`);
  if (script) {
    const id = asGM ? context.gmId : context.userId;
    if (game.user.id === id) {
      templateDoc.object?.refresh();
      const body = `(async()=>{\n${script}\n})();`;
      const fn = Function("template", "scene", "token", body);
      try { fn.call(context, templateDoc, scene, token); }
      catch (e) { console.error(`templatemacro | Error in legacy ${whenWhat} script:`, e); }
    }
  }

  const actions = templateDoc.getFlag(MODULE, "actions") ?? [];
  const sourceToken = _resolveTemplateSourceToken(templateDoc);
  for (const action of actions) {
    if (action.trigger !== whenWhat) continue;
    if (!_targetFilterMatches(action.targetFilter ?? "ALL", token, sourceToken)) continue;
    const id = action.asGM ? context.gmId : context.userId;
    if (game.user.id !== id) continue;
    templateDoc.object?.refresh();
    try {
      if (action.actionType === "code" && action.code) {
        const body = `(async()=>{\n${action.code}\n})();`;
        const fn = Function("template", "scene", "token", body);
        fn.call(context, templateDoc, scene, token);
      } else if (action.actionType === "macro" && action.macroUuid) {
        const macro = fromUuidSync(action.macroUuid);
        if (macro?.execute) macro.execute({ template: templateDoc, scene, token, actor: token?.actor });
      } else if (action.actionType === "effect" && action.effectName) {
        if (!token?.actor) continue;
        const a = token.actor;
        const tid = templateDoc.id;
        const sid = action.effectName;
        if (action.effectMode === "remove") {
          const e = a.effects.find(x => x.statuses.has(sid) && x.getFlag(MODULE, "sourceTemplate") === tid);
          if (e) a.deleteEmbeddedDocuments("ActiveEffect", [e.id]);
        } else {
          const exists = a.effects.find(x => x.statuses.has(sid) && x.getFlag(MODULE, "sourceTemplate") === tid);
          if (!exists) {
            const def = CONFIG.statusEffects.find(x => x.id === sid);
            if (def) {
              const name = game.i18n.localize(def.name || def.label || sid);
              a.createEmbeddedDocuments("ActiveEffect", [{ ...def, name, statuses: [sid], "flags.templatemacro.sourceTemplate": tid }]);
            }
          }
        }
      }
    } catch (e) {
      console.error(`templatemacro | Error in action (${action.trigger} / ${action.actionType}):`, e);
    }
  }
}

function _resolveTemplateSourceToken(templateDoc) {
  if (!templateDoc) return null;
  const scene = templateDoc.parent;
  const attachedId = templateDoc.getFlag(MODULE, "attachedTokenId");
  if (attachedId) {
    const t = scene?.tokens.get(attachedId)?.object;
    if (t) return t;
  }
  const user = game.users.get(templateDoc.user) ?? game.user;
  return user?.character?.getActiveTokens?.()[0] ?? null;
}

function _targetFilterMatches(filterId, targetToken, sourceToken) {
  if (!filterId || filterId === "ALL") return true;
  if (!targetToken) return false;
  if (filterId.startsWith("ACTORTYPE_")) {
    return targetToken.actor?.type === filterId.slice("ACTORTYPE_".length);
  }
  if (filterId.startsWith("TEAM_")) {
    const teamId = filterId.slice("TEAM_".length);
    const tokenTeamId = targetToken.actor?.getFlag("token-factions", "team");
    return tokenTeamId === teamId;
  }
  const disp = _resolveDisposition(targetToken, sourceToken);
  if (filterId === "FRIENDLY") return disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  if (filterId === "NEUTRAL") return disp === CONST.TOKEN_DISPOSITIONS.NEUTRAL;
  if (filterId === "HOSTILE") return disp === CONST.TOKEN_DISPOSITIONS.HOSTILE;
  return true;
}

function _resolveDisposition(target, source) {
  const tf = game.modules.get("token-factions")?.api;
  if (tf && typeof tf.getDisposition === "function" && source) {
    try { return tf.getDisposition(source, target); }
    catch { /* fall through */ }
  }
  return target.document.disposition;
}

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

  async _renderInner(data) {
    if (this.initial) this._tabs[0].active = this.initial;
    return super._renderInner(data);
  }
}

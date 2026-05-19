/* global game, fetch, Dialog, foundry, window, console */

export async function checkModuleUpdate(moduleId) {
  if (!game.user.isGM) return;
  const module = game.modules.get(moduleId);
  if (!module) return;
  const manifestUrl = module.manifest;
  if (!manifestUrl) return;

  try {
    let remoteVersion;
    let releaseNotes = "";

    if (manifestUrl.includes("github.com") && manifestUrl.includes("/releases/")) {
      const parts = manifestUrl.split("/");
      const owner = parts[3];
      const repo = parts[4];
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
      const apiResponse = await fetch(apiUrl);
      if (apiResponse.ok) {
        const allReleases = await apiResponse.json();
        const missed = allReleases.filter(r => {
          const v = r.tag_name.replace(/^v/, "");
          return foundry.utils.isNewerVersion(v, module.version);
        });
        if (missed.length > 0) {
          remoteVersion = missed[0].tag_name.replace(/^v/, "");
          releaseNotes = missed.map(r => `## ${r.tag_name}\n${r.body || ""}`).join("\n\n---\n\n");
        }
      } else {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/module.json`;
        const rawResponse = await fetch(rawUrl);
        if (rawResponse.ok) {
          const remoteManifest = await rawResponse.json();
          remoteVersion = remoteManifest.version;
        }
      }
    } else {
      const response = await fetch(manifestUrl);
      if (response.ok) {
        const remoteManifest = await response.json();
        remoteVersion = remoteManifest.version;
      }
    }

    if (remoteVersion && foundry.utils.isNewerVersion(remoteVersion, module.version)) {
      const lastNotified = game.settings.get(moduleId, "lastNotifiedVersion");
      if (lastNotified !== remoteVersion) {
        _showUpdateDialog(module, remoteVersion, releaseNotes);
      }
    }
  } catch (error) {
    console.error(`${moduleId} | version check failed:`, error);
  }
}

function _showUpdateDialog(module, newVersion, releaseNotes = "") {
  let notesHtml = "";
  if (releaseNotes && window.showdown?.Converter) {
    const converter = new window.showdown.Converter();
    const htmlNotes = converter.makeHtml(releaseNotes);
    notesHtml = `
      <h3 style="margin-top: 12px;">Release notes</h3>
      <div style="max-height: 260px; overflow-y: auto; padding: 8px 10px; border: 1px solid var(--color-border-light-tertiary); border-radius: 4px; background: rgb(135 135 135 / 8%);">${htmlNotes}</div>`;
  }

  const dialogContent = `
    <p>A new version of <b>${module.title}</b> is available: <b>v${newVersion}</b> (current: v${module.version})</p>
    <p>Update it via the Foundry Module Manager.</p>
    ${notesHtml}`;

  new Dialog({
    title: `${module.title} update`,
    content: dialogContent,
    buttons: {
      dismiss: {
        icon: '<i class="fa-solid fa-xmark"></i>',
        label: "Dismiss",
        callback: () => game.settings.set(module.id, "lastNotifiedVersion", newVersion)
      },
      later: {
        icon: '<i class="fa-solid fa-clock"></i>',
        label: "Remind me later"
      }
    },
    default: "dismiss"
  }, { width: 520 }).render(true);
}

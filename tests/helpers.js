import { Window } from "happy-dom";

/** Boots a DOM, loads the card module once, and returns factories for tests. */
let loaded = false;

export async function boot() {
  if (!loaded) {
    const win = new Window({ url: "http://localhost:8123" });
    for (const k of ["window", "document", "HTMLElement", "customElements", "CustomEvent", "Event"]) {
      globalThis[k] = k === "window" ? win : win[k];
    }
    /** The card asks Home Assistant to build its children; here they are stubs. */
    globalThis.window.loadCardHelpers = async () => ({
      createCardElement: (config) => {
        const el = globalThis.document.createElement("div");
        el.setAttribute("data-type", config.type);
        el.getCardSize = () => 1;
        return el;
      }
    });
    /** Home Assistant's own child editor, stubbed so the editor takes its real path. */
    if (!globalThis.customElements.get("hui-card-element-editor")) {
      globalThis.customElements.define("hui-card-element-editor", class extends globalThis.HTMLElement {});
    }
    await import("../dist/frame-card.js");
    loaded = true;
  }
}

export const sensor = (state, attributes = {}) => ({ state: String(state), attributes });

export const fakeHass = (states = {}) => ({ states });

/** Builds a card, applies config and hass, waits for the children, returns it. */
export async function makeCard(config, hass) {
  await boot();
  const el = globalThis.document.createElement("frame-card");
  el.setConfig(config);
  if (hass) el.hass = hass;
  await tick();
  return el;
}

/** Builds the editor with a config applied, ready to inspect. */
export async function makeEditor(config = { cards: [] }, hass) {
  await boot();
  const ed = globalThis.document.createElement("frame-card-editor");
  ed.setConfig({ type: "custom:frame-card", ...config });
  if (hass) ed.hass = hass;
  return ed;
}

/** The config the editor would hand back after a change. */
export function emitted(ed, fn) {
  let out = null;
  ed.addEventListener("config-changed", (e) => { out = e.detail.config; });
  fn();
  return out;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
export const $ = (el, id) => el.shadowRoot.getElementById(id);
export const kids = (el) => Array.from($(el, "right").children);
export const form = (ed) => ed.querySelector("ha-form");
export const chooser = (ed) => Array.from(ed.querySelectorAll("ha-form")).at(-1);
export const tabs = (ed) => Array.from(ed.querySelectorAll(".tabs button"));
export const tools = (ed) => Array.from(ed.querySelectorAll(".tools button"));

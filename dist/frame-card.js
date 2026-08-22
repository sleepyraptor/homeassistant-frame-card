/**
 * Frame Card
 * One frame around several cards, with a fill bar and an optional status strip.
 * Everything is set from the visual editor: no templates, no CSS.
 * https://github.com/sleepyraptor/homeassistant-frame-card
 */
const VERSION = "0.1.0";

/** Home Assistant colour tokens become CSS variables; anything else is passed through. */
const TOKENS = new Set([
  "primary", "accent", "disabled", "red", "pink", "purple", "deep-purple",
  "indigo", "blue", "light-blue", "cyan", "teal", "green", "light-green",
  "lime", "yellow", "amber", "orange", "deep-orange", "brown", "grey",
  "blue-grey", "black", "white"
]);

const colour = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return TOKENS.has(s) ? `var(--${s}-color)` : s;
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Children keep their content but lose their own frame: the outer one is the only card drawn. */
const MERGE = {
  "--ha-card-background": "transparent",
  "--card-background-color": "transparent",
  "--ha-card-border-width": "0",
  "--ha-card-box-shadow": "none",
  "--ha-card-border-radius": "0"
};

/** Fixed: the frame is a frame. Nothing here is worth a knob in the editor. */
const RADIUS = 20;
const STRIP = 15;
const BAR = 5;

const C = `
:host{display:block}
ha-card{position:relative;overflow:hidden;box-sizing:border-box;padding:0;border-radius:${RADIUS}px}
#body{position:relative;z-index:1;display:flex;flex-direction:row;align-items:center;box-sizing:border-box;min-height:64px;padding-bottom:${BAR}px}
#info{display:flex;align-items:center;gap:12px;flex:1 1 50%;min-width:0;padding:10px 8px;cursor:pointer}
#icon{flex:0 0 auto;--mdc-icon-size:28px;transition:color .8s ease-in-out}
.txt{min-width:0}
#name{font-size:16px;font-weight:700;line-height:1.2;color:var(--primary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sub{font-size:12px;line-height:1.3;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#right{display:flex;flex-direction:row;align-items:center;flex:1 1 50%;min-width:0}
#right.wide{flex:1 1 100%}
#right>*{flex:1 1 0;min-width:0}
#strip{position:absolute;left:0;top:0;bottom:0;width:${STRIP}px;z-index:2;pointer-events:none;transition:background .8s ease-in-out}
#track{position:absolute;right:0;bottom:0;height:${BAR}px;z-index:2;pointer-events:none;overflow:hidden}
#bar{height:100%;width:0;opacity:.9;transition:width .8s ease-in-out,background .8s ease-in-out}
`;

/** A state as a person reads it: durations in minutes, percentages tight, the rest as it comes. */
const fmt = (hass, id) => {
  const st = hass && hass.states[id];
  if (!st) return "—";
  const n = num(st.state);
  if (n === null) return st.state;
  const unit = st.attributes.unit_of_measurement;
  if (unit === "s") return `${Math.round(n / 60)} min`;
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  if (!unit) return `${r}`;
  return unit === "%" ? `${r}%` : `${r} ${unit}`;
};

class FrameCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._cards = [];
    this._token = null;
  }

  static getStubConfig(hass, entities) {
    const first = (entities || []).find((e) => e.startsWith("sensor.")) || "sun.sun";
    return { entity: first, cards: [{ type: "tile", entity: first }] };
  }

  static async getConfigElement() {
    await loadEditorParts();
    return document.createElement("frame-card-editor");
  }

  setConfig(config) {
    const cards = config && config.cards;
    if (!Array.isArray(cards) || cards.length === 0) {
      throw new Error("frame-card: add at least one card");
    }
    if (!config.entity) {
      throw new Error("frame-card: pick the entity that fills the bar");
    }
    const c = { min: 0, max: 100, color: "green", strip: false, ...config };
    c.info = Array.isArray(c.info) ? c.info : (c.info ? [c.info] : []);
    if (c.max === c.min) {
      throw new Error("frame-card: 'full at' must differ from 'empty at'");
    }
    this._config = c;
    this._draw();
    this._paint();
  }

  /** The skeleton: frame, body, strip, bar. Rebuilt on setConfig. */
  _draw() {
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${C}</style><ha-card id="frame"><div id="body"></div></ha-card>`;
    const frame = this.shadowRoot.getElementById("frame");
    this._body = this.shadowRoot.getElementById("body");
    this._body.style.paddingLeft = c.strip ? `${STRIP}px` : "0px";

    if (c.strip) {
      const el = document.createElement("div");
      el.id = "strip";
      frame.appendChild(el);
      this._strip = el;
    } else {
      this._strip = null;
    }

    this._side = c.name || c.info.length ? this._sidebar() : null;
    if (this._side) this._body.appendChild(this._side);

    this._right = document.createElement("div");
    this._right.id = "right";
    if (!this._side) this._right.classList.add("wide");
    this._body.appendChild(this._right);

    const track = document.createElement("div");
    track.id = "track";
    track.style.left = c.strip ? `${STRIP}px` : "0px";
    this._bar = document.createElement("div");
    this._bar.id = "bar";
    track.appendChild(this._bar);
    frame.appendChild(track);

    this._children();
  }

  /** The left half: an icon, a name, and a line of values. Drawn here, not configured in code. */
  _sidebar() {
    const box = document.createElement("div");
    box.id = "info";
    this._iconEl = document.createElement("ha-icon");
    this._iconEl.id = "icon";
    const txt = document.createElement("div");
    txt.className = "txt";
    this._nameEl = document.createElement("div");
    this._nameEl.id = "name";
    this._subEl = document.createElement("div");
    this._subEl.id = "sub";
    txt.appendChild(this._nameEl);
    txt.appendChild(this._subEl);
    box.appendChild(this._iconEl);
    box.appendChild(txt);
    box.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId: this._config.entity },
        bubbles: true,
        composed: true
      }));
    });
    return box;
  }

  /** Builds the child cards and hands them the frame's styling. */
  async _children() {
    const token = {};
    this._token = token;
    const helpers = await window.loadCardHelpers();
    if (this._token !== token) return;
    const built = [];
    for (const cfg of this._config.cards) {
      const el = helpers.createCardElement(cfg);
      for (const [k, v] of Object.entries(MERGE)) el.style.setProperty(k, v);
      if (this._hass) el.hass = this._hass;
      built.push(el);
      this._right.appendChild(el);
    }
    this._cards = built;
  }

  set hass(hass) {
    this._hass = hass;
    for (const el of this._cards) el.hass = hass;
    this._paint();
  }

  /** How full the bar is, as a share of empty..full. */
  _share() {
    const c = this._config;
    if (!this._hass) return null;
    const state = (this._hass.states[c.entity] || {}).state;
    const v = num(state);
    if (v === null) return null;
    return clamp((v - c.min) / (c.max - c.min), 0, 1);
  }

  /** Green until a threshold is crossed, red while the alert state is on. */
  _colour(share) {
    const c = this._config;
    if (c.alert_entity && c.alert_state && this._hass) {
      const now = (this._hass.states[c.alert_entity] || {}).state;
      if (String(now) === String(c.alert_state)) return colour("red");
    }
    if (share !== null) {
      const pct = share * 100;
      if (num(c.danger_below) !== null && pct < c.danger_below) return colour("red");
      if (num(c.warn_below) !== null && pct < c.warn_below) return colour("amber");
    }
    return colour(c.color) || "var(--primary-color)";
  }

  _paint() {
    if (!this._config || !this._bar) return;
    const c = this._config;
    const share = this._share();
    const tint = this._colour(share);
    this._bar.style.width = `${(share === null ? 0 : share) * 100}%`;
    this._bar.style.background = tint;
    if (this._strip) this._strip.style.background = tint;
    if (!this._side) return;

    const own = (this._hass && this._hass.states[c.entity]) || { attributes: {} };
    this._nameEl.textContent = c.name || own.attributes.friendly_name || c.entity;
    this._subEl.textContent = (c.info.length ? c.info : [c.entity])
      .map((id) => fmt(this._hass, id))
      .join(" · ");
    const icon = c.icon || own.attributes.icon;
    if (icon) this._iconEl.setAttribute("icon", icon);
    this._iconEl.style.color = tint;
  }

  getCardSize() {
    const sizes = this._cards.map((el) => (el.getCardSize ? el.getCardSize() : 1));
    return sizes.reduce((a, b) => a + (typeof b === "number" ? b : 1), 0) || 2;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 3 };
  }
}

if (!customElements.get("frame-card")) customElements.define("frame-card", FrameCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "frame-card",
  name: "Frame",
  description: "One frame around several cards, with a fill bar and an optional status strip",
  preview: true,
  documentationURL: "https://github.com/sleepyraptor/homeassistant-frame-card"
});
console.info(
  `%c FRAME-CARD %c v${VERSION} `,
  "color:#fff;background:#5c6bc0;font-weight:700",
  "color:#5c6bc0;background:#e8eaf6;font-weight:700"
);

/* ------------------------------------------------------------------ editor */

/**
 * The child card editors are Home Assistant's own, and they load lazily:
 * building a built-in stack editor once is what registers them.
 */
async function loadEditorParts() {
  if (customElements.get("hui-card-element-editor")) return;
  const helpers = await window.loadCardHelpers();
  const stack = await helpers.createCardElement({ type: "vertical-stack", cards: [] });
  const cls = stack && stack.constructor;
  if (cls && cls.getConfigElement) await cls.getConfigElement();
}

/**
 * The card types offered when adding a child: Home Assistant's own, plus every
 * custom card installed. Home Assistant's picker lives inside a dialog that is
 * not loaded until the user opens it, so the list is built here instead.
 */
const BUILTIN = [
  "tile", "heading", "entities", "markdown", "grid", "button", "gauge",
  "picture", "picture-entity", "light", "thermostat", "media-control",
  "history-graph", "sensor", "todo-list", "calendar", "clock"
];

/** A new child starts with whatever its type cannot do without. */
const SKELETON = { markdown: { content: "" }, grid: { cards: [] } };

const cardTypes = () => {
  const custom = (window.customCards || [])
    .map((c) => ({ value: `custom:${c.type}`, label: c.name || c.type }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...BUILTIN.map((t) => ({ value: t, label: t })), ...custom];
};

/** The unit tells us what a full bar means, so nobody has to work it out. */
const FULL_BY_UNIT = { "%": 100, s: 3600, min: 60, h: 24, V: 250, W: 3000 };

const SCHEMA = [
  { type: "grid", schema: [
    { name: "name", selector: { text: {} } },
    { name: "icon", selector: { icon: {} } }
  ] },
  { name: "info", selector: { entity: { multiple: true } } },
  { name: "entity", selector: { entity: { domain: ["sensor", "number", "input_number", "counter"] } } },
  { type: "grid", schema: [
    { name: "min", selector: { number: { mode: "box" } } },
    { name: "max", selector: { number: { mode: "box" } } }
  ] },
  { name: "color", selector: { ui_color: { include_state: false } } },
  { type: "grid", schema: [
    { name: "warn_below", selector: { number: { min: 0, max: 100, mode: "box", unit_of_measurement: "%" } } },
    { name: "danger_below", selector: { number: { min: 0, max: 100, mode: "box", unit_of_measurement: "%" } } }
  ] },
  { type: "grid", schema: [
    { name: "alert_entity", selector: { entity: {} } },
    { name: "alert_state", selector: { state: {} }, context: { filter_entity: "alert_entity" } }
  ] },
  { name: "strip", selector: { boolean: {} } }
];

const LAB = {
  name: "Name", icon: "Icon", info: "Values shown on the left",
  entity: "Bar follows", min: "Empty at", max: "Full at", color: "Colour",
  warn_below: "Amber below", danger_below: "Red below",
  alert_entity: "Red when", alert_state: "is",
  strip: "Show the status strip"
};

const HELP = {
  name: "Left empty, the bar entity's own name is used",
  info: "Their values are shown in one line. Left empty, the bar entity's value is shown",
  entity: "The value the bar measures",
  min: "The value that shows an empty bar",
  max: "The value that shows a full bar",
  warn_below: "Share of the bar, not the value. Leave empty to never turn amber",
  danger_below: "Leave empty to never turn red",
  alert_entity: "Optional: a state that turns everything red, whatever the level",
  strip: "A coloured band down the left edge, in the same colour as the bar"
};

const DEFAULTS = { min: 0, max: 100, color: "green", strip: false };

const ECSS = `
.cards{margin-top:24px}
.head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.lbl{font-weight:500;margin-right:auto}
.tabs,.tools{display:flex;gap:4px;align-items:center}
.tabs button,.tools button{height:32px;min-width:32px;padding:0 6px;border-radius:8px;background:none;font:inherit;cursor:pointer;color:var(--secondary-text-color);border:1px solid transparent}
.tabs button{border-color:var(--divider-color)}
.tabs button.on{border-color:var(--primary-color);color:var(--primary-color)}
.tools button[disabled]{opacity:.4;cursor:default}
`;

class FrameCardEditor extends HTMLElement {
  constructor() {
    super();
    this._sel = 0;
    this._adding = false;
  }

  setConfig(config) {
    const c = { ...(config || {}) };
    delete c.type;
    if (!Array.isArray(c.cards)) c.cards = [];
    this._config = c;
    if (this._sel > c.cards.length - 1) this._sel = Math.max(0, c.cards.length - 1);
    this._render();
  }

  set hass(hass) { this._hass = hass; this._pass(); }
  set lovelace(lovelace) { this._lovelace = lovelace; this._pass(); }

  /** hass and lovelace have to reach the form and whatever child editor is mounted. */
  _pass() {
    if (this._form && this._hass) this._form.hass = this._hass;
    const child = this._slot && this._slot.firstElementChild;
    if (child) {
      if (this._hass) child.hass = this._hass;
      if (this._lovelace) child.lovelace = this._lovelace;
    }
  }

  _render() {
    if (!this._form) {
      const style = document.createElement("style");
      style.textContent = ECSS;
      this.appendChild(style);

      this._form = document.createElement("ha-form");
      this._form.schema = SCHEMA;
      this._form.computeLabel = (s) => LAB[s.name] || s.name;
      this._form.computeHelper = (s) => HELP[s.name] || "";
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        this._emit(this._clean(e.detail.value));
      });
      this.appendChild(this._form);

      const box = document.createElement("div");
      box.className = "cards";
      box.innerHTML =
        '<div class="head"><span class="lbl">Cards</span>' +
        '<div class="tabs"></div><div class="tools"></div></div><div class="slot"></div>';
      this.appendChild(box);
      this._tabs = box.querySelector(".tabs");
      this._tools = box.querySelector(".tools");
      this._slot = box.querySelector(".slot");
    }
    const data = { ...DEFAULTS, ...this._config };
    delete data.cards;
    this._form.data = data;
    this._drawTabs();
    this._drawSlot();
    this._pass();
  }

  /**
   * Form data back to a config: defaults are not written out, and picking an
   * entity fills in what a full bar means for its unit.
   */
  _clean(v) {
    const out = { ...v };
    if (out.entity && out.entity !== this._config.entity && this._hass) {
      const unit = (this._hass.states[out.entity] || { attributes: {} }).attributes.unit_of_measurement;
      const full = FULL_BY_UNIT[unit];
      if (full && (out.max === undefined || out.max === DEFAULTS.max)) out.max = full;
    }
    for (const [k, def] of Object.entries(DEFAULTS)) if (out[k] === def) delete out[k];
    for (const k of Object.keys(out)) {
      if (out[k] === undefined || out[k] === "" || out[k] === null) delete out[k];
      else if (Array.isArray(out[k]) && !out[k].length) delete out[k];
    }
    out.cards = this._config.cards;
    return out;
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: { type: "custom:frame-card", ...config } },
      bubbles: true,
      composed: true
    }));
  }

  _button(where, label, fn, disabled, icon) {
    const b = document.createElement("button");
    b.type = "button";
    if (icon) {
      const i = document.createElement("ha-icon");
      i.setAttribute("icon", icon);
      b.appendChild(i);
      b.title = label;
    } else {
      b.textContent = label;
    }
    if (disabled) b.disabled = true;
    else b.addEventListener("click", fn);
    where.appendChild(b);
    return b;
  }

  _drawTabs() {
    const n = this._config.cards.length;
    this._tabs.innerHTML = "";
    this._tools.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const b = this._button(this._tabs, String(i + 1), () => {
        this._sel = i;
        this._adding = false;
        this._drawTabs();
        this._drawSlot();
      });
      if (i === this._sel && !this._adding) b.classList.add("on");
    }
    const add = this._button(this._tabs, "+", () => {
      this._adding = true;
      this._drawTabs();
      this._drawSlot();
    });
    add.title = "Add a card";
    if (this._adding) add.classList.add("on");

    if (!this._adding && n) {
      this._button(this._tools, "Move left", () => this._move(-1), this._sel === 0, "mdi:arrow-left");
      this._button(this._tools, "Move right", () => this._move(1), this._sel === n - 1, "mdi:arrow-right");
      this._button(this._tools, "Remove", () => this._remove(), false, "mdi:delete");
    }
  }

  _drawSlot() {
    this._slot.innerHTML = "";
    if (this._adding || !this._config.cards.length) {
      this._slot.appendChild(this._chooser());
      this._pass();
      return;
    }
    const ed = document.createElement("hui-card-element-editor");
    ed.value = this._config.cards[this._sel];
    ed.addEventListener("config-changed", (e) => {
      e.stopPropagation();
      const cards = [...this._config.cards];
      cards[this._sel] = e.detail.config;
      this._emit({ ...this._config, cards });
    });
    this._slot.appendChild(ed);
    this._pass();
  }

  /** Picking a type appends the card and opens it for editing. */
  _chooser() {
    const form = document.createElement("ha-form");
    form.schema = [{ name: "type", selector: { select: {
      mode: "dropdown", custom_value: true, sort: false, options: cardTypes()
    } } }];
    form.data = {};
    form.computeLabel = () => "Card to add";
    form.addEventListener("value-changed", (e) => {
      e.stopPropagation();
      const type = e.detail.value && e.detail.value.type;
      if (!type) return;
      const cards = [...this._config.cards, { type, ...(SKELETON[type] || {}) }];
      this._sel = cards.length - 1;
      this._adding = false;
      this._emit({ ...this._config, cards });
      this._render();
    });
    return form;
  }

  _move(step) {
    const cards = [...this._config.cards];
    const to = this._sel + step;
    if (to < 0 || to >= cards.length) return;
    const moved = cards[this._sel];
    cards[this._sel] = cards[to];
    cards[to] = moved;
    this._sel = to;
    this._emit({ ...this._config, cards });
    this._render();
  }

  _remove() {
    const cards = this._config.cards.filter((_, i) => i !== this._sel);
    this._sel = Math.max(0, Math.min(this._sel, cards.length - 1));
    this._emit({ ...this._config, cards });
    this._render();
  }
}

if (!customElements.get("frame-card-editor")) customElements.define("frame-card-editor", FrameCardEditor);

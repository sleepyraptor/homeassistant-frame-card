import test from "node:test";
import assert from "node:assert/strict";
import { makeEditor, emitted, fakeHass, sensor, form, chooser, tabs, tools } from "./helpers.js";

const TILE = { type: "tile", entity: "sensor.a" };
const OTHER = { type: "tile", entity: "sensor.b" };
const BASE = { cards: [TILE], entity: "sensor.level" };

const names = (schema, out = []) => {
  for (const node of schema) {
    if (node.name) out.push(node.name);
    if (node.schema) names(node.schema, out);
  }
  return out;
};

test("the form asks for exactly the options the card has, nothing technical", async () => {
  const ed = await makeEditor(BASE);
  assert.deepEqual(names(form(ed).schema).sort(), [
    "alert_entity", "alert_state", "color", "danger_below", "entity", "icon", "info",
    "max", "min", "name", "strip", "warn_below"
  ]);
});

test("every option is a picker, a number or a switch — never free code", async () => {
  const ed = await makeEditor(BASE);
  const leaves = [];
  const walk = (schema) => {
    for (const node of schema) {
      if (node.selector) leaves.push(Object.keys(node.selector)[0]);
      if (node.schema) walk(node.schema);
    }
  };
  walk(form(ed).schema);
  for (const kind of leaves) {
    assert.ok(["entity", "number", "ui_color", "boolean", "state", "icon", "text"].includes(kind),
      `unexpected control: ${kind}`);
  }
  assert.equal(leaves.includes("template"), false, "no template editor");
  assert.equal(leaves.filter((k) => k === "text").length, 1, "the name is the only thing typed by hand");
});

test("a form change comes back as a card config, type included", async () => {
  const ed = await makeEditor(BASE);
  const config = emitted(ed, () => {
    form(ed).dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { entity: "sensor.level", min: 0, max: 3600, color: "green", strip: true } }
    }));
  });
  assert.equal(config.type, "custom:frame-card");
  assert.equal(config.max, 3600);
  assert.equal(config.strip, true);
  assert.deepEqual(config.cards, [TILE], "the children survive an option change");
});

test("what is left at its default is not written into the config", async () => {
  const ed = await makeEditor(BASE);
  const config = emitted(ed, () => {
    form(ed).dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { entity: "sensor.level", min: 0, max: 100, color: "green", strip: false } }
    }));
  });
  assert.deepEqual(Object.keys(config).sort(), ["cards", "entity", "type"]);
});

test("picking an entity works out what a full bar means from its unit", async () => {
  const hass = fakeHass({
    "sensor.runtime": sensor(3403, { unit_of_measurement: "s" }),
    "sensor.charge": sensor(100, { unit_of_measurement: "%" })
  });
  const ed = await makeEditor({ cards: [TILE] }, hass);
  const seconds = emitted(ed, () => {
    form(ed).dispatchEvent(new CustomEvent("value-changed", { detail: { value: { entity: "sensor.runtime" } } }));
  });
  assert.equal(seconds.max, 3600, "seconds get a one-hour bar");

  const ed2 = await makeEditor({ cards: [TILE] }, hass);
  const percent = emitted(ed2, () => {
    form(ed2).dispatchEvent(new CustomEvent("value-changed", { detail: { value: { entity: "sensor.charge" } } }));
  });
  assert.equal(percent.max, undefined, "a percentage is already 0-100, so nothing is written");
});

test("the children are listed one tab each, plus add", async () => {
  const ed = await makeEditor({ ...BASE, cards: [TILE, OTHER] });
  assert.deepEqual(tabs(ed).map((b) => b.textContent), ["1", "2", "+"]);
  assert.ok(ed.querySelector("hui-card-element-editor"), "the selected child opens for editing");
  assert.equal(ed.querySelector("hui-card-element-editor").value, TILE);
});

test("editing a child replaces only that child", async () => {
  const ed = await makeEditor({ ...BASE, cards: [TILE, OTHER] });
  tabs(ed)[1].click();
  const edited = { type: "tile", entity: "sensor.b", name: "Renamed" };
  const config = emitted(ed, () => {
    ed.querySelector("hui-card-element-editor").dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: edited } })
    );
  });
  assert.deepEqual(config.cards, [TILE, edited]);
});

test("children can be reordered and removed", async () => {
  const ed = await makeEditor({ ...BASE, cards: [TILE, OTHER] });
  const moved = emitted(ed, () => tools(ed)[1].click());
  assert.deepEqual(moved.cards, [OTHER, TILE]);

  const ed2 = await makeEditor({ ...BASE, cards: [TILE, OTHER] });
  const removed = emitted(ed2, () => tools(ed2)[2].click());
  assert.deepEqual(removed.cards, [OTHER]);
});

test("moving is refused at the ends", async () => {
  const ed = await makeEditor({ ...BASE, cards: [TILE, OTHER] });
  assert.equal(tools(ed)[0].disabled, true);
  tabs(ed)[1].click();
  assert.equal(tools(ed)[1].disabled, true);
});

test("with no children the type chooser is shown, and picking appends", async () => {
  const ed = await makeEditor({ cards: [] });
  const options = chooser(ed).schema[0].selector.select.options.map((o) => o.value);
  assert.ok(options.includes("tile"));
  assert.ok(options.includes("custom:frame-card"), "installed custom cards are offered too");

  const config = emitted(ed, () => {
    chooser(ed).dispatchEvent(new CustomEvent("value-changed", { detail: { value: { type: "grid" } } }));
  });
  assert.deepEqual(config.cards, [{ type: "grid", cards: [] }], "a grid is given the list it needs");
  assert.ok(ed.querySelector("hui-card-element-editor"), "the new child opens for editing");
});

test("a stale selection is clamped when the config shrinks", async () => {
  const ed = await makeEditor({ ...BASE, cards: [TILE, OTHER] });
  tabs(ed)[1].click();
  ed.setConfig({ type: "custom:frame-card", ...BASE, cards: [TILE] });
  assert.deepEqual(tabs(ed).map((b) => b.textContent), ["1", "+"]);
});

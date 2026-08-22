import test from "node:test";
import assert from "node:assert/strict";
import { boot, makeCard, fakeHass, sensor, $, kids } from "./helpers.js";

const TILE = { type: "tile", entity: "sensor.a" };
const BASE = { cards: [TILE], entity: "sensor.level" };

test("setConfig rejects a card with nothing to show", async () => {
  await boot();
  const el = document.createElement("frame-card");
  assert.throws(() => el.setConfig({ entity: "sensor.a" }), /add at least one card/);
  assert.throws(() => el.setConfig({ cards: [] }), /add at least one card/);
  assert.throws(() => el.setConfig({ cards: [TILE] }), /pick the entity that fills the bar/);
  assert.throws(() => el.setConfig({ cards: [TILE], entity: "sensor.a", min: 5, max: 5 }), /'full at' must differ/);
});

test("the bar fills to the value's share of empty..full", async () => {
  const el = await makeCard({ ...BASE, min: 0, max: 3600 }, fakeHass({ "sensor.level": sensor(1800) }));
  assert.equal($(el, "bar").style.width, "50%");
});

test("values outside the range are clamped, not overflowed", async () => {
  const over = await makeCard({ ...BASE, max: 100 }, fakeHass({ "sensor.level": sensor(140) }));
  assert.equal($(over, "bar").style.width, "100%");
  const under = await makeCard({ ...BASE, min: 20, max: 100 }, fakeHass({ "sensor.level": sensor(5) }));
  assert.equal($(under, "bar").style.width, "0%");
});

test("an unavailable entity leaves the bar empty rather than breaking", async () => {
  const el = await makeCard(BASE, fakeHass({ "sensor.level": sensor("unavailable") }));
  assert.equal($(el, "bar").style.width, "0%");
});

test("the colour is the chosen one until a threshold is crossed", async () => {
  const cfg = { ...BASE, color: "blue", warn_below: 50, danger_below: 20 };
  const ok = await makeCard(cfg, fakeHass({ "sensor.level": sensor(80) }));
  assert.equal($(ok, "bar").style.background, "var(--blue-color)");

  const warn = await makeCard(cfg, fakeHass({ "sensor.level": sensor(40) }));
  assert.equal($(warn, "bar").style.background, "var(--amber-color)");

  const danger = await makeCard(cfg, fakeHass({ "sensor.level": sensor(10) }));
  assert.equal($(danger, "bar").style.background, "var(--red-color)");
});

test("without thresholds the colour never changes", async () => {
  const el = await makeCard({ ...BASE, color: "green" }, fakeHass({ "sensor.level": sensor(1) }));
  assert.equal($(el, "bar").style.background, "var(--green-color)");
});

test("the alert state turns everything red, whatever the level", async () => {
  const cfg = { ...BASE, color: "green", alert_entity: "sensor.mains", alert_state: "On Battery", strip: true };
  const calm = await makeCard(cfg, fakeHass({ "sensor.level": sensor(100), "sensor.mains": sensor("Online") }));
  assert.equal($(calm, "bar").style.background, "var(--green-color)");

  const alert = await makeCard(cfg, fakeHass({ "sensor.level": sensor(100), "sensor.mains": sensor("On Battery") }));
  assert.equal($(alert, "bar").style.background, "var(--red-color)");
  assert.equal($(alert, "strip").style.background, "var(--red-color)", "the strip follows the bar");
});

test("the strip is drawn only when asked, and reserves its own space", async () => {
  const without = await makeCard(BASE, fakeHass({ "sensor.level": sensor(50) }));
  assert.equal($(without, "strip"), null);
  assert.equal($(without, "body").style.paddingLeft, "0px");

  const with_ = await makeCard({ ...BASE, strip: true }, fakeHass({ "sensor.level": sensor(50) }));
  assert.ok($(with_, "strip"));
  assert.equal($(with_, "body").style.paddingLeft, "15px");
  assert.equal($(with_, "track").style.left, "15px", "the bar starts after the strip");
});

test("the left half shows the name, the icon and the values asked for", async () => {
  const hass = fakeHass({
    "sensor.level": sensor(1800, { unit_of_measurement: "s", friendly_name: "Battery runtime" }),
    "sensor.status": sensor("Online"),
    "sensor.charge": sensor(100, { unit_of_measurement: "%" }),
    "sensor.temp": sensor(27.63, { unit_of_measurement: "\u00b0C" })
  });
  const el = await makeCard({
    ...BASE, max: 3600, name: "UPS", icon: "mdi:power-plug",
    info: ["sensor.status", "sensor.charge", "sensor.level"]
  }, hass);
  assert.equal($(el, "name").textContent, "UPS");
  assert.equal($(el, "icon").getAttribute("icon"), "mdi:power-plug");
  assert.equal($(el, "sub").textContent, "Online \u00b7 100% \u00b7 30 min", "seconds read as minutes");

  const bare = await makeCard({ ...BASE, max: 3600, info: ["sensor.temp"] }, hass);
  assert.equal($(bare, "name").textContent, "Battery runtime", "the entity's own name is the default");
  assert.equal($(bare, "sub").textContent, "27.6 \u00b0C", "one decimal on small numbers");
});

test("a missing entity in the line shows a dash instead of breaking", async () => {
  const el = await makeCard({ ...BASE, name: "X", info: ["sensor.gone"] },
    fakeHass({ "sensor.level": sensor(50) }));
  assert.equal($(el, "sub").textContent, "\u2014");
});

test("with nothing to say on the left, the cards take the whole width", async () => {
  const el = await makeCard(BASE, fakeHass({ "sensor.level": sensor(50) }));
  assert.equal($(el, "info"), null);
  assert.ok($(el, "right").classList.contains("wide"));
});

test("the left block is tinted with the same colour as the bar", async () => {
  const el = await makeCard({ ...BASE, name: "X", danger_below: 50 },
    fakeHass({ "sensor.level": sensor(10) }));
  assert.equal($(el, "icon").style.color, "var(--red-color)");
});

test("children lose their own frame and share the width", async () => {
  const el = await makeCard({ ...BASE, cards: [TILE, TILE] }, fakeHass({ "sensor.level": sensor(50) }));
  const children = kids(el);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.style.getPropertyValue("--ha-card-background"), "transparent");
    assert.equal(child.style.getPropertyValue("--ha-card-border-width"), "0");
  }
});

test("hass reaches every child", async () => {
  const hass = fakeHass({ "sensor.level": sensor(50) });
  const el = await makeCard({ ...BASE, cards: [TILE, TILE] }, hass);
  for (const child of kids(el)) assert.equal(child.hass, hass);
});

test("the card carries no template and no CSS to write", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../dist/frame-card.js", import.meta.url), "utf8");
  assert.equal(source.includes("render_template"), false, "no template subscriptions");
  assert.equal(source.includes("card_mod"), false, "no card_mod anywhere");
});

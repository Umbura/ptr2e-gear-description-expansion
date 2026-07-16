const MODULE_ID = "ptr2e-gear-description-expansion";
const WEAPON_TYPE = "weapon";
const ROW_SELECTOR = "#compendium-browser li.item[data-entry-uuid]";
const CARRY_SLOT_FILTER_PATCHED = Symbol.for(`${MODULE_ID}.carrySlotFilterPatched`);

let scheduledFrame = null;

const ACTION_STAT_LABELS = Object.freeze({
  atk: "ATK",
  attack: "ATK",
  physical: "ATK",
  spa: "SP. ATK",
  spatk: "SP. ATK",
  special: "SP. ATK",
  status: "Status"
});

const ATTRIBUTE_LABELS = Object.freeze({
  hp: "HP",
  atk: "ATK",
  def: "DEF",
  spa: "SP. ATK",
  spatk: "SP. ATK",
  spd: "SP. DEF",
  spdef: "SP. DEF",
  spe: "SPE"
});

const STAGE_LABELS = Object.freeze({
  atk: "ATK Stage",
  def: "DEF Stage",
  spa: "SP. ATK Stage",
  spatk: "SP. ATK Stage",
  spd: "SP. DEF Stage",
  spdef: "SP. DEF Stage",
  spe: "SPE Stage",
  speed: "SPE Stage",
  accuracy: "Accuracy Stage",
  evasion: "Evasion Stage",
  crit: "Critical Stage"
});

const CARRY_SLOT_OPTIONS = Object.freeze({
  held: "PTR2E.FIELDS.gear.equipped.slot.held",
  worn: "PTR2E.FIELDS.gear.equipped.slot.worn",
  accessory: "PTR2E.FIELDS.gear.equipped.slot.accessory",
  belt: "PTR2E.FIELDS.gear.equipped.slot.belt",
  backpack: "PTR2E.FIELDS.gear.equipped.slot.backpack",
  slotless: "PTR2E.FIELDS.gear.equipped.slot.slotless"
});

function formatSigned(value, suffix = "") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${suffix}`;
}

function getActionStat(action) {
  return ACTION_STAT_LABELS[action?.offensiveStat]
    ?? ACTION_STAT_LABELS[action?.category]
    ?? "N/A";
}

function formatRange(range) {
  if (!range?.target) return null;
  if (range.target === "self") return "Self";

  const distance = Number(range.distance);
  if (!Number.isFinite(distance)) return range.target;

  return `${distance}${range.unit ? ` ${range.unit}` : ""}`;
}

function collectWeaponActions(item) {
  return Array.from(item.system?.actions ?? [])
    .filter((action) => action?.type === "attack")
    .map((action) => ({
      name: action.name ?? "Attack",
      stat: getActionStat(action),
      power: Number.isFinite(Number(action.power)) ? Number(action.power) : null,
      accuracy: Number.isFinite(Number(action.accuracy)) ? Number(action.accuracy) : null,
      range: formatRange(action.range),
      pp: Number.isFinite(Number(action.cost?.powerPoints)) ? Number(action.cost.powerPoints) : null
    }));
}

function getEnabledChanges(item) {
  return Array.from(item.effects ?? []).flatMap((effect) => {
    if (effect.disabled || effect.transfer === false) return [];

    return Array.from(effect.system?.changes ?? effect.changes ?? []).filter((change) => {
      return !change.ignored && Number(change.method ?? 2) === 2;
    });
  });
}

function describeChange(change) {
  const value = Number(change.value);
  if (!Number.isFinite(value) || value === 0) return null;

  const attribute = /^system\.attributes\.(hp|atk|def|spa|spatk|spd|spdef|spe)\.(?:base|value)$/.exec(change.key);
  if (attribute) return { label: ATTRIBUTE_LABELS[attribute[1]], value, suffix: "" };

  const stage = /^system\.(?:attributes|battleStats)\.(atk|def|spa|spatk|spd|spdef|spe|speed|accuracy|evasion|crit)\.stage$/.exec(change.key);
  if (stage) return { label: STAGE_LABELS[stage[1]], value, suffix: "" };

  if (change.key === "{item|id}-attack-damage-flat") {
    return { label: change.label || "Damage", value, suffix: "" };
  }

  if (change.key?.endsWith("-attack-damage-flat")) {
    return { label: `${change.label || "Attack"} Damage`, value, suffix: "" };
  }

  if (change.type === "percentile-modifier" && change.key?.includes("damage")) {
    return { label: change.label || "Damage", value, suffix: "%" };
  }

  if (change.type === "alter-attack" && ["power", "accuracy", "pp-cost"].includes(change.property)) {
    const labels = { power: "Power", accuracy: "Accuracy", "pp-cost": "PP Cost" };
    return { label: change.label || labels[change.property], value, suffix: "" };
  }

  return null;
}

function collectModifiers(item) {
  const totals = new Map();

  for (const change of getEnabledChanges(item)) {
    const modifier = describeChange(change);
    if (!modifier) continue;

    const key = `${modifier.label}|${modifier.suffix}`;
    const current = totals.get(key) ?? { ...modifier, value: 0 };
    current.value += modifier.value;
    totals.set(key, current);
  }

  return Array.from(totals.values()).filter((modifier) => modifier.value !== 0);
}

function createBlock(title, className) {
  const block = document.createElement("div");
  block.className = "ptr2e-gear-description-expansion-block";

  const heading = document.createElement("div");
  heading.className = "ptr2e-gear-description-expansion-title";
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = className;

  block.append(heading, list);
  return { block, list };
}

function buildActionsBlock(actions) {
  if (!actions.length) return null;

  const { block, list } = createBlock("Weapon Actions", "ptr2e-gear-description-expansion-action-list");

  for (const action of actions) {
    const row = document.createElement("div");
    row.className = "ptr2e-gear-description-expansion-action-row";

    const main = document.createElement("div");
    main.className = "ptr2e-gear-description-expansion-action-main";

    const name = document.createElement("span");
    name.className = "ptr2e-gear-description-expansion-action-name";
    name.textContent = action.name;

    const role = document.createElement("span");
    role.className = "ptr2e-gear-description-expansion-action-role";
    role.textContent = action.stat;

    const stats = document.createElement("div");
    stats.className = "ptr2e-gear-description-expansion-action-stats";

    const chips = [
      action.power === null ? null : `Pow ${action.power}`,
      action.accuracy === null ? null : `Acc ${action.accuracy}`,
      action.range,
      action.pp === null ? null : `PP ${action.pp}`
    ].filter(Boolean);

    for (const chipText of chips) {
      const chip = document.createElement("span");
      chip.className = "ptr2e-gear-description-expansion-pill";
      chip.textContent = chipText;
      stats.append(chip);
    }

    main.append(name, role);
    row.append(main, stats);
    list.append(row);
  }

  return block;
}

function buildModifiersBlock(modifiers) {
  if (!modifiers.length) return null;

  const { block, list } = createBlock("Numeric Modifiers", "ptr2e-gear-description-expansion-modifier-list");

  for (const modifier of modifiers) {
    const row = document.createElement("div");
    row.className = "ptr2e-gear-description-expansion-modifier-row";

    const name = document.createElement("span");
    name.className = "ptr2e-gear-description-expansion-modifier-name";
    name.textContent = modifier.label;

    const value = document.createElement("span");
    value.className = "ptr2e-gear-description-expansion-modifier-value";
    value.textContent = formatSigned(modifier.value, modifier.suffix);

    row.append(name, value);
    list.append(row);
  }

  return block;
}

function getDetailsElement(embed) {
  return embed.querySelector("content.item-embed section.details")
    ?? embed.querySelector(".item-embed section.details");
}

function insertDetails(embed, item) {
  if (!(embed instanceof HTMLElement) || !item || item.type !== WEAPON_TYPE) return false;
  if (embed.querySelector(".ptr2e-gear-description-expansion-block")) return true;

  const details = getDetailsElement(embed);
  if (!details) return false;

  const actionsBlock = buildActionsBlock(collectWeaponActions(item));
  const modifiersBlock = buildModifiersBlock(collectModifiers(item));
  const blocks = [actionsBlock, modifiersBlock].filter(Boolean);
  if (!blocks.length) return false;

  const fieldsets = Array.from(details.querySelectorAll(":scope > fieldset"));
  const crafting = fieldsets.find((fieldset) => fieldset.querySelector("legend")?.textContent?.trim() === "Crafting");

  for (const block of blocks) {
    if (crafting) details.insertBefore(block, crafting);
    else details.append(block);
  }

  return true;
}

function getPreviewUuid(embed) {
  const embedUuid = embed.closest("[data-entry-uuid]")?.dataset?.entryUuid
    ?? embed.closest("[data-uuid]")?.dataset?.uuid;
  if (embedUuid) return embedUuid;

  const tooltip = game.tooltip?.element;
  const tooltipUuid = tooltip?.dataset?.entryUuid
    ?? tooltip?.dataset?.uuid
    ?? tooltip?.closest?.("[data-entry-uuid]")?.dataset?.entryUuid;
  if (tooltipUuid) return tooltipUuid;

  const hoveredRow = Array.from(document.querySelectorAll(ROW_SELECTOR)).find((row) => row.matches(":hover"));
  if (hoveredRow?.dataset?.entryUuid) return hoveredRow.dataset.entryUuid;

  const previewName = embed.querySelector("h2")?.textContent?.trim();
  if (!previewName) return null;

  const matchingRow = Array.from(document.querySelectorAll(ROW_SELECTOR)).find((row) => {
    return row.querySelector(".name")?.textContent?.trim() === previewName
      || row.textContent?.trim() === previewName;
  });

  return matchingRow?.dataset?.entryUuid ?? null;
}

async function injectPreviewDetails(embed) {
  if (!(embed instanceof HTMLElement) || embed.dataset.ptr2eGearDescriptionExpansionState) return;

  const uuid = getPreviewUuid(embed);
  if (!uuid) return;

  embed.dataset.ptr2eGearDescriptionExpansionState = "loading";

  try {
    const item = await fromUuid(uuid);
    if (!item || item.type !== WEAPON_TYPE) {
      embed.dataset.ptr2eGearDescriptionExpansionState = "ignored";
      return;
    }

    if (!embed.isConnected || embed.querySelector("h2")?.textContent?.trim() !== item.name) {
      delete embed.dataset.ptr2eGearDescriptionExpansionState;
      scheduleInjection();
      return;
    }

    embed.dataset.ptr2eGearDescriptionExpansionState = insertDetails(embed, item) ? "ready" : "missing-details";
  }
  catch (error) {
    embed.dataset.ptr2eGearDescriptionExpansionState = "error";
    console.error(`${MODULE_ID} | Failed to inject weapon preview data for ${uuid}`, error);
  }
}

function patchWeaponEmbed() {
  const prototype = CONFIG.Item?.dataModels?.weapon?.prototype;
  if (!prototype?.toEmbed || prototype.toEmbed.ptr2eGearDescriptionExpansionPatched) return false;

  const original = prototype.toEmbed;

  async function toEmbedWithGearDescription(...args) {
    const embed = await original.apply(this, args);
    try {
      insertDetails(embed, this.parent);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to add direct weapon embed details`, error);
    }
    return embed;
  }

  toEmbedWithGearDescription.ptr2eGearDescriptionExpansionPatched = true;
  prototype.toEmbed = toEmbedWithGearDescription;
  return true;
}

function ensureCarrySlotOptions(gearTab) {
  const carrySlot = gearTab?.filterData?.checkboxes?.carrySlot;
  if (!carrySlot?.options || typeof gearTab.generateCheckboxOptions !== "function") return;

  const existingSelection = new Set(carrySlot.selected ?? []);
  const options = gearTab.generateCheckboxOptions(CARRY_SLOT_OPTIONS);

  for (const [slot, option] of Object.entries(options)) {
    if (carrySlot.options[slot]) continue;
    option.selected = existingSelection.has(slot);
    carrySlot.options[slot] = option;
  }
}

function patchCarrySlotFilter() {
  const gearTab = game.ptr?.compendiumBrowser?.compendiumTabs?.gear;
  if (!gearTab || typeof gearTab.filterIndexData !== "function") return false;

  ensureCarrySlotOptions(gearTab);

  if (typeof gearTab.loadData === "function" && !gearTab.loadData[CARRY_SLOT_FILTER_PATCHED]) {
    const originalLoadData = gearTab.loadData;

    gearTab.loadData = async function loadDataWithCarrySlotOptions(...args) {
      const result = await originalLoadData.apply(this, args);
      ensureCarrySlotOptions(this);
      return result;
    };

    gearTab.loadData[CARRY_SLOT_FILTER_PATCHED] = true;
    gearTab.loadData.original = originalLoadData;
  }

  if (gearTab.filterIndexData[CARRY_SLOT_FILTER_PATCHED]) return true;

  const original = gearTab.filterIndexData;

  gearTab.filterIndexData = function filterIndexDataWithCarrySlot(entry) {
    const selected = this.filterData?.checkboxes?.carrySlot?.selected ?? [];
    if (selected.length && !selected.includes(entry?.slot)) return false;

    return original.call(this, entry);
  };

  gearTab.filterIndexData[CARRY_SLOT_FILTER_PATCHED] = true;
  gearTab.filterIndexData.original = original;
  return true;
}

function findPreviewEmbeds() {
  const embeds = new Set(document.querySelectorAll(".weapon-embed"));

  for (const details of document.querySelectorAll("content.item-embed section.details, .item-embed section.details")) {
    const figure = details.closest("figure");
    if (figure) embeds.add(figure);
  }

  return embeds;
}

function scanPreviews() {
  for (const embed of findPreviewEmbeds()) {
    void injectPreviewDetails(embed);
  }
}

function scheduleInjection() {
  if (scheduledFrame !== null) return;

  scheduledFrame = requestAnimationFrame(() => {
    scheduledFrame = null;
    scanPreviews();
  });
}

Hooks.once("ready", () => {
  if (game.system.id !== "ptr2e") return;

  const patched = patchWeaponEmbed();
  const carrySlotFilterPatched = patchCarrySlotFilter();
  const observer = new MutationObserver(scheduleInjection);
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("mouseover", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest(ROW_SELECTOR)) {
      scheduleInjection();
    }
  }, true);

  scheduleInjection();
  console.info(`${MODULE_ID} | Weapon gear preview details enabled.`, { patched, carrySlotFilterPatched });
});


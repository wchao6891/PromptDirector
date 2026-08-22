export function normalizeTagValue(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[,，;；]+|[,，;；]+$/gu, "")
    .trim();
}

export function normalizeTagValues(values = []) {
  const result = [];
  const keys = new Set();
  for (const source of Array.isArray(values) ? values : splitTagInput(values)) {
    const value = normalizeTagValue(source);
    const key = value.toLocaleLowerCase();
    if (!value || keys.has(key)) continue;
    keys.add(key);
    result.push(value);
  }
  return result;
}

export function addTagValues(current = [], additions = []) {
  return normalizeTagValues([...normalizeTagValues(current), ...normalizeTagValues(additions)]);
}

export function splitTagInput(value) {
  return String(value ?? "").split(/[,，;；\n\r]+/u);
}

export function createTagEditor(options = {}) {
  const root = document.createElement("div");
  root.className = ["tag-editor", options.className].filter(Boolean).join(" ");
  const chips = document.createElement("div");
  chips.className = "tag-editor-chips";
  const row = document.createElement("div");
  row.className = "tag-editor-row";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = options.placeholder || "输入标签，按回车或逗号添加";
  input.setAttribute("aria-label", options.inputLabel || "添加标签");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "button-secondary";
  add.textContent = options.addLabel || "添加";
  row.append(input, add);
  root.append(chips, row);

  let values = normalizeTagValues(options.values);
  let pendingChanges = 0;
  let changeQueue = Promise.resolve(true);

  const render = () => {
    chips.hidden = values.length === 0;
    chips.replaceChildren(...values.map((value) => {
      const chip = document.createElement("span");
      chip.className = "tag-editor-chip";
      const text = document.createElement("span");
      text.textContent = value;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除标签：${value}`);
      remove.addEventListener("click", () => void applyValues(values.filter((item) => item !== value), remove));
      chip.append(text, remove);
      return chip;
    }));
  };

  const applyValues = (nextValue, trigger) => {
    const previous = values;
    const next = normalizeTagValues(nextValue);
    if (sameValues(previous, next)) return Promise.resolve(true);
    values = next;
    render();
    pendingChanges += 1;
    root.setAttribute("aria-busy", "true");
    const requested = [...next];
    const run = async () => {
      try {
        const accepted = await options.onChange?.(requested, trigger);
        if (accepted === false) {
          if (sameValues(values, requested)) {
            values = previous;
            render();
          }
          return false;
        }
        return true;
      } catch {
        if (sameValues(values, requested)) {
          values = previous;
          render();
        }
        return false;
      } finally {
        pendingChanges -= 1;
        if (pendingChanges === 0) root.removeAttribute("aria-busy");
      }
    };
    changeQueue = changeQueue.then(run, run);
    return changeQueue;
  };

  const commit = async () => {
    const additions = normalizeTagValues(splitTagInput(input.value));
    if (!additions.length) {
      input.focus();
      return false;
    }
    const changed = await applyValues(addTagValues(values, additions), add);
    if (changed) input.value = "";
    input.focus();
    return changed;
  };

  add.addEventListener("click", () => void commit());
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || !["Enter", ",", "，"].includes(event.key)) return;
    event.preventDefault();
    void commit();
  });
  input.addEventListener("input", () => {
    if (!/[,，\n\r]/u.test(input.value)) return;
    const parts = input.value.split(/[,，\n\r]+/u);
    input.value = parts.pop() ?? "";
    const additions = normalizeTagValues(parts);
    if (additions.length) void applyValues(addTagValues(values, additions), add);
  });

  render();
  return {
    element: root,
    input,
    button: add,
    get values() { return [...values]; },
    setValues(next) {
      values = normalizeTagValues(next);
      render();
    },
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
      add.disabled = Boolean(disabled);
      chips.querySelectorAll("button").forEach((button) => { button.disabled = Boolean(disabled); });
    },
    commit
  };
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

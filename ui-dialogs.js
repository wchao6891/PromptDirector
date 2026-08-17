const DIALOG_ID = "promptdirector-app-dialog";

export async function showAppDialog(options = {}) {
  document.getElementById(DIALOG_ID)?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = `app-dialog${clean(options.dialogClass) ? ` ${clean(options.dialogClass)}` : ""}`;
  dialog.setAttribute("aria-labelledby", `${DIALOG_ID}-title`);
  const form = document.createElement("form");
  form.method = "dialog";
  form.className = "app-dialog-form";
  const header = document.createElement("header");
  const heading = document.createElement("div");
  const title = document.createElement("h2");
  title.id = `${DIALOG_ID}-title`;
  title.textContent = clean(options.title) || "确认操作";
  heading.append(title);
  if (clean(options.description)) {
    const description = document.createElement("p");
    description.textContent = clean(options.description);
    heading.append(description);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button app-dialog-close";
  close.setAttribute("aria-label", "关闭");
  close.title = "关闭";
  close.textContent = "×";
  header.append(heading, close);
  const body = document.createElement("div");
  body.className = `app-dialog-body${clean(options.bodyClass) ? ` ${clean(options.bodyClass)}` : ""}`;
  const controls = new Map();
  for (const field of Array.isArray(options.fields) ? options.fields : []) {
    const control = createField(field);
    if (!control) continue;
    controls.set(field.id, control.input);
    body.append(control.wrapper);
  }
  if (typeof options.renderBody === "function") options.renderBody({ body, controls, dialog, form });
  let status = null;
  const ensureStatus = () => {
    if (status) return status;
    status = document.createElement("p");
    status.className = "app-dialog-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    body.append(status);
    if (!body.isConnected) form.insertBefore(body, footer);
    return status;
  };
  const footer = document.createElement("footer");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button-secondary";
  cancel.textContent = clean(options.cancelLabel) || "取消";
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.className = options.danger ? "button-danger" : "";
  confirm.textContent = clean(options.confirmLabel) || "确认";
  footer.append(cancel, confirm);
  form.append(header);
  if (controls.size || body.childElementCount) form.append(body);
  form.append(footer);
  dialog.append(form);
  document.body.append(dialog);

  return new Promise((resolve) => {
    let settled = false;
    let initialControlState = "";
    let dismissConfirmationArmed = false;
    const controlState = () => JSON.stringify([...controls].map(([id, input]) => [
      id,
      input.type === "checkbox" ? input.checked : input.value
    ]));
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const resetDismissConfirmation = () => {
      if (!dismissConfirmationArmed) return;
      dismissConfirmationArmed = false;
      cancel.textContent = clean(options.cancelLabel) || "取消";
      if (status && !status.classList.contains("error")) status.textContent = "";
    };
    const dismiss = () => {
      const dirty = options.confirmDismissWhenDirty === true && controlState() !== initialControlState;
      if (!dirty || dismissConfirmationArmed) return finish(null);
      dismissConfirmationArmed = true;
      const statusLine = ensureStatus();
      statusLine.classList.remove("error");
      statusLine.textContent = clean(options.dirtyDismissMessage) || "有未保存的更改，再次关闭或取消将放弃这些更改";
      cancel.textContent = clean(options.discardLabel) || "确认放弃";
    };
    close.addEventListener("click", dismiss);
    cancel.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); dismiss(); });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && options.dismissOnBackdrop !== false) dismiss();
    });
    form.addEventListener("input", resetDismissConfirmation);
    form.addEventListener("change", resetDismissConfirmation);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries([...controls].map(([id, input]) => [
        id,
        input.type === "checkbox" ? input.checked : input.value
      ]));
      confirm.disabled = true;
      cancel.disabled = true;
      close.disabled = true;
      if (clean(options.pendingLabel)) {
        const statusLine = ensureStatus();
        statusLine.classList.remove("error");
        statusLine.textContent = clean(options.pendingLabel);
      }
      try {
        const result = typeof options.onSubmit === "function"
          ? await options.onSubmit(values, { dialog, form, status: ensureStatus })
          : values;
        if (result === false) return;
        finish(result === undefined ? values : result);
      } catch (error) {
        const statusLine = ensureStatus();
        statusLine.textContent = clean(error?.message) || "操作失败，请重试";
        statusLine.classList.add("error");
      } finally {
        if (!settled) { confirm.disabled = false; cancel.disabled = false; close.disabled = false; }
      }
    });
    dialog.showModal();
    if (typeof options.onReady === "function") {
      options.onReady({ dialog, form, body, controls, status: ensureStatus });
    }
    initialControlState = controlState();
    requestAnimationFrame(() => {
      const first = [...controls.values()].find((input) => !input.disabled);
      first?.focus();
      if (options.selectFirst && typeof first?.select === "function") first.select();
    });
  });
}

export async function confirmAppAction(options = {}) {
  return await showAppDialog({ ...options, fields: Array.isArray(options.fields) ? options.fields : [] }) !== null;
}

export async function promptAppText(options = {}) {
  const id = clean(options.id) || "value";
  const result = await showAppDialog({
    ...options,
    fields: [{ id, label: clean(options.label) || clean(options.title) || "内容", type: options.multiline ? "textarea" : clean(options.type) || "text", value: options.value ?? "", placeholder: options.placeholder, required: options.required !== false, autocomplete: options.autocomplete }]
  });
  return result === null ? null : String(result[id] ?? "");
}

function createField(field = {}) {
  const id = clean(field.id);
  if (!id) return null;
  const wrapper = document.createElement("label");
  wrapper.className = `app-dialog-field${field.type === "checkbox" ? " app-dialog-check" : ""}`;
  wrapper.dataset.fieldId = id;
  const label = document.createElement("span");
  label.textContent = clean(field.label) || id;
  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = Number.isFinite(Number(field.rows)) ? Number(field.rows) : 6;
  } else if (field.type === "select") {
    input = document.createElement("select");
    for (const item of Array.isArray(field.options) ? field.options : []) {
      const option = document.createElement("option");
      option.value = String(item?.value ?? "");
      option.textContent = String(item?.label ?? item?.value ?? "");
      option.selected = option.value === String(field.value ?? "");
      input.append(option);
    }
  } else {
    input = document.createElement("input");
    input.type = field.type === "checkbox" ? "checkbox" : field.type === "secret" ? "text" : clean(field.type) || "text";
  }
  input.id = `${DIALOG_ID}-${id}`;
  input.name = id;
  if (field.type === "secret") {
    input.classList.add("app-dialog-secret-input");
    input.dataset.secretInput = "true";
    input.name = `promptdirector-field-${id.replace(/api-?key/gi, "credential")}`;
    input.autocomplete = "new-password";
    input.readOnly = true;
    input.setAttribute("aria-autocomplete", "none");
    input.setAttribute("data-1p-ignore", "true");
    input.setAttribute("data-lpignore", "true");
    input.setAttribute("data-bwignore", "true");
    input.setAttribute("data-form-type", "other");
    const unlock = () => { input.readOnly = false; };
    input.addEventListener("pointerdown", unlock, { once: true });
    input.addEventListener("focus", unlock, { once: true });
  }
  if (field.type === "checkbox") input.checked = field.value === true;
  else if (field.type !== "select") input.value = String(field.value ?? "");
  if (clean(field.placeholder)) input.placeholder = clean(field.placeholder);
  if (field.type !== "secret" && clean(field.autocomplete)) input.autocomplete = clean(field.autocomplete);
  if (field.required === true) input.required = true;
  if (clean(field.pattern)) input.pattern = clean(field.pattern);
  if (Number.isFinite(Number(field.minLength))) input.minLength = Number(field.minLength);
  if (field.disabled === true) input.disabled = true;
  if (field.type === "checkbox") wrapper.append(input, label);
  else wrapper.append(label, input);
  if (clean(field.help)) {
    const help = document.createElement("small");
    help.textContent = clean(field.help);
    wrapper.append(help);
  }
  return { wrapper, input };
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

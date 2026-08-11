export function bindTransientMenus(root = document, selector = "") {
  const cleanSelector = String(selector).trim();
  if (!cleanSelector) throw new Error("临时菜单选择器不能为空");

  const menus = () => [...root.querySelectorAll(cleanSelector)];
  const closestMenu = (target) => target instanceof Element ? target.closest(cleanSelector) : null;
  const closeMenus = (except = null) => {
    for (const menu of menus()) {
      if (menu !== except) menu.open = false;
    }
  };

  const onPointerDown = (event) => closeMenus(closestMenu(event.target));
  const onClick = (event) => {
    const current = closestMenu(event.target);
    if (!current) {
      closeMenus();
      return;
    }
    const action = event.target instanceof Element ? event.target.closest("button, a[href]") : null;
    if (action && !action.closest(".package-preferences")) current.open = false;
  };
  const onToggle = (event) => {
    const current = closestMenu(event.target);
    if (current?.open) closeMenus(current);
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    const open = menus().filter((menu) => menu.open);
    if (!open.length) return;
    event.preventDefault();
    closeMenus();
    open.at(-1)?.querySelector(":scope > summary")?.focus();
  };

  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("click", onClick, true);
  root.addEventListener("toggle", onToggle, true);
  root.addEventListener("keydown", onKeyDown, true);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("toggle", onToggle, true);
    root.removeEventListener("keydown", onKeyDown, true);
  };
}

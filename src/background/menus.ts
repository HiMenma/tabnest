/**
 * Context menus. Rebuilt on install and at every worker start, because menus
 * survive worker termination and a rebuild is cheaper than reasoning about it.
 */
import { initLocale, t } from "../ui/i18n";

export const MENU = {
  openLibrary: "tabnest-open-library",
  parkPage: "tabnest-park-page",
  parkLink: "tabnest-park-link",
  parkWindow: "tabnest-park-window",
  parkGroup: "tabnest-park-group",
} as const;

export function installMenus(): void {
  initLocale();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.openLibrary,
      title: t("menu.openLibrary"),
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU.parkWindow,
      title: t("menu.parkWindow"),
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU.parkPage,
      title: t("menu.parkPage"),
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU.parkLink,
      title: t("menu.parkLink"),
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENU.parkGroup,
      title: t("menu.parkGroup"),
      contexts: ["page"],
    });
  });
}

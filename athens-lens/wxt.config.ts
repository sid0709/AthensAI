import { defineConfig } from "wxt";
import { resolveEndpoint } from "./src/api/endpoint";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: () => {
    const configuredApiUrl = resolveEndpoint(
      process.env.WXT_ATHENS_API_URL,
      "http://127.0.0.1:8979/api",
    );
    const apiHosts = new Set([
      "http://127.0.0.1:8979/*",
      "http://localhost:8979/*"
    ]);
    const url = new URL(configuredApiUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("WXT_ATHENS_API_URL must resolve to an http(s) URL");
    }
    apiHosts.add(`${url.origin}/*`);

    return {
      name: "Athens Lens",
      description: "A focused job search assistant in your Chrome side panel.",
      version: "0.3.21",
      minimum_chrome_version: "116",
      permissions: ["sidePanel", "storage", "tabs", "activeTab", "tabCapture", "scripting", "offscreen", "downloads", "webNavigation"],
      host_permissions: [...apiHosts, "http://*/*", "https://*/*", "<all_urls>"],
      action: {
        default_title: "Open Athens Lens",
        default_icon: {
          16: "icon-16.png",
          32: "icon-32.png",
          48: "icon-48.png",
          128: "icon-128.png"
        }
      },
      icons: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
        128: "icon-128.png"
      }
    };
  }
});

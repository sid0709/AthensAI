import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Athens Lens",
    description: "A focused job search assistant in your Chrome side panel.",
    version: "0.1.0",
    minimum_chrome_version: "116",
    permissions: ["sidePanel", "storage"],
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
  }
});

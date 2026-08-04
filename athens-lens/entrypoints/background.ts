export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) {
      return;
    }

    browser.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => {
      console.error("Unable to open the Athens Lens side panel", error);
    });
  });
});

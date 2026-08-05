/** Minimal Chrome MV3 typings used by Athens Lens recording. */
declare namespace chrome {
  namespace runtime {
    const lastError: { message?: string } | undefined;
    function sendMessage(message: unknown): Promise<any>;
    function sendMessage(
      message: unknown,
      responseCallback: (response: any) => void,
    ): void;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: unknown,
          sendResponse: (response?: any) => void,
        ) => boolean | void,
      ): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      windowId?: number;
      active?: boolean;
      status?: string;
    }
    function create(
      createProperties: { url: string; active?: boolean },
      callback?: (tab: Tab) => void,
    ): void;
    function create(createProperties: { url: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number, callback: (tab: Tab) => void): void;
    function get(tabId: number): Promise<Tab>;
    function query(
      queryInfo: { active?: boolean; lastFocusedWindow?: boolean },
      callback: (tabs: Tab[]) => void,
    ): void;
    function query(queryInfo: {
      active?: boolean;
      lastFocusedWindow?: boolean;
    }): Promise<Tab[]>;
    function update(
      tabId: number,
      updateProperties: { url?: string; active?: boolean },
      callback?: (tab: Tab) => void,
    ): void;
    const onActivated: {
      addListener(callback: (activeInfo: { tabId: number; windowId: number }) => void): void;
    };
  }

  namespace tabCapture {
    function getMediaStreamId(
      options: { targetTabId: number },
      callback: (streamId: string) => void,
    ): void;
  }

  namespace scripting {
    function executeScript<T>(injection: {
      target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
      world?: "ISOLATED" | "MAIN";
      func: () => T;
    }): Promise<Array<{ result?: T; frameId?: number }>>;
  }

  namespace offscreen {
    enum Reason {
      USER_MEDIA = "USER_MEDIA",
    }
    function hasDocument(): Promise<boolean>;
    function createDocument(parameters: {
      url: string;
      reasons: Reason[];
      justification: string;
    }): Promise<void>;
  }

  namespace downloads {
    function download(options: {
      url: string;
      filename?: string;
      saveAs?: boolean;
    }): Promise<number>;
  }

  namespace webNavigation {
    function getAllFrames(
      details: { tabId: number },
      callback: (details: Array<{ frameId: number; url?: string }> | null) => void,
    ): void;
  }
}

declare const chrome: typeof chrome;

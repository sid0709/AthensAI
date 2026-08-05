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
      removeListener?(
        callback: (
          message: any,
          sender: unknown,
          sendResponse: (response?: any) => void,
        ) => boolean | void,
      ): void;
    };
  }

  namespace storage {
    namespace local {
      function get(
        keys: string | string[] | null,
        callback: (items: Record<string, any>) => void,
      ): void;
      function get(keys?: string | string[] | null): Promise<Record<string, any>>;
      function set(items: Record<string, any>, callback?: () => void): void;
      function set(items: Record<string, any>): Promise<void>;
      function remove(keys: string | string[], callback?: () => void): void;
      function remove(keys: string | string[]): Promise<void>;
    }
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
      queryInfo: { active?: boolean; lastFocusedWindow?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void,
    ): void;
    function query(queryInfo: {
      active?: boolean;
      lastFocusedWindow?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
    function update(
      tabId: number,
      updateProperties: { url?: string; active?: boolean },
      callback?: (tab: Tab) => void,
    ): void;
    const onActivated: {
      addListener(callback: (activeInfo: { tabId: number; windowId: number }) => void): void;
      removeListener?(callback: (activeInfo: { tabId: number; windowId: number }) => void): void;
    };
    const onRemoved: {
      addListener(callback: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
      removeListener?(
        callback: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void,
      ): void;
    };
    const onUpdated: {
      addListener?(
        callback: (
          tabId: number,
          changeInfo: { status?: string; url?: string },
          tab: Tab,
        ) => void,
      ): void;
    };
    function sendMessage(tabId: number, message: unknown, responseCallback?: (response: any) => void): void;
    function sendMessage(
      tabId: number,
      message: unknown,
      options: { frameId?: number },
      responseCallback?: (response: any) => void,
    ): void;
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

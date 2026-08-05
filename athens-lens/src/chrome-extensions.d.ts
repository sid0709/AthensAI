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
    }
    function create(
      createProperties: { url: string; active?: boolean },
      callback?: (tab: Tab) => void,
    ): void;
    function create(createProperties: { url: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number): Promise<Tab>;
    function query(queryInfo: {
      active?: boolean;
      lastFocusedWindow?: boolean;
    }): Promise<Tab[]>;
  }

  namespace tabCapture {
    function getMediaStreamId(
      options: { targetTabId: number },
      callback: (streamId: string) => void,
    ): void;
  }

  namespace scripting {
    function executeScript<T>(injection: {
      target: { tabId: number; allFrames?: boolean };
      func: () => T;
    }): Promise<Array<{ result?: T }>>;
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
}

declare const chrome: typeof chrome;

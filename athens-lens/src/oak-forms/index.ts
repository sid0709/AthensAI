/**
 * Oak-inspired interactive form capture for Athens Lens Ask AI.
 *
 * Adapted from Project Oak's DOM serializer + Copy-for-Analyze tree text.
 * Capture / analyze only — no autofill, Script Eval, or UI board.
 */

export type { DomNode, PureNode, MetaNode } from "./types";
export { serializeDom, getDirectText } from "./dom-serializer";
export {
  splitDomTree,
  formatPureTreePreview,
  formatPureTreeForAnalyze,
} from "./tree-export";
export {
  injectSerializePage,
  type OakInjectSerializeResult,
} from "./injectSerializePage";

/** Cap Analyze tree text sent to the Ask AI API. */
export const MAX_FORM_TREE_CHARS = 60_000;

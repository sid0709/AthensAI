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
export { isNoiseFrameUrl } from "./frameFilter";

/** Cap compact actionable-field text sent to Ask AI / shown in the panel. */
export const MAX_FORM_TREE_CHARS = 12_000;

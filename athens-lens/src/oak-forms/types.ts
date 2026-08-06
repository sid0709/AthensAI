/**
 * Minimal DOM tree types adapted from Project Oak for Athens Lens Ask AI capture.
 * No Oak socket / eval / UI-board types.
 */

export interface DomNode {
  nodeId: number;
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  childCount: number;
  children: DomNode[];
}

export interface PureNode {
  tag: string;
  id: number;
  text?: string;
  /** Useful form/control attrs e.g. type=file name=email aria-required=true */
  detail?: string;
  children: PureNode[];
}

export interface MetaNode {
  id: number;
  domId?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  children: MetaNode[];
}

import {_debug} from "./util";
const xpr = require("xpath-range");

/**
 * Track container elements where selection events can be handled.
 */
const watchList = new Set<HTMLElement>();

/**
 * Get the parent container for a selection.
 *
 * Might return undefined if no container under watch contains the node.
 */
function getWatchedParent(childNode: Node): HTMLElement | undefined {
  for (const el of watchList) {
    if (el.contains(childNode)) {
      return el;
    }
  }
  return undefined;
}

/**
 * Get the container under watch that contains the selection.
 *
 * TODO(jnu): currently selections that overflow a single watched parent in
 * any way will be ignored entirely. These edge cases could be handled in
 * other ways in the future.
 */
function resolveContainer(selection: Selection): HTMLElement | undefined {
  const anchorParent = getWatchedParent(selection.anchorNode);
  if (!anchorParent) {
    _debug("Selection starts outside of watched container");
    return undefined;
  }

  const focusParent = getWatchedParent(selection.focusNode);
  if (!focusParent) {
    _debug("Selection ends outside of watched container");
    return undefined;
  }

  if (anchorParent !== focusParent) {
    _debug("Selection spans multiple watched containers");
    return undefined;
  }

  return anchorParent;
}

/**
 * Get the most immediate Sharpie parent container.
 */
function getSharpieOffsetParent(container: Node) {
  let el = container.parentElement;
  const root = el.getRootNode();
  while (el && el !== root) {
    if (el.dataset && el.dataset.hasOwnProperty("sharpiePosition")) {
      return el;
    }
    el = el.parentElement;
  }

  return undefined;
}

/**
 * Get the nearest preceding Sharpie element.
 */
function getSharpieSibling(container: Node): HTMLElement | undefined {
  // @ts-ignore
  let el = container.previousElementSibling;
  while (el) {
    // @ts-ignore
    if (el.dataset && el.dataset.hasOwnProperty("sharpiePosition")) {
      return el;
    }
    el = el.previousElementSibling;
  }
  return undefined;
}

/**
 * Get the scale factor and offset position of the given node.
 *
 * Uses contextual hints from surrounding elements.
 */
function getSharpieOffsetMeta(el: Node) {
  const sharpieContainer = getSharpieOffsetParent(el);
  const sharpieSibling = getSharpieSibling(el);
  const rawWarp = sharpieContainer ? sharpieContainer.dataset.sharpieWarp : 1;
  const rawPos = sharpieSibling ?
    sharpieSibling.dataset.sharpiePosition :
    sharpieContainer.dataset.sharpiePosition;
  let delta = 0;
  if (sharpieSibling) {
    const sibRawWarp = sharpieSibling.dataset.sharpieWarp;
    const sibWarp = sibRawWarp ? +sibRawWarp : 1;
    const sibLength = sharpieSibling.textContent.length;
    delta = sibLength * sibWarp;
  }

  return {
    warp: rawWarp ? +rawWarp : 1,
    pos: (+rawPos) + delta,
  };
}

/**
 * Translate the given selection range to positions within the raw text.
 *
 * This function takes into account different annotations that may shrink or
 * stretch the underlying character count in various ways.
 */
function getSharpieExtent(range: Range) {
  const startMeta = getSharpieOffsetMeta(range.startContainer);
  const endMeta = getSharpieOffsetMeta(range.endContainer);
  const start = startMeta.warp * range.startOffset + startMeta.pos;
  const end = endMeta.warp * range.endOffset + endMeta.pos;
  return [Math.floor(start), Math.ceil(end)];
}

/**
 * Global event handler that processes selections on mouse events.
 */
function delegate() {
  const selection = window.getSelection();

  if (selection.isCollapsed) {
    _debug("Ignoring collapsed selection");
    return;
  }

  const container = resolveContainer(selection);
  if (!container) {
    _debug("Ignoring selection due to overflow");
    return;
  }

  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    const extent = getSharpieExtent(range);
    _debug(range, extent);
  }
}

/**
 * Set up global selection event handling (idempotent).
 */
let init = false;
function initialize() {
  if (init) {
    return;
  }
  window.addEventListener("mouseup", delegate);
  init = true;
}

/**
 * Handle text selections within the given element.
 */
export function watch(element: HTMLElement) {
  initialize();
  watchList.add(element);
}

/**
 * Stop watching selection events on the given element.
 */
export function unwatch(element: HTMLElement) {
  watchList.delete(element);
}

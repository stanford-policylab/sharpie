import {Annotation, Markup, Redaction, StyleAttributes} from "./annotation";
import {defaults, _debug, sortedInsert} from "./util";
import {IDAllocator} from "./id_allocator";

/**
 * Options to control how annotations are rendered onto text.
 */
export interface RenderOpts {
  autoParagraph?: boolean;
}

/**
 * Internal object tracking state of redactions during output.
 */
interface RedactionMeta {
  redaction: Redaction;
  output: string[];
  extent: number;
  cursor: number;
}

/**
 * Internal object tracking state of annotations during opening.
 */
interface Opening {
  annotation: Annotation;
  tagName: string;
  novel: boolean;
  redaction?: RedactionMeta;
}

/**
 * HTML block tags
 */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
  ]);

/**
 * Sort the tags of simultaneously opening annotations.
 *
 * The sort order should:
 *  1) be valid HTML;
 *  2) preserve semantics of input annotations, and
 *  3) look good
 */
function sortOpenings(a: Opening, b: Opening) {
  const aType = a.annotation.type;
  const bType = b.annotation.type;
  const aTag = a.tagName.toLowerCase();
  const bTag = b.tagName.toLowerCase();

  // Always sort paragraph tags on the outside
  if (aTag === "p") {
    return -1;
  } else if (bTag === "p") {
    return 1;
  }

  // Sort highlights on the inside so they are visible
  if (aType !== bType) {
    if (aType === "highlight") {
      return 1;
    } else if (bType === "highlight") {
      return -1;
    }
  }

  // Sort block tags on the outside
  if (BLOCK_TAGS.has(aTag)) {
    return -1;
  } else if (BLOCK_TAGS.has(bTag)) {
    return 1;
  }

  // Lacking other conditions, preserve the input order.
  return -1;
}

/**
 * Put annotations in a reasonable order for processing.
 */
function sortAnnotations(a: Annotation, b: Annotation): number {
  if (a.start === b.start) {
    // Sort the element that will end first after (i.e., inside)
    return a.end < b.end ? 1 : -1;
  }
  return a.start < b.start ? -1 : 1;
}

/**
 * Create a dummy annotation representing an HTML paragraph span.
 */
function createParagraphAnnotation(start: number, end: number): Markup {
  return {
    start,
    end,
    type: "markup",
    meta: {
      htmlTagName: "p",
      htmlClassName: "auto-para-break",
    },
  };
}

/**
 * Map from Sharpie format property names to their CSS equivalents.
 */
const STYLE_TO_CSS = {
  "font": "font-family",
  "fontSize": "font-size",
  "color": "color",
  "bgColor": "background-color",
  "opacity": "opacity",
};

/**
 * Convert the Sharpie format options to CSS.
 *
 * The input object should include standard StyleAttributes keys, but any
 * additional keys will be treated as literal CSS keys.
 */
function createStyleString(style: StyleAttributes) {
  const styles = Object.keys(style).map((key: keyof StyleAttributes) => {
    const value = style[key];
    const cssKey = STYLE_TO_CSS[key] || key;
    return `${cssKey}: ${value}`;
  });

  if (!styles.length) {
    return "";
  }

  return styles.join("; ") + ";";
}

/**
 * Add paragraph break annotations to a piece of text.
 */
function inferParagraphBreaks(text: string): Markup[] {
  const annotations: Markup[] = [];
  const breakPattern = /\n/g;
  let lastPoint = 0;

  // Add paragraph annotations wherever there's a newline
  let br: RegExpExecArray | null = null;
  while ((br = breakPattern.exec(text)) !== null) {
    annotations.push(createParagraphAnnotation(lastPoint, br.index));
    lastPoint = br.index;
  }

  // Push at least one annotation that closes at the end of the text.
  annotations.push(createParagraphAnnotation(lastPoint, text.length));

  return annotations;
}

/**
 * Get the HTML tag name to use for the given annotation.
 */
function getTagName(annotation: Annotation, defaultTag: string = "span") {
  if (annotation.meta && annotation.meta.htmlTagName) {
    return annotation.meta.htmlTagName.toLowerCase();
  }
  return defaultTag.toLowerCase();
}

/**
 * Get an object used to generated styles.
 *
 * A default object is defined for each type, which the annotation itself may
 * override when it is defined.
 */
function getFormatObject(annotation: Annotation): Object | undefined {
  const overrides = annotation.format;
  switch (annotation.type) {
    case "markup":
      return overrides;
    case "redaction":
      const fmt = defaults(overrides, {
        bgColor: "#000000",
        color: "white",
        opacity: 0.8,
      });
      return {...fmt,
        "white-space": "pre-wrap",
        "word-break": "break-word",
      };
    case "highlight":
      return defaults(overrides, {
        bgColor: "#fffa129c",
      });
    default:
      return undefined;
  }
}

/**
 * Generate opening tag string for the annotation.
 */
function openTag(annotation: Annotation, annotationId: string, position: number, warp: number): string {
  const tagName = getTagName(annotation);
  const attrs: Array<[string, string]> = [];

  // Inline styles
  const format = getFormatObject(annotation);
  if (format) {
    attrs.push(["style", createStyleString(format)]);
  }

  // ID attribute
  if (annotation.meta && annotation.meta.id) {
    attrs.push(["id", annotation.meta.id]);
  }

  // className string
  const cls = ["sharpie-annotation", `sharpie-type-${annotation.type}`];
  if (annotationId) {
    cls.push(`sharpie-id-${annotationId}`);
  }
  if (annotation.meta && annotation.meta.htmlClassName) {
    cls.push(annotation.meta.htmlClassName);
  }
  attrs.push(["class", cls.join(" ")]);

  // Data attributes
  attrs.push(["data-sharpie-position", `${position}`]);
  attrs.push(["data-sharpie-warp", `${warp}`]);

  const attrString = attrs.map(([k, v]) => `${k}="${v}"`).join(" ");
  return `<${tagName}${attrString ? " " + attrString : ""}>`;
}

/**
 * Generate closing tag string for the annotation.
 */
function closeTag(annotation: Annotation, defaultTag?: string): string {
  const tagName = getTagName(annotation, defaultTag);
  return `</${tagName}>`;
}

/**
 * Create a buffer of the given text string of the given length.
 *
 * Each character within the text string will occupy a slot in the buffer. The
 * space character is used to pad before and after the text string until the
 * buffer is of the length specified by `width`.
 *
 * Some behavior of this function may be unexpected:
 *
 * 1) If text is greater than the designated width, it is returned directly.
 * 2) The padding character is treated as a single character regardless of
 *    its literal string length in JavaScript. This is so that HTML markup
 *    can be passed; the screen representation should still be a single
 *    character of text regardless.
 */
function createPaddedOutputBuffer(text: string | undefined, width: number, paddingChar: string) {
  text = text || "";
  const textLength = text.length;

  const length = Math.max(textLength, width);
  const delta = width - textLength;
  const lWidth = delta >> 1;
  const rWidth = delta - lWidth;

  const buf = new Array<string>(length);

  let cursor = 0;
  for (let i = 0; i < lWidth; i++) {
    buf[cursor++] = paddingChar;
  }

  for (let i = 0; i < textLength; i++) {
    buf[cursor++] = text[i];
  }

  for (let i = 0; i < rWidth; i++) {
    buf[cursor++] = paddingChar;
  }

  return buf;
}

/**
 * Test whether a parent annotation can safely contain the given child.
 *
 * E.g., inline elements cannot contain block elements.
 */
function canContain(ancestor: Annotation, child: Annotation) {
  const ancestorTag = getTagName(ancestor);
  const childTag = getTagName(child);

  // Force inline tags to reopen within block tags.
  if (BLOCK_TAGS.has(childTag) && !BLOCK_TAGS.has(ancestorTag)) {
    return false;
  }

  // Force highlights to reopen within redactions for aesthetic reasons.
  if (child.type === "redaction" && ancestor.type === "highlight") {
    return false;
  }

  return true;
}

/**
 * Render the given text into a string of HTML.
 */
export function renderToString(text: string, annotations: Annotation[], opts?: RenderOpts): string {
  opts = defaults(opts, {autoParagraph: true});

  if (opts.autoParagraph) {
    _debug("Generating HTML paragraph break annotations");
    annotations = [...annotations, ...inferParagraphBreaks(text)];
  }

  const ids = new IDAllocator<Annotation>();
  const warpMap = new WeakMap<Annotation, number>();
  // Queue for annotations to apply
  const sorted = annotations.sort(sortAnnotations);
  // Stack of annotations that have been opened
  const openOrderStack: Annotation[] = [];
  // Annotations stack ordered by end position. This is used to detect
  // annotations that have overlapping extents. When the extents overlap, close
  // and reopen the tags to generate valid HTML.
  const endOrderStack: Annotation[] = [];
  // Stack of overlapping tags that need to be reopened.
  const reopen: Annotation[] = [];
  // Stack of open redactions and their state.
  const openRedactions: RedactionMeta[] = [];

  // Generated output string (HTML)
  let output = "";

  for (let pointer = 0; pointer <= text.length; pointer++) {
    // Write any tags that are closing at this position
    while (endOrderStack.length > 0 && endOrderStack[0].end === pointer) {
      const endTag = endOrderStack.shift();
      // Write closing tags for every tag that overlaps this one
      while (openOrderStack.length > 0) {
        const openedAfter = openOrderStack.shift();
        output += closeTag(openedAfter);
        // Break out of the loop when the real tag to close is found.
        if (openedAfter === endTag) {
          break;
        }
        // Reopen any tags that continue beyond this one
        // NOTE: there may be annotations processed at this step that end at
        // the same position and should not be reopened.
        if (openedAfter.end > pointer) {
          reopen.unshift(openedAfter);
        }
      }
    }

    // A queue for all tags being opened at this position (whether it's for
    // a new tag or a reopened tag). This queue will be sorted in priority
    // order for opening.
    const openingQueue: Opening[] = [];

    // Process newly opening tags
    while (sorted.length > 0 && sorted[0].start === pointer) {
      const atn = sorted.shift();
      const tagName = getTagName(atn);

      // Find the outermost container that cannot safely contain the new child.
      let invalidContainerIndex = -1;
      for (let i = openOrderStack.length - 1; i >= 0; i--) {
        if (!canContain(openOrderStack[i], atn)) {
          invalidContainerIndex = i;
          break;
        }
      }

      // Everything up until the last invalid container needs to be closed and
      // reopened.
      for (let i = 0; i <= invalidContainerIndex; i++) {
        const openedBefore = openOrderStack.shift();
        output += closeTag(openedBefore);
        reopen.unshift(openedBefore);
        i++;
      }

      // Warp represents the number of characters in the real text are
      // represented by one character of output text in this range. It's added
      // so libraries operating on annotated text can compute positions
      // correctly despite annotation that may have altered the surface text.
      let warp = 1;
      let redaction: RedactionMeta | undefined;

      // Construct a new redaction object and compute warp factor as necessary
      if (atn.type === "redaction") {
        // Choose the effective redaction width by taking the explicitly
        // defined extent if there is one, or the max of the annotation span
        // and the redaction content length if not.
        const annotationExtent = atn.end - atn.start;
        const extent = atn.extent ?
          atn.extent :
          Math.max(annotationExtent, (atn.content || "").length);
        redaction = {
          redaction: atn,
          output: createPaddedOutputBuffer(atn.content, extent, "&nbsp;"),
          extent,
          cursor: 0,
        };
        // Compute warp factor: redactions can alter screen text length
        warp = annotationExtent / extent;
      }

      // Save metadata
      warpMap.set(atn, warp);

      openingQueue.push({
        annotation: atn,
        tagName,
        novel: true,
        redaction,
      });
    }

    // Process re-opening tags
    while (reopen.length > 0) {
      const atn = reopen.shift();
      openingQueue.push({
        annotation: atn,
        tagName: getTagName(atn),
        novel: false,
      });
    }

    // Write out all opening tags in the correct order
    openingQueue.sort(sortOpenings);
    while (openingQueue.length > 0) {
      const opening = openingQueue.shift();
      const atn = opening.annotation;

      if (opening.novel) {
        sortedInsert(endOrderStack, atn, a => a.end);
        if (opening.redaction) {
          openRedactions.unshift(opening.redaction);
        }
      }

      openOrderStack.unshift(atn);
      // Write open tag
      output += openTag(atn, ids.getId(atn), pointer, warpMap.get(atn));
    }

    // Clean up closing redactions
    while (openRedactions.length && openRedactions[0].redaction.end === pointer) {
      openRedactions.shift();
    }

    // Process open redaction annotations.
    for (let i = 0; i < openRedactions.length; i++) {
      const atn = openRedactions[i];

      // Calculate the new cursor position within this annotation
      let cursor = atn.cursor;
      const pct = (1 + pointer - atn.redaction.start) / (atn.redaction.end - atn.redaction.start);
      const rawPos = pct * atn.extent;
      atn.cursor = Math.floor(rawPos);
      // Only write the top-most redaction, and only when the cursor moved.
      const needsWrite = i === 0 && atn.cursor > cursor;

      // Write anything between the old cursor and the new cursor position.
      // This lets us write redactions with content longer than the span it
      // is technically redacting.
      while (needsWrite && cursor < atn.cursor) {
        output += atn.output[cursor++];
      }
    }

    // If the underlying text is not actively being  redacted, write it.
    if (openRedactions.length === 0) {
      output += text[pointer] || "";
    }
  }

  // Ta-da!
  return output;
}

/**
 * Render annotated text as plain HTML into the given DOM container.
 */
export function render(container: HTMLElement, text: string, annotations: Annotation[]) {
  const start = Date.now();
  const html = renderToString(text, annotations);
  _debug("Rendered in", Date.now() - start, "ms");
  container.innerHTML = html;
}

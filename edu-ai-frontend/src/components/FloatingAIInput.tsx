import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MorphSurface } from "@/components/smoothui/ai-input";

import { AIChatDrawer } from "./AIChatDrawer";

const FLOATING_INPUT_WIDTH = 360;
const FLOATING_INPUT_MARGIN = 24;
const FLOATING_INPUT_GAP = 12;
const CONTEXT_MAX_LENGTH = 640;
const EXPANDED_INPUT_HEIGHT_ESTIMATE = 220;

type FloatingPlacement = "top" | "bottom";

const BLOCK_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FOOTER",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "P",
  "SECTION",
  "TD",
  "TH",
]);

const IGNORED_TAGS = new Set([
  "BUTTON",
  "DIALOG",
  "INPUT",
  "MATH-FIELD",
  "NOSCRIPT",
  "PATH",
  "SCRIPT",
  "STYLE",
  "SVG",
  "TEXTAREA",
]);

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sliceContextWindow(source: string, selectionText: string, maxLength = CONTEXT_MAX_LENGTH) {
  if (source.length <= maxLength) {
    return source;
  }

  const normalizedSelection = normalizeText(selectionText);
  const selectionIndex = normalizedSelection ? source.indexOf(normalizedSelection) : -1;

  if (selectionIndex === -1) {
    return `${source.slice(0, maxLength).trim()}...`;
  }

  const remainingLength = Math.max(0, maxLength - normalizedSelection.length);
  const leadingLength = Math.floor(remainingLength / 2);
  const trailingLength = remainingLength - leadingLength;
  const start = Math.max(0, selectionIndex - leadingLength);
  const end = Math.min(source.length, selectionIndex + normalizedSelection.length + trailingLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";

  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
}

function getClosestBlockElement(node: Node | null) {
  let currentElement =
    node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement ?? null;

  while (currentElement) {
    if (BLOCK_TAGS.has(currentElement.tagName)) {
      return currentElement;
    }
    currentElement = currentElement.parentElement;
  }

  return null;
}

function getElementFromNode(node: Node | null) {
  return node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement ?? null;
}

function getKatexRoot(node: Node | null) {
  return getElementFromNode(node)?.closest(".katex");
}

function expandRangeAroundKatex(range: Range) {
  const expandedRange = range.cloneRange();
  const startKatex = getKatexRoot(expandedRange.startContainer);
  const endKatex = getKatexRoot(expandedRange.endContainer);

  if (startKatex) {
    expandedRange.setStartBefore(startKatex);
  }

  if (endKatex) {
    expandedRange.setEndAfter(endKatex);
  }

  return expandedRange;
}

function getKatexText(element: Element) {
  const annotation =
    element.querySelector("annotation[encoding='application/x-tex']") ??
    element.querySelector("annotation");

  const rawText = normalizeText(annotation?.textContent ?? "");
  return rawText ? `$${rawText}$` : "";
}

function serializeNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return "";
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;

    if (element.classList.contains("katex")) {
      const katexText = getKatexText(element);
      return katexText ? ` ${katexText} ` : "";
    }

    if (
      element.classList.contains("katex-html") ||
      element.classList.contains("katex-mathml") ||
      element.getAttribute("aria-hidden") === "true" ||
      IGNORED_TAGS.has(element.tagName)
    ) {
      return "";
    }

    if (element.tagName === "BR") {
      return "\n";
    }
  }

  let result = "";
  node.childNodes.forEach((childNode) => {
    result += serializeNodeText(childNode);
  });

  if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)) {
    result += "\n";
  }

  return result;
}

function getSelectionText(selection: Selection) {
  if (selection.rangeCount === 0) {
    return "";
  }

  const safeRange = expandRangeAroundKatex(selection.getRangeAt(0));
  return normalizeText(serializeNodeText(safeRange.cloneContents()));
}

function extractContextFromSelection(selection: Selection, fallbackText: string) {
  const range = expandRangeAroundKatex(selection.getRangeAt(0));
  const normalizedSelection = normalizeText(fallbackText);
  let currentElement = getClosestBlockElement(range.commonAncestorContainer);

  while (currentElement) {
    const candidate = normalizeText(serializeNodeText(currentElement.cloneNode(true)));
    if (candidate) {
      return sliceContextWindow(candidate, normalizedSelection);
    }

    currentElement = currentElement.parentElement;
  }

  return normalizedSelection.slice(0, CONTEXT_MAX_LENGTH);
}

function resolveFloatingPosition(rect: DOMRect) {
  const halfWidth = Math.min(
    FLOATING_INPUT_WIDTH / 2,
    Math.max(0, window.innerWidth / 2 - FLOATING_INPUT_MARGIN)
  );
  const spaceAbove = rect.top - FLOATING_INPUT_MARGIN;
  const spaceBelow = window.innerHeight - rect.bottom - FLOATING_INPUT_MARGIN;
  const placement: FloatingPlacement =
    spaceAbove >= EXPANDED_INPUT_HEIGHT_ESTIMATE || spaceAbove >= spaceBelow ? "top" : "bottom";

  return {
    placement,
    top: placement === "top" ? rect.top - FLOATING_INPUT_GAP : rect.bottom + FLOATING_INPUT_GAP,
    left: clamp(
      rect.left + rect.width / 2,
      FLOATING_INPUT_MARGIN + halfWidth,
      window.innerWidth - FLOATING_INPUT_MARGIN - halfWidth
    ),
  };
}

export function FloatingAIInput() {
  const [hasSelection, setHasSelection] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; placement: FloatingPlacement }>({
    top: 0,
    left: 0,
    placement: "top",
  });
  const [selectionSnapshot, setSelectionSnapshot] = useState({ selection: "", context: "" });
  const containerRef = useRef<HTMLDivElement>(null);
  const isInteracting = useRef(false);

  // Chat Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contextStr, setContextStr] = useState("");
  const [selectionStr, setSelectionStr] = useState("");
  const [queryStr, setQueryStr] = useState("");

  const handleAIQuery = (query: string) => {
    const nextQuery = query.trim();
    const nextSelection = selectionSnapshot.selection.trim();
    const nextContext = selectionSnapshot.context.trim() || nextSelection;

    if (!nextQuery || !nextSelection) {
      isInteracting.current = false;
      return;
    }

    setSelectionStr(nextSelection);
    setContextStr(nextContext);
    setQueryStr(nextQuery);
    setHasSelection(false);
    setDrawerOpen(true);
    isInteracting.current = false;
    window.getSelection()?.removeAllRanges();
  };

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        isInteracting.current = false;
        // If clicking outside, and selection is empty, hide it
        const sel = window.getSelection();
        if (!sel || sel.toString().trim().length === 0) {
          setHasSelection(false);
          setSelectionSnapshot({ selection: "", context: "" });
        }
      }
    };
    
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const checkSelection = () => {
      if (isInteracting.current || drawerOpen) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setHasSelection(false);
        setSelectionSnapshot({ selection: "", context: "" });
        return;
      }

      const text = getSelectionText(selection);
      if (text.length > 0) {
        const range = expandRangeAroundKatex(selection.getRangeAt(0));
        const rect = range.getBoundingClientRect();
        setPosition(resolveFloatingPosition(rect));
        setSelectionSnapshot({
          selection: text,
          context: extractContextFromSelection(selection, text),
        });
        setHasSelection(true);
      } else {
        setHasSelection(false);
        setSelectionSnapshot({ selection: "", context: "" });
      }
    };

    const handleSelectionChange = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const selection = window.getSelection();
      if (!selection || getSelectionText(selection).length === 0) {
        if (!isInteracting.current) {
          setHasSelection(false);
          setSelectionSnapshot({ selection: "", context: "" });
        }
        return;
      }

      timeoutId = setTimeout(() => {
        checkSelection();
      }, 180);
    };

    const handlePointerUp = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        checkSelection();
      }, 50);
    };

    const handleViewportChange = () => {
      if (hasSelection) {
        checkSelection();
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [drawerOpen, hasSelection]);

  return (
    <>
      <div
        ref={containerRef}
        className="fixed z-[120] pointer-events-none"
        style={{
          top: position.top,
          left: position.left,
          transform:
            position.placement === "top"
              ? "translate(-50%, -100%)"
              : "translate(-50%, 0)",
        }}
        onPointerDown={() => {
          isInteracting.current = true;
        }}
      >
        <AnimatePresence>
          {hasSelection && (
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.85 }}
              className="pointer-events-auto relative"
            >
              <MorphSurface onSubmit={(text: string) => handleAIQuery(text)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AIChatDrawer
        isOpen={drawerOpen}
        onClose={() => {
          isInteracting.current = false;
          setDrawerOpen(false);
        }}
        initialQuery={queryStr}
        selectionContext={selectionStr}
        contextContent={contextStr}
      />
    </>
  );
}

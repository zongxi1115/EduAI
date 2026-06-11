import { cn } from "@/lib/utils"
import { marked } from "marked"
import { memo, useMemo } from "react"

export type HtmlMarkdownProps = {
  children: string
  className?: string
}

const ALLOWED_ELEMENTS = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "circle",
  "code",
  "col",
  "colgroup",
  "dd",
  "defs",
  "desc",
  "details",
  "div",
  "dl",
  "dt",
  "ellipse",
  "em",
  "figcaption",
  "figure",
  "g",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "line",
  "lineargradient",
  "mark",
  "ol",
  "p",
  "path",
  "polygon",
  "polyline",
  "pre",
  "rect",
  "section",
  "small",
  "span",
  "stop",
  "strong",
  "sub",
  "summary",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "text",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "tspan",
  "u",
  "ul",
])

const BLOCKED_ELEMENTS = new Set([
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "textarea",
])

const GLOBAL_ATTRIBUTES = new Set([
  "aria-describedby",
  "aria-label",
  "aria-labelledby",
  "class",
  "colspan",
  "dir",
  "height",
  "lang",
  "role",
  "rowspan",
  "scope",
  "style",
  "title",
  "width",
])

const SVG_ATTRIBUTES = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "fill-opacity",
  "font-size",
  "font-family",
  "font-weight",
  "dominant-baseline",
  "height",
  "offset",
  "opacity",
  "points",
  "preserveaspectratio",
  "r",
  "rx",
  "ry",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "stop-color",
  "text-anchor",
  "transform",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
])

function isSafeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true
  }

  try {
    const url = new URL(trimmed, window.location.origin)
    return ["http:", "https:", "mailto:"].includes(url.protocol)
  } catch {
    return false
  }
}

function sanitizeStyle(value: string) {
  if (/(url\s*\(|expression\s*\(|@import|javascript:|vbscript:|data:|behavior\s*:)/i.test(value)) {
    return ""
  }

  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => /^[a-z-]+\s*:/i.test(declaration))
    .join("; ")
}

function isAllowedAttribute(tagName: string, attributeName: string) {
  if (attributeName.startsWith("aria-") || attributeName.startsWith("data-")) {
    return true
  }

  if (tagName === "a" && ["href", "target", "rel"].includes(attributeName)) {
    return true
  }

  return GLOBAL_ATTRIBUTES.has(attributeName) || SVG_ATTRIBUTES.has(attributeName)
}

function sanitizeAttributes(element: Element) {
  const tagName = element.tagName.toLowerCase()

  Array.from(element.attributes).forEach((attribute) => {
    const attributeName = attribute.name.toLowerCase()
    const attributeValue = attribute.value

    if (attributeName.startsWith("on") || !isAllowedAttribute(tagName, attributeName)) {
      element.removeAttribute(attribute.name)
      return
    }

    if (attributeName === "href" && !isSafeUrl(attributeValue)) {
      element.removeAttribute(attribute.name)
      return
    }

    if (attributeName === "style") {
      const nextStyle = sanitizeStyle(attributeValue)
      if (!nextStyle) {
        element.removeAttribute(attribute.name)
        return
      }
      element.setAttribute(attribute.name, nextStyle)
    }
  })

  if (tagName === "a" && element.getAttribute("target") === "_blank") {
    element.setAttribute("rel", "noreferrer noopener")
  }
}

function unwrapElement(element: Element) {
  const fragment = element.ownerDocument.createDocumentFragment()
  while (element.firstChild) {
    fragment.appendChild(element.firstChild)
  }
  element.replaceWith(fragment)
}

function sanitizeNode(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()

  if (BLOCKED_ELEMENTS.has(tagName)) {
    element.remove()
    return
  }

  Array.from(element.childNodes).forEach(sanitizeNode)

  if (!ALLOWED_ELEMENTS.has(tagName)) {
    unwrapElement(element)
    return
  }

  sanitizeAttributes(element)
}

function sanitizeHtml(html: string) {
  if (typeof window === "undefined") {
    return ""
  }

  const parser = new DOMParser()
  const parsedDocument = parser.parseFromString(html, "text/html")
  Array.from(parsedDocument.body.childNodes).forEach(sanitizeNode)
  return parsedDocument.body.innerHTML
}

function renderHtmlMarkdown(markdown: string) {
  const rendered = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string

  return sanitizeHtml(rendered)
}

function HtmlMarkdownComponent({ children, className }: HtmlMarkdownProps) {
  const html = useMemo(() => renderHtmlMarkdown(children), [children])

  return (
    <div
      className={cn("html-markdown", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const HtmlMarkdown = memo(HtmlMarkdownComponent)
HtmlMarkdown.displayName = "HtmlMarkdown"

export { HtmlMarkdown }

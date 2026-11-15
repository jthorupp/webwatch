import { parse, type DefaultTreeAdapterTypes } from "parse5";

const MAX_LINKS_PER_PAGE = 10_000;

export interface ExtractedLinks {
  hrefs: string[];
  baseHref?: string;
  foundCount: number;
  truncated: number;
}

export function extractAnchorHrefs(html: string): ExtractedLinks {
  const document = parse(html);
  const hrefs: string[] = [];
  let baseHref: string | undefined;
  let foundCount = 0;
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      if (node.tagName === "base" && baseHref === undefined) {
        baseHref = node.attrs.find((attribute) => attribute.name === "href")?.value;
      }
      if (node.tagName === "a") {
        const href = node.attrs.find((attribute) => attribute.name === "href")?.value;
        if (href !== undefined) {
          foundCount += 1;
          if (hrefs.length < MAX_LINKS_PER_PAGE) hrefs.push(href);
        }
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(document);
  return { hrefs, baseHref, foundCount, truncated: foundCount - hrefs.length };
}

export function resolveBaseUrl(baseHref: string | undefined, finalUrl: string): URL {
  if (baseHref === undefined) return new URL(finalUrl);
  try {
    return new URL(baseHref, finalUrl);
  } catch {
    return new URL(finalUrl);
  }
}

export function resolveCrawlLink(href: string, baseUrl: URL): URL | undefined {
  try {
    const target = new URL(href.trim(), baseUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
    if (target.username.length > 0 || target.password.length > 0) return undefined;
    target.hash = "";
    return target;
  } catch {
    return undefined;
  }
}

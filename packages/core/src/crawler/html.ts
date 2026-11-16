import { parse, type DefaultTreeAdapterTypes } from "parse5";

const MAX_LINKS_PER_PAGE = 10_000;
const MAX_RESOURCES_PER_PAGE = 10_000;

export interface ExtractedLinks {
  hrefs: string[];
  baseHref?: string;
  foundCount: number;
  truncated: number;
}

export type ResourceType = "image" | "stylesheet" | "script";

export interface ExtractedResources {
  type: ResourceType;
  url: string;
}

export interface ExtractedPageReferences extends ExtractedLinks {
  resources: ExtractedResources[];
  resourcesTruncated: number;
}

export function extractAnchorHrefs(html: string): ExtractedLinks {
  const references = extractPageReferences(html);
  return {
    hrefs: references.hrefs,
    baseHref: references.baseHref,
    foundCount: references.foundCount,
    truncated: references.truncated,
  };
}

export function extractPageReferences(html: string): ExtractedPageReferences {
  const document = parse(html);
  const hrefs: string[] = [];
  const resources: ExtractedResources[] = [];
  let baseHref: string | undefined;
  let foundCount = 0;
  let resourcesTruncated = 0;
  const addResource = (type: ResourceType, url: string): void => {
    if (resources.length < MAX_RESOURCES_PER_PAGE) resources.push({ type, url });
    else resourcesTruncated += 1;
  };
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
      if (node.tagName === "img") {
        const src = node.attrs.find((attribute) => attribute.name === "src")?.value;
        if (src !== undefined) addResource("image", src);
      }
      if (node.tagName === "link") {
        const rel = node.attrs.find((attribute) => attribute.name === "rel")?.value;
        const href = node.attrs.find((attribute) => attribute.name === "href")?.value;
        if (href !== undefined && rel?.toLowerCase().split(/\s+/).includes("stylesheet")) {
          addResource("stylesheet", href);
        }
      }
      if (node.tagName === "script") {
        const src = node.attrs.find((attribute) => attribute.name === "src")?.value;
        if (src !== undefined) addResource("script", src);
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(document);
  return { hrefs, baseHref, foundCount, truncated: foundCount - hrefs.length, resources, resourcesTruncated };
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

import { useEffect } from "react";
import { useLocation } from "react-router";
import { PATHS } from "../config/routes";
import {
  GOOGLE_SITE_VERIFICATION,
  LANDING_TITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  SITE_NAME,
  absoluteUrl,
  documentForPath,
  landingJsonLd,
  publicOrigin,
} from "./site";

export function DocumentHead() {
  const { pathname } = useLocation();

  useEffect(() => {
    const origin = publicOrigin(window.location.origin);
    const doc = documentForPath(pathname);
    const canonical = absoluteUrl(doc.canonicalPath, origin);
    const image = absoluteUrl(OG_IMAGE_PATH, origin);
    const jsonLd = doc.canonicalPath === PATHS.home ? landingJsonLd(origin) : null;

    document.title = doc.title;
    setMeta("name", "description", doc.description);
    setMeta("name", "google-site-verification", GOOGLE_SITE_VERIFICATION);
    setMeta("name", "robots", doc.robots);
    setMeta("name", "theme-color", "#07070d");
    setLink("canonical", canonical);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:site_name", SITE_NAME);
    setMeta("property", "og:locale", "en_US");
    setMeta("property", "og:title", doc.title);
    setMeta("property", "og:description", doc.description);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:image", image);
    setMeta("property", "og:image:width", String(OG_IMAGE_WIDTH));
    setMeta("property", "og:image:height", String(OG_IMAGE_HEIGHT));
    setMeta("property", "og:image:alt", LANDING_TITLE);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", doc.title);
    setMeta("name", "twitter:description", doc.description);
    setMeta("name", "twitter:image", image);
    setJsonLd(jsonLd);
  }, [pathname]);

  return null;
}

function setMeta(kind: "name" | "property", key: string, content: string) {
  const selector = kind === "name" ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(kind, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setLink(rel: string, href: string) {
  let element = document.head.querySelector(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

function setJsonLd(payload: Record<string, unknown> | null) {
  const id = "athens-jsonld";
  const existing = document.getElementById(id);
  if (!payload) {
    existing?.remove();
    return;
  }
  const script = existing instanceof HTMLScriptElement ? existing : document.createElement("script");
  script.id = id;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(payload);
  if (!existing) document.head.appendChild(script);
}

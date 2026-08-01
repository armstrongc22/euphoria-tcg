import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Sends a GA4 page_view on every client-side route change.
 *
 * gtag('config', ...) in index.html fires a page_view for the initial hard
 * load, but SPA navigations never reload the page, so GA would otherwise only
 * ever see the landing page. We skip the first location here to avoid
 * double-counting that initial load, then emit a page_view for each subsequent
 * route. document.title is read after usePageTitle has updated it (page-level
 * effects run before this parent-level effect), so page_title stays accurate.
 */
export function usePageViews(): void {
  const location = useLocation();
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }

    window.gtag?.("event", "page_view", {
      page_path: location.pathname + location.search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);
}

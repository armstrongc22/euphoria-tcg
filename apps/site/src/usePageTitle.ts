import { useEffect } from "react";

const SITE_NAME = "Euphoria Universe";

/**
 * Sets the document title for the current page ("<page> · Euphoria Universe"),
 * restoring the plain site name for the homepage (pass no argument). SPA
 * routing never touches <title> on its own, so without this every route shares
 * one title — bad for tabs, history, bookmarks, and search results.
 */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title === undefined ? SITE_NAME : `${title} · ${SITE_NAME}`;
  }, [title]);
}

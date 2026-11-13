// A ?flags= list for testing (see flags.js) lasts for the rest of the browser tab, because links between
// pages drop the query. Every page loads this (through ui/nav.js, and flags.js), so a ?flags= on any
// page counts. ?flags=server ends it. Returns the list in force, or null for "what the server says".

const KEY = "orson-flags-preview";

/** @returns {string | null} */
export function flagPreview() {
  let preview = new URLSearchParams(location.search).get("flags");
  try {
    if (preview === "server") {
      sessionStorage.removeItem(KEY);
      preview = null;
    } else if (preview !== null) sessionStorage.setItem(KEY, preview);
    else preview = sessionStorage.getItem(KEY);
  } catch {
    // No session storage: the list only applies to the page it's on.
  }
  return preview;
}

flagPreview();

// Where the server is. On the website it's this site's own /api; while developing (a page on
// localhost) it's the local Worker; in the iOS app (Capacitor, ios/) the page comes from inside the
// app, so it's the live site's.

export const IN_APP = location.protocol === "capacitor:";
export const LOCAL = !IN_APP && ["localhost", "127.0.0.1"].includes(location.hostname);
export const API = IN_APP ? "https://orsonbrooker.com/api" : LOCAL ? "http://localhost:8787/api" : "/api";

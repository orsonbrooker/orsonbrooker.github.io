// Messages on the site's forms (the ideas form, the player builder and the leaderboard), so
// problems are hard to miss. Styles are in feedback/widget.css.

import { icon } from "./icons.js";

// The message under a form: plain for progress ("Sending…"), a red box for problems.
export function say(message, text, { error = false } = {}) {
  message.classList.toggle("fb-error", error && !!text);
  message.innerHTML = error && text ? icon("close") : "";
  message.append(text);
}

// Marks a box as having a problem, with the reason right under it. An empty reason clears it.
export function markField(input, reason) {
  let note = input.nextElementSibling?.classList.contains("fb-field-error") ? input.nextElementSibling : null;
  input.setAttribute("aria-invalid", String(!!reason));
  if (!reason) {
    note?.remove();
    input.removeAttribute("aria-describedby");
    return;
  }
  if (!note) {
    note = Object.assign(document.createElement("p"), { className: "fb-field-error", id: `${input.id || "field"}-error` });
    input.after(note);
  }
  note.textContent = reason;
  input.setAttribute("aria-describedby", note.id);
}

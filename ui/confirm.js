// A yes/no question in the site's own style, instead of the browser's confirm() box.
//
//   if (await confirmDialog("Remove Jahn from this device?", { yes: "Remove" })) { ... }
//
// `yesIcon` picks the yes button's pixel icon. With `no: null` there's only the one button, for
// telling them something (like "Thanks!") instead of asking.

import { icon } from "../ui/icons.js";

export function confirmDialog(question, { yes = "Okay", no = "Cancel", detail = "", yesIcon = "close" } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.innerHTML = `
      <form method="dialog">
        <p class="confirm-question"></p>
        ${detail ? '<p class="confirm-detail"></p>' : ""}
        <div class="confirm-actions">
          ${no === null ? "" : `<button value="no" type="submit">${no}</button>`}
          <button value="yes" type="submit" class="primary">${yesIcon ? icon(yesIcon) : ""}<span>${yes}</span></button>
        </div>
      </form>`;
    dialog.querySelector(".confirm-question").textContent = question;
    if (detail) dialog.querySelector(".confirm-detail").textContent = detail;
    // Taps on the dimmed backdrop count as "no".
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close("no");
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "yes");
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector(no === null ? '[value="yes"]' : '[value="no"]').focus(); // the safe choice is the default
  });
}

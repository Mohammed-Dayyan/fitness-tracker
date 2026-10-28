/**
 * Copies text to the clipboard and reports whether it actually worked.
 * navigator.clipboard needs a secure context, a focused page and permission;
 * when it is missing or refused, falls back to the legacy copy command.
 * Callers must show "Copied" only when this returns true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export const COPY_FAILED_MESSAGE = "Couldn't copy to the clipboard. Allow clipboard access for this site, or select the text and copy it yourself.";

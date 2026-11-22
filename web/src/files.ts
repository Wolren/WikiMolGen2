/**
 * Small file helpers shared by the import and export actions.
 *
 * The page has no backend, so an export is an object URL and an import is a File read.
 */

/** Save text as a file, the same way the PNG and theme exports do. */
export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

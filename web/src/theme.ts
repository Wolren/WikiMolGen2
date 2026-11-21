/**
 * Interface themes: Light, Paper, Dark, or System.
 *
 * The head script in index.html applies the stored choice before the first paint. This
 * module keeps the picker, the media query and storage in step after that.
 */

export type ThemeChoice = "system" | "light" | "paper" | "dark";
export type ThemeName = "light" | "paper" | "dark";

const STORAGE_KEY = "molplate.theme";
const CHOICES: ThemeChoice[] = ["system", "light", "paper", "dark"];
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && CHOICES.includes(stored as ThemeChoice)) {
      return stored as ThemeChoice;
    }
  } catch {
    // Storage can be blocked; System is the safe default.
  }
  return "system";
}

function resolved(choice: ThemeChoice): ThemeName {
  if (choice === "system") return systemDark.matches ? "dark" : "light";
  return choice;
}

function apply(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolved(choice);
  // The stage canvas cannot read CSS, so it listens for this event.
  document.dispatchEvent(new CustomEvent("themechange"));
}

/** The colour behind the figure, from the active theme. The 3D canvas copies it. */
export function stageTint(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--stage-tint")
    .trim();
  return value === "" ? "#ffffff" : value;
}

/** Wire the picker and the OS preference. A stored choice wins over the OS. */
export function bindTheme(): void {
  const select = document.getElementById("theme") as HTMLSelectElement | null;
  let choice = readChoice();
  apply(choice);

  if (select !== null) {
    select.value = choice;
    select.addEventListener("change", () => {
      choice = select.value as ThemeChoice;
      apply(choice);
      try {
        localStorage.setItem(STORAGE_KEY, choice);
      } catch {
        // A blocked store only means the choice lasts for this visit.
      }
    });
  }

  systemDark.addEventListener("change", () => {
    if (choice === "system") apply("system");
  });
}

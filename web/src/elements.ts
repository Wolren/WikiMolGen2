/**
 * Element symbols in atomic-number order, for the RDKit colour palette.
 *
 * RDKit keys `atomColourPalette` by atomic number, while the inks arrive as symbols.
 */

/** The first 118 symbols: index 0 is hydrogen, so the number is index + 1. */
const SYMBOLS = [
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
  "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
  "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
  "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
  "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
];

const NUMBERS = new Map(SYMBOLS.map((symbol, index) => [symbol, index + 1]));

/** The atomic number for a symbol, or `null` for a placeholder like `R`. */
export function atomicNumber(symbol: string): number | null {
  return NUMBERS.get(symbol) ?? null;
}

/** An element ink as RDKit wants it: a 0..1 RGB triple, or `null` for a bad hex. */
export function rgbTriple(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

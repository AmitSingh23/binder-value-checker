export const TCGDEX_API = "https://api.tcgdex.net/v2/en";

export const STORAGE_KEYS = {
  list: "bvc-list", // the textarea contents
  results: "bvc-results", // the last lookup
  overrides: "bvc-overrides", // "Your price" entries
  scanPasscode: "bvc-scan-passcode",
} as const;

/* ---------- Conditions ---------- */

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_NAME: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

// Everything a user might type for a condition (upper-cased), mapped to our short code.
export const CONDITION_ALIASES: Record<string, Condition> = {
  "NM": "NM", "MINT": "NM", "NEAR MINT": "NM",
  "LP": "LP", "LIGHTLY PLAYED": "LP", "LIGHT PLAYED": "LP",
  "MP": "MP", "MODERATELY PLAYED": "MP", "PLAYED": "MP",
  "HP": "HP", "HEAVILY PLAYED": "HP", "HEAVY PLAYED": "HP",
  "DMG": "DMG", "DM": "DMG", "DAMAGED": "DMG", "POOR": "DMG",
};

/* ---------- Printings (TCGdex calls them variants) ---------- */

// Which printing counts as a card's "main" price, best first.
// Printings not in this list go to the end.
export const VARIANT_ORDER = [
  "holofoil",
  "normal",
  "1st-edition-holofoil",
  "1st-edition",
  "1st-edition-normal",
  "unlimited-holofoil",
  "unlimited",
  "reverse-holofoil",
];

// Short names shown in the table.
export const VARIANT_LABEL: Record<string, string> = {
  "holofoil": "holo",
  "normal": "normal",
  "reverse-holofoil": "reverse",
  "1st-edition-holofoil": "1st ed holo",
  "1st-edition": "1st ed",
  "1st-edition-normal": "1st ed",
  "unlimited-holofoil": "unl. holo",
  "unlimited": "unlimited",
};

// TCGplayer's own names for printings, spelled the way its listing filter expects.
export const TCGPLAYER_PRINTING: Record<string, string> = {
  "holofoil": "Holofoil",
  "normal": "Normal",
  "reverse-holofoil": "Reverse Holofoil",
  "1st-edition-holofoil": "1st Edition Holofoil",
  "1st-edition": "1st Edition",
  "1st-edition-normal": "1st Edition",
  "unlimited-holofoil": "Unlimited Holofoil",
  "unlimited": "Unlimited",
};

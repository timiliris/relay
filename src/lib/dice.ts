/**
 * Jets de dés en notation classique (`d20`, `2d6+3`, `4d8-2`), pour les outils de
 * jeu de rôle du composeur. Le générateur aléatoire est injectable pour les tests.
 */

export interface DiceSpec {
  /** Nombre de dés lancés (1 à 100). */
  count: number;
  /** Faces par dé (2 à 1000). */
  sides: number;
  /** Modificateur ajouté à la somme (−999 à 999). */
  modifier: number;
}

export interface DiceRoll extends DiceSpec {
  /** Résultat de chaque dé, dans l'ordre. */
  rolls: number[];
  /** Somme des dés plus le modificateur. */
  total: number;
}

export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
export const MAX_MODIFIER = 999;

/** Dés proposés dans le menu, par ordre croissant. */
export const STANDARD_DICE: readonly number[] = [4, 6, 8, 10, 12, 20, 100];

const NOTATION = /^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i;

/**
 * Analyse une notation `NdM±K`. `N` vaut 1 par défaut, les espaces autour du
 * modificateur sont tolérés. Renvoie `null` si la notation est invalide ou hors bornes.
 */
export function parseDice(notation: string): DiceSpec | null {
  const match = NOTATION.exec(notation.trim());
  if (!match) return null;
  const [, countRaw, sidesRaw, sign, modifierRaw] = match;
  const count = countRaw ? Number(countRaw) : 1;
  const sides = Number(sidesRaw);
  const modifier = modifierRaw ? Number(modifierRaw) * (sign === '-' ? -1 : 1) : 0;
  if (count < 1 || count > MAX_DICE) return null;
  if (sides < 2 || sides > MAX_SIDES) return null;
  if (Math.abs(modifier) > MAX_MODIFIER) return null;
  return { count, sides, modifier };
}

/** Notation canonique d'une spécification (`2d6+3`, `d20`, `3d8-1`). */
export function formatDice(spec: DiceSpec): string {
  const base = `${spec.count === 1 ? '' : spec.count}d${spec.sides}`;
  if (spec.modifier === 0) return base;
  return `${base}${spec.modifier > 0 ? '+' : '-'}${Math.abs(spec.modifier)}`;
}

/**
 * Lance les dés. `random` renvoie un nombre dans [0, 1) (par défaut `Math.random`) ;
 * chaque dé tombe entre 1 et `sides` inclus.
 */
export function rollDice(spec: DiceSpec, random: () => number = Math.random): DiceRoll {
  const rolls: number[] = [];
  for (let i = 0; i < spec.count; i++) {
    const r = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
    rolls.push(Math.floor(r * spec.sides) + 1);
  }
  const total = rolls.reduce((sum, v) => sum + v, 0) + spec.modifier;
  return { ...spec, rolls, total };
}

import { describe, expect, it } from 'vitest';
import { formatDice, MAX_DICE, MAX_SIDES, parseDice, rollDice } from './dice';

/** Générateur déterministe : renvoie les valeurs données dans l'ordre, puis 0. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('parseDice', () => {
  it('lit une notation complète', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
  });

  it('suppose un seul dé sans nombre, insensible à la casse et aux espaces', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('  3D8 - 2 ')).toEqual({ count: 3, sides: 8, modifier: -2 });
  });

  it('lit un modificateur négatif', () => {
    expect(parseDice('4d8-2')?.modifier).toBe(-2);
  });

  it('refuse les notations invalides', () => {
    for (const bad of ['', 'd', '2d', 'abc', '2d6+', '2d6+3+1', '2x6', '1.5d6', '2d6.5', '-1d6'])
      expect(parseDice(bad), bad).toBeNull();
  });

  it('respecte les bornes', () => {
    expect(parseDice('0d6')).toBeNull();
    expect(parseDice(`${MAX_DICE}d6`)).not.toBeNull();
    expect(parseDice(`${MAX_DICE + 1}d6`)).toBeNull();
    expect(parseDice('d1')).toBeNull();
    expect(parseDice(`d${MAX_SIDES}`)).not.toBeNull();
    expect(parseDice(`d${MAX_SIDES + 1}`)).toBeNull();
    expect(parseDice('d6+999')).not.toBeNull();
    expect(parseDice('d6+1000')).toBeNull();
    expect(parseDice('d6-1000')).toBeNull();
  });
});

describe('formatDice', () => {
  it('produit la notation canonique', () => {
    expect(formatDice({ count: 1, sides: 20, modifier: 0 })).toBe('d20');
    expect(formatDice({ count: 2, sides: 6, modifier: 3 })).toBe('2d6+3');
    expect(formatDice({ count: 3, sides: 8, modifier: -1 })).toBe('3d8-1');
  });
});

describe('rollDice', () => {
  it('lance chaque dé avec le générateur fourni et additionne le modificateur', () => {
    const roll = rollDice({ count: 2, sides: 6, modifier: 3 }, sequence(0.5, 0.2));
    expect(roll.rolls).toEqual([4, 2]);
    expect(roll.total).toBe(9);
  });

  it('applique un modificateur négatif, même sous zéro', () => {
    const roll = rollDice({ count: 1, sides: 4, modifier: -5 }, sequence(0));
    expect(roll.rolls).toEqual([1]);
    expect(roll.total).toBe(-4);
  });

  it('reste entre 1 et le nombre de faces aux extrémités du générateur', () => {
    expect(rollDice({ count: 1, sides: 20, modifier: 0 }, () => 0).rolls).toEqual([1]);
    expect(rollDice({ count: 1, sides: 20, modifier: 0 }, () => 0.999999).rolls).toEqual([20]);
    // Un générateur fautif renvoyant 1 ne doit pas dépasser le nombre de faces.
    expect(rollDice({ count: 1, sides: 6, modifier: 0 }, () => 1).rolls).toEqual([6]);
  });

  it('respecte les bornes avec Math.random sur un grand nombre de jets', () => {
    const roll = rollDice({ count: 100, sides: 6, modifier: 0 });
    expect(roll.rolls).toHaveLength(100);
    expect(roll.rolls.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true);
    expect(roll.total).toBe(roll.rolls.reduce((s, v) => s + v, 0));
  });
});

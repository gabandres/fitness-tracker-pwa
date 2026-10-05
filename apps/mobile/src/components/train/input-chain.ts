import { useLayoutEffect, useMemo, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * Weight → reps → next row's weight: the order the live session's number
 * fields are walked in by the keyboard's ‹ › (iOS `KeyboardBar`) and by
 * Android's Next key.
 *
 * ## Why this exists
 *
 * Changing a set's weight and reps and ticking it was three taps plus digits,
 * with no way from one field to the next but closing the keyboard and aiming
 * at the next box (Train review item 6). Strong and Hevy both chain the
 * fields; this is the chain.
 *
 * ## Shape
 *
 * A registry, not a context: each `SetRow` registers its inputs under a key
 * (`exercise:set:field`), and the session passes ONE stable object down, so
 * memoized rows are not re-rendered by it. The ORDER is derived from the
 * session on demand — never stored — because sets are added, removed and
 * reordered mid-workout and a cached order would point at the wrong row.
 */

export type ChainField = 'weight' | 'count';

export interface ChainSlot {
  exerciseIndex: number;
  setIndex: number;
  field: ChainField;
}

export interface InputChain {
  register: (slot: ChainSlot, input: TextInput | null) => void;
  /** Focus the field after / before `slot`. Returns false at either end, so
   *  the caller can dismiss the keyboard instead. */
  next: (slot: ChainSlot) => boolean;
  prev: (slot: ChainSlot) => boolean;
}

const keyOf = (s: ChainSlot) => `${s.exerciseIndex}:${s.setIndex}:${s.field}`;

/**
 * The fields of every OPEN exercise, in reading order. A collapsed card
 * renders no inputs, so it contributes nothing — the chain only ever walks
 * what is on screen. Pure, for the test.
 */
export function chainOrder(
  exercises: readonly { logStyle?: string; sets: readonly unknown[] }[],
  isOpen: (exerciseIndex: number) => boolean,
): ChainSlot[] {
  const out: ChainSlot[] = [];
  exercises.forEach((ex, exerciseIndex) => {
    if (!isOpen(exerciseIndex)) return;
    const hasWeight = (ex.logStyle ?? 'weight-reps') === 'weight-reps';
    ex.sets.forEach((_, setIndex) => {
      if (hasWeight) out.push({ exerciseIndex, setIndex, field: 'weight' });
      out.push({ exerciseIndex, setIndex, field: 'count' });
    });
  });
  return out;
}

/** One chain per live session. `order` is read at call time through a ref, so
 *  the returned object keeps one identity for the whole workout. */
export function useInputChain(order: () => ChainSlot[]): InputChain {
  const inputs = useRef(new Map<string, TextInput>());
  const orderRef = useRef(order);
  // After render, not during it: a ref written in render is a React Compiler
  // bail-out, and every caller reads it from an event handler anyway.
  useLayoutEffect(() => {
    orderRef.current = order;
  });
  return useMemo<InputChain>(() => {
    const step = (slot: ChainSlot, dir: 1 | -1): ChainSlot | null => {
      const list = orderRef.current();
      const at = list.findIndex((s) => keyOf(s) === keyOf(slot));
      if (at < 0) return null;
      for (let i = at + dir; i >= 0 && i < list.length; i += dir) {
        if (inputs.current.has(keyOf(list[i]))) return list[i];
      }
      return null;
    };
    const focus = (slot: ChainSlot | null) => {
      if (!slot) return false;
      inputs.current.get(keyOf(slot))?.focus();
      return true;
    };
    return {
      register: (slot, input) => {
        if (input) inputs.current.set(keyOf(slot), input);
        else inputs.current.delete(keyOf(slot));
      },
      next: (slot) => focus(step(slot, 1)),
      prev: (slot) => focus(step(slot, -1)),
    };
  }, []);
}

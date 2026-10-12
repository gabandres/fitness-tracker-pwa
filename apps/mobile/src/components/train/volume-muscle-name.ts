import type { VolumeMuscle } from '@macrolog/core';
import type { I18nKey } from '@/i18n';

/**
 * A volume muscle's name in the CHIP taxonomy (F5, ADR-0046): the muscle tags
 * offer "Shoulders" and "Core", never "Front delt" or "Abs", so a finer muscle
 * is named as its chip plus which part — "Shoulders (front)" — and a muscle
 * the chips name the same way reads the chip's own key. The weekly volume
 * sheet and the lift's "counts it as" line read these same keys, so the two
 * screens cannot drift into two vocabularies again (the sheet said "Front
 * delt" and "Abs" beside chips that said "Shoulders" and "Core").
 */
export const VOLUME_MUSCLE_KEY: Record<VolumeMuscle, I18nKey> = {
  chest: 'train.muscle.chest',
  frontDelt: 'train.muscleCredit.frontDelt',
  sideDelt: 'train.muscleCredit.sideDelt',
  rearDelt: 'train.muscleCredit.rearDelt',
  triceps: 'train.muscle.triceps',
  back: 'train.muscle.back',
  biceps: 'train.muscle.biceps',
  quads: 'train.muscle.quads',
  hamstrings: 'train.muscle.hamstrings',
  glutes: 'train.muscle.glutes',
  calves: 'train.muscle.calves',
  abs: 'train.muscleCredit.abs',
};

export interface MacroEstimate {
  calories: number;
  protein: number | null;
  carbs?: number | null;
  fat?: number | null;
  label: string;
}

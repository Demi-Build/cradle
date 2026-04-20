export type PuzzleChoice = {
  text: string;
  stat_check?: string | null;
  dc?: number;
  auto_success?: boolean;
  success_text?: string;
  tool_attribute?: string;
  ability_attribute?: string;
  spell_attribute?: string;
};

export type PuzzleEvent = {
  id?: number | string;
  type?: string;
  name?: string;
  description?: string;
  difficulty?: number;
  choices?: PuzzleChoice[];
  correct_tool?: string;
  correct_ability?: string;
  correct_spell?: string;
  failure_damage_type?: string;
  failure_damage_range?: [number, number];
  reward_chance?: number;
  loot_table?: Array<{ item_id?: number | string; drop_chance?: number }>;
  money_drop?: [number, number];
};

export type CorrectKind = "tool" | "ability" | "spell" | null;

export function correctMatch(choice: PuzzleChoice, event: PuzzleEvent): CorrectKind {
  if (event.correct_tool && choice.tool_attribute === event.correct_tool) return "tool";
  if (event.correct_ability && choice.ability_attribute === event.correct_ability) return "ability";
  if (event.correct_spell && choice.spell_attribute === event.correct_spell) return "spell";
  return null;
}

export function formatCheck(choice: PuzzleChoice): string {
  if (choice.auto_success) return "auto-success";
  if (!choice.stat_check || !choice.dc) return "free";
  return `${choice.stat_check} DC ${choice.dc}`;
}

export function hasTreeView(event: PuzzleEvent): boolean {
  return !!event.choices && event.choices.length > 0;
}

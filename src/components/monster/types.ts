export type MonsterAbility = {
  name?: string;
  effect_type?: string;
  damage_dice?: string;
  chance?: number;
};

export type Monster = {
  hp_range?: [number, number];
  ac_range?: [number, number];
  level?: number;
  damage_type?: string;
  physical_type?: string;
  elemental_affinity?: string;
  weakness?: string;
  is_boss?: boolean;
  species?: string;
  time_availability?: string;
  abilities?: MonsterAbility[];
  // Root-level base-attack fields canon may emit in a future schema revision.
  // Any non-empty dice-notation string ("1d6", "2d8+1") on any of these keys
  // renders as a Damage stat slot. If none are present (current data), nothing
  // renders — cradle doesn't invent values.
  attack_dice?: string;
  damage_dice?: string;
  damage?: string;
};

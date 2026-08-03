// Mirrors canon's _UPDATE_NESTING (examples/platformer_pack/ops.py): which
// nested dict each KNOWN flat field lives in, per db type. Canon routes these
// bare names on `db update`; any other nested key (hand-added custom knobs)
// must travel as a dotted "<container>.<key>" path or canon refuses it as an
// unknown field.
export const DB_NESTING: Record<string, Record<string, string>> = {
  enemy: {
    hp: "stats",
    damage: "stats",
    speed: "stats",
    flavor: "stats",
    placeholder_color: "stats",
    patrol_range: "behavior",
    aggro_range: "behavior",
    leash_range: "behavior",
    swim_style: "behavior",
    hop_height: "behavior",
    hop_period_s: "behavior",
  },
  item: {
    duration_s: "params",
    heal_amount: "params",
    coin_value: "params",
    boost_mult: "params",
    flavor: "stats",
    placeholder_color: "stats",
  },
};

import whisperbrook from "../../assets/start/env_whisperbrook.png";
import sanctum from "../../assets/start/env_sanctum.png";
import crystal from "../../assets/start/env_crystal.png";
import shadowspire from "../../assets/start/env_shadowspire.png";
import nexus from "../../assets/start/env_nexus.png";

const MAP = {
  whisperbrook,
  sanctum,
  crystal,
  shadowspire,
  nexus,
} as const;

export type EnvKey = keyof typeof MAP;

export function envImageFor(key: EnvKey | string): string {
  return (MAP as Record<string, string>)[key] ?? whisperbrook;
}

/** "Not now" on the first-run key card lasts for the rest of this session:
 *  the card comes back on the next launch while there is still no key file. */
let dismissed = false;

export function keySetupDismissed(): boolean {
  return dismissed;
}

export function dismissKeySetup(): void {
  dismissed = true;
}

/** For tests. */
export function resetKeySetupCard(): void {
  dismissed = false;
}

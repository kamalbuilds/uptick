/** The part of deployments/4663.json a cap needs: the vaults by ticker, each with the address it was deployed at and the cap read back from the chain. */
export type DeployedRecord = { vaults: Record<string, { address: string; capUsd: number }> };

/** The deposit cap a vault enforces. A vault live at the address on record caps at the record's capUsd (what the contract's depositCap holds, read from the chain);
 *  every other vault, including one live at a different address such as a fork, keeps the cap the replay sized it to at launch. */
export function liveCapUsd(launchCapUsd: number, symbol: string, address: string | undefined, record: DeployedRecord): number {
  const deployed = record.vaults[symbol];
  return deployed && address && deployed.address.toLowerCase() === address.toLowerCase() ? deployed.capUsd : launchCapUsd;
}

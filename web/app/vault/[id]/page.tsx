import { notFound } from "next/navigation";
import { VaultDetail } from "@/components/vault-detail";
import { VAULTS, getVault } from "@/lib/vaults";

export function generateStaticParams() {
  return VAULTS.map((v) => ({ id: v.id }));
}

export default async function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cfg = getVault(id);
  if (!cfg) notFound();
  return <VaultDetail cfg={cfg} />;
}

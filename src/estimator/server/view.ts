import { ServiceItem } from "@/generated/prisma/client";
import { CatalogRow } from "../components/builder";
export function catalogDTO(item: ServiceItem): CatalogRow {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description ?? "",
    unit: item.unit,
    materialCost: item.materialCost.toString(),
    laborCost: item.laborCost.toString(),
    subcontractorCost: item.subcontractorCost.toString(),
    otherDirectCost: item.otherDirectCost.toString(),
    overheadAllocation: item.overheadAllocation.toString(),
    targetMargin: item.targetMargin.toString(),
    minimumMargin: item.minimumMargin.toString(),
    active: item.active,
    effectiveFrom: item.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: item.effectiveTo?.toISOString().slice(0, 10) ?? "",
  };
}

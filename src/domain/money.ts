import Decimal from "decimal.js";
export function price(input: {
  material: string;
  labor: string;
  subcontractor: string;
  overhead: string;
  quantity: string;
  markup: string;
  minimumMargin: string;
}) {
  const values = Object.values(input).map((v) => new Decimal(v));
  if (values.some((v) => !v.isFinite() || v.isNegative()))
    throw new Error("Invalid nonnegative amount");
  const margin = new Decimal(input.minimumMargin);
  if (margin.gte(1)) throw new Error("Margin must be less than 100%");
  const directCost = new Decimal(input.material)
    .plus(input.labor)
    .plus(input.subcontractor)
    .mul(input.quantity)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const totalCost = directCost
    .plus(new Decimal(input.overhead).mul(input.quantity))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const sellingPrice = Decimal.max(
    totalCost.mul(new Decimal(input.markup).plus(1)),
    directCost.div(new Decimal(1).minus(margin)),
  ).toDecimalPlaces(2, Decimal.ROUND_UP);
  const grossProfit = sellingPrice.minus(directCost);
  const grossMargin = sellingPrice.isZero()
    ? new Decimal(0)
    : grossProfit.div(sellingPrice);
  return {
    directCost: directCost.toFixed(2),
    sellingPrice: sellingPrice.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    grossMargin: grossMargin.toFixed(4),
  };
}

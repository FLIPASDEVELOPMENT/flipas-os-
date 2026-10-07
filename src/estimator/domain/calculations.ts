import Decimal from "decimal.js";
import { LineInput } from "./input";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const cents = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const finite = (v: Decimal) => {
  if (!v.isFinite() || v.abs().gte("1000000000000"))
    throw new Error("Financial amount exceeds supported range");
  return v;
};
export function targetPrice(cost: string, margin: string) {
  const c = new D(cost),
    m = new D(margin);
  if (
    !c.isFinite() ||
    c.isNegative() ||
    !m.isFinite() ||
    m.isNegative() ||
    m.gte(1)
  )
    throw new Error("Invalid cost or margin");
  return finite(
    c.div(new D(1).minus(m)).toDecimalPlaces(2, Decimal.ROUND_CEIL),
  ).toFixed(2);
}
export function marginRatio(cost: string, revenue: string) {
  const c = new D(cost),
    r = new D(revenue);
  if (r.isZero()) return null;
  return r.minus(c).div(r).toFixed(4);
}
export function markupRatio(cost: string, revenue: string) {
  const c = new D(cost);
  return c.isZero() ? null : new D(revenue).minus(c).div(c).toFixed(4);
}
export function calculateEstimate(
  lines: LineInput[],
  discountRate: string,
  taxRate: string,
  taxTreatment: string,
  discountThreshold = "0",
) {
  const discount = new D(discountRate),
    tax = new D(taxRate);
  if ([discount, tax].some((v) => !v.isFinite() || v.lt(0) || v.gt(1)))
    throw new Error("Invalid discount/tax");
  if (!["UNREVIEWED", "EXEMPT", "TAXABLE"].includes(taxTreatment))
    throw new Error("Invalid tax treatment");
  const calculated = lines.map((line) => {
    const qty = new D(line.quantity);
    if (!qty.isFinite() || qty.lte(0))
      throw new Error("Quantity must be positive");
    const costs = [
      line.materialCost,
      line.laborCost,
      line.subcontractorCost,
      line.otherDirectCost,
      line.overheadAllocation,
    ].map((v) => new D(v));
    if (costs.some((v) => !v.isFinite() || v.isNegative()))
      throw new Error("Invalid direct cost");
    const unitCost = costs.slice(0, 4).reduce((a, b) => a.plus(b), new D(0));
    const totalCost = finite(cents(unitCost.mul(qty)));
    const allocatedOverhead = finite(cents(costs[4].mul(qty)));
    const calculatedUnitPrice = targetPrice(
      unitCost.toFixed(2),
      line.targetMargin,
    );
    const unitPrice = new D(line.overrideUnitPrice || calculatedUnitPrice);
    if (!unitPrice.isFinite() || unitPrice.lt(0))
      throw new Error("Invalid selling price");
    const sellingPrice = finite(cents(unitPrice.mul(qty)));
    const calculatedPrice = finite(cents(new D(calculatedUnitPrice).mul(qty)));
    const manualOverride = !unitPrice.eq(calculatedUnitPrice);
    if (manualOverride && !line.overrideReason.trim())
      throw new Error("An override requires an audit reason");
    const minimum = new D(line.minimumMargin);
    if (!minimum.isFinite() || minimum.lt(0) || minimum.gte(1))
      throw new Error("Invalid minimum margin");
    return {
      ...line,
      unitCost: unitCost.toFixed(2),
      totalCost: totalCost.toFixed(2),
      allocatedOverhead: allocatedOverhead.toFixed(2),
      calculatedUnitPrice,
      unitPrice: unitPrice.toFixed(2),
      calculatedPrice: calculatedPrice.toFixed(2),
      sellingPrice: sellingPrice.toFixed(2),
      manualOverride,
    };
  });
  const sum = (key: "sellingPrice" | "totalCost" | "allocatedOverhead") =>
    calculated.reduce((a, l) => a.plus(l[key]), new D(0));
  const subtotal = sum("sellingPrice");
  const discountAmount = cents(subtotal.mul(discount));
  const shares = calculated.map((line, index) => {
    const exact = subtotal.isZero()
      ? new D(0)
      : new D(line.sellingPrice).div(subtotal).mul(discountAmount);
    const amount = exact.toDecimalPlaces(2, Decimal.ROUND_FLOOR);
    return { index, amount, remainder: exact.minus(amount) };
  });
  let residual = discountAmount
    .minus(shares.reduce((a, s) => a.plus(s.amount), new D(0)))
    .mul(100)
    .toNumber();
  const priority = [...shares].sort(
    (a, b) => b.remainder.cmp(a.remainder) || a.index - b.index,
  );
  for (const share of priority) {
    if (residual-- <= 0) break;
    share.amount = share.amount.plus("0.01");
  }
  let taxableBase = new D(0);
  let belowMinimum = false;
  calculated.forEach((line, i) => {
    const net = new D(line.sellingPrice).minus(shares[i].amount);
    if (line.taxable) taxableBase = taxableBase.plus(net);
    if (
      net.lte(0)
        ? new D(line.totalCost).gt(0)
        : net.minus(line.totalCost).div(net).lt(line.minimumMargin)
    )
      belowMinimum = true;
  });
  const sellingPrice = finite(subtotal.minus(discountAmount));
  const directCost = finite(sum("totalCost"));
  const overhead = finite(sum("allocatedOverhead"));
  const taxAmount =
    taxTreatment === "TAXABLE" ? cents(taxableBase.mul(tax)) : new D(0);
  const grossProfit = sellingPrice.minus(directCost);
  const reasons = [
    "FINAL_RELEASE",
    ...(belowMinimum ? ["BELOW_MINIMUM_MARGIN"] : []),
    ...(discount.gt(discountThreshold) ? ["SIGNIFICANT_DISCOUNT"] : []),
    ...(calculated.some((l) => l.manualOverride)
      ? ["MANUAL_PRICE_OVERRIDE"]
      : []),
    ...(calculated.some((l) => !l.serviceItemId) ? ["CUSTOM_ITEMS"] : []),
  ];
  return {
    lines: calculated,
    subtotal: subtotal.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    sellingPrice: sellingPrice.toFixed(2),
    directCost: directCost.toFixed(2),
    allocatedOverhead: overhead.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    totalInvestment: finite(sellingPrice.plus(taxAmount)).toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    grossMargin: marginRatio(directCost.toFixed(2), sellingPrice.toFixed(2)),
    contributionProfit: grossProfit.minus(overhead).toFixed(2),
    reasons,
  };
}

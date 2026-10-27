export type PackPricing = {
  original_price: number;
  final_price: number;
  discount_percent: number;
  has_discount: boolean;
};

export function calcPackPricing(
  listPrice: number,
  discountPercent: number | null | undefined = 0,
): PackPricing {
  const original_price = Math.max(0, Math.round(Number(listPrice) || 0));
  const discount_percent = Math.min(100, Math.max(0, Math.round(Number(discountPercent) || 0)));

  if (discount_percent <= 0 || original_price <= 0) {
    return {
      original_price,
      final_price: original_price,
      discount_percent: 0,
      has_discount: false,
    };
  }

  const final_price = Math.max(1, Math.round(original_price * (100 - discount_percent) / 100));

  return {
    original_price,
    final_price,
    discount_percent,
    has_discount: final_price < original_price,
  };
}

export function enrichPackWithPricing<T extends { price: number; discount_percent?: number | null }>(
  pack: T,
): T & PackPricing {
  const pricing = calcPackPricing(pack.price, pack.discount_percent);
  return {
    ...pack,
    ...pricing,
  };
}

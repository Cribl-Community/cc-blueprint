const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** `0`, `950`, `1.2K`, `3.4M` */
export const compact = (n: number) => compactFormat.format(n);

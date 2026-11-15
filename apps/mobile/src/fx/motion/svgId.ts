/* A per-instance id for SVG gradients, masks and clip paths. On the web every inline SVG shares one document, so two
   components defining the same id would draw each other's definitions; React's useId is unique but carries characters
   that url(#…) references do not accept, so they are replaced. */
import { useId } from 'react';

export function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
}

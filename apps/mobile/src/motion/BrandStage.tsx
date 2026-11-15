/* The space a 3D brand mark and its motes share. The mark writes how far it is turned (degrees about each axis) and
   counts the touches it gets; the motes read the turn to shift with depth (near motes one way, far ones the other: a
   parallax that makes the mark sit inside the field) and wake their drift on a touch. Wrap the mark and the motes that
   belong to it in one <BrandStage>; either works on its own without one. */
import React, { createContext, useContext } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

export type BrandStageValue = {
  /** The mark's turn about its horizontal axis, in degrees (0 when flat). */
  rx: SharedValue<number>;
  /** The mark's turn about its vertical axis, in degrees (0 when flat). */
  ry: SharedValue<number>;
  /** Goes up by one each time the mark is touched. */
  touches: SharedValue<number>;
};

const StageContext = createContext<BrandStageValue | null>(null);

export function BrandStage({ children }: { children: React.ReactNode }) {
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const touches = useSharedValue(0);
  return <StageContext.Provider value={{ rx, ry, touches }}>{children}</StageContext.Provider>;
}

export function useBrandStage(): BrandStageValue | null {
  return useContext(StageContext);
}

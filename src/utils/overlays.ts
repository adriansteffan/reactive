/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentType } from 'react';
import { Store } from './common';

export interface OverlayProps {
  store: Store;
  updateStore: (mergeIn: Store) => void;
  data: any[];
}

const registry: ComponentType<OverlayProps>[] = [];

export function registerOverlay(component: ComponentType<OverlayProps>) {
  if (!registry.includes(component)) registry.push(component);
}

export function getOverlays() {
  return [...registry];
}

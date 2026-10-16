/**
 * The shape of the experiment's store. Projects declare it by extending this interface:
 * `declare module '@adriansteffan/reactive' { interface ExperimentStore { bonus: number } }`
 */
// biome-ignore lint/suspicious/noEmptyInterface: projects extend it through module augmentation
export interface ExperimentStore {}

// Keys the library itself keeps in the store
interface LibraryStore {
  __uploadId?: string;
  __audioInputId?: string;
  __screenRefreshRate?: number | null;
  __fullscreenGuard?: unknown;
}

type StoreDeclared = keyof ExperimentStore extends never ? false : true;

/** The store as timeline callbacks and components see it: typed once the project declares `ExperimentStore`. */
export type Store = StoreDeclared extends true
  ? Partial<ExperimentStore> & LibraryStore
  : Record<string, any>;

export type StoreUpdate = StoreDeclared extends true ? Partial<ExperimentStore> : Record<string, any>;

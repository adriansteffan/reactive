export type Store = Record<string, any>;

type BaseTrialData = {
    index: number;
    trialNumber: number;
    start: number;
    end: number;
    duration: number;
};

export type ComponentResultData = BaseTrialData & {
    type: string;
    name: string;
    responseData?: any;
};

export type CanvasResultData = BaseTrialData & {
    metadata?: Record<string, any>;
    key: string | null;
    reactionTime: number | null;
};

export type RefinedTrialData = ComponentResultData | CanvasResultData;

export interface MarkerItem { type: 'MARKER'; id: string; }

export type ConditionalFunction = (data?: RefinedTrialData[], store?: Store) => boolean;

export type StoreUpdateFunction = (data?: RefinedTrialData[], store?: Store) => Record<string, any>;

export interface IfGotoItem { type: 'IF_GOTO'; cond: ConditionalFunction; marker: string; }
export interface UpdateStoreItem { type: 'UPDATE_STORE'; fun: StoreUpdateFunction; }
export interface IfBlockItem { type: 'IF_BLOCK'; cond: ConditionalFunction; timeline: TimelineItem[]; }
export interface WhileBlockItem { type: 'WHILE_BLOCK'; cond: ConditionalFunction; timeline: TimelineItem[]; }
export type ControlFlowItem = MarkerItem | IfGotoItem | UpdateStoreItem | IfBlockItem | WhileBlockItem;
export type TimelineItem = ControlFlowItem | any;

export interface ExecuteContentInstruction { type: 'ExecuteContent'; content: any; }
export interface IfGotoInstruction {
    type: 'IfGoto';
    cond: (store: Store, data: RefinedTrialData[]) => boolean;
    marker: string;
}
export interface UpdateStoreInstruction {
    type: 'UpdateStore';
    fun: (store: Store, data: RefinedTrialData[]) => Store;
}
export type UnifiedBytecodeInstruction = ExecuteContentInstruction | IfGotoInstruction | UpdateStoreInstruction;

function prefixUserMarkers(marker: string): string {
    return `user_${marker}`;
}

export function compileTimeline(
    timeline: TimelineItem[]
): {
    instructions: UnifiedBytecodeInstruction[];
    markers: { [key: string]: number };
} {
    const instructions: UnifiedBytecodeInstruction[] = [];
    const markers: { [key: string]: number } = {};
    let uniqueMarkerCounterForThisRun = 0;

    function getUniqueMarker(prefix: string): string {
        return `${prefix}_auto_${uniqueMarkerCounterForThisRun++}`;
    }

    function adaptCondition(
        userCondition: ConditionalFunction
    ): (store: Store, data: RefinedTrialData[]) => boolean {
        return (runtimeStore: Store, runtimeData: RefinedTrialData[]): boolean => {
            return userCondition(runtimeData, runtimeStore);
        };
    }

    function adaptUpdate(
        userUpdateFunction: StoreUpdateFunction
    ): (store: Store, data: RefinedTrialData[]) => Store {
        return (runtimeStore: Store, runtimeData: RefinedTrialData[]): Store => {
            const updates = userUpdateFunction(runtimeData, runtimeStore);
            if (typeof updates === 'object' && updates !== null) {
                return {
                    ...runtimeStore,
                    ...updates,
                };
            } else {
                console.warn("Store update function did not return an object. Store remains unchanged.", { data: runtimeData, store: runtimeStore });
                return runtimeStore;
            }
        };
    }

    function processTimeline(items: TimelineItem[]) {
        for (const item of items) {
            let isControlFlow = false;

            if (typeof item === 'object' && item !== null && 'type' in item) {
                const itemType = item.type;

                switch (itemType) {
                    case 'MARKER': {
                        const markerItem = item as MarkerItem;
                        markers[prefixUserMarkers(markerItem.id)] = instructions.length;
                        isControlFlow = true;
                        break;
                    }
                    case 'IF_GOTO': {
                        const ifGotoItem = item as IfGotoItem;
                        const runtimeConditionFunc = adaptCondition(ifGotoItem.cond);
                        instructions.push({
                            type: 'IfGoto',
                            cond: runtimeConditionFunc,
                            marker: prefixUserMarkers(ifGotoItem.marker),
                        });
                        isControlFlow = true;
                        break;
                    }
                    case 'UPDATE_STORE': {
                        const updateStoreItem = item as UpdateStoreItem;
                        const runtimeUpdateFunc = adaptUpdate(updateStoreItem.fun);
                        instructions.push({
                            type: 'UpdateStore',
                            fun: runtimeUpdateFunc,
                        });
                        isControlFlow = true;
                        break;
                    }
                    case 'IF_BLOCK': {
                        const ifBlockItem = item as IfBlockItem;
                        const endMarker = getUniqueMarker('if_end');
                        const runtimeConditionFunc = adaptCondition(ifBlockItem.cond);
                        instructions.push({
                            type: 'IfGoto',
                            cond: (store, data) => !runtimeConditionFunc(store, data),
                            marker: endMarker,
                        });
                        processTimeline(ifBlockItem.timeline);
                        markers[endMarker] = instructions.length;
                        isControlFlow = true;
                        break;
                    }
                    case 'WHILE_BLOCK': {
                        const whileBlockItem = item as WhileBlockItem;
                        const startMarker = getUniqueMarker('while_start');
                        const endMarker = getUniqueMarker('while_end');
                        const runtimeConditionFunc = adaptCondition(whileBlockItem.cond);
                        markers[startMarker] = instructions.length;
                        instructions.push({
                            type: 'IfGoto',
                            cond: (store, data) => !runtimeConditionFunc(store, data),
                            marker: endMarker,
                        });
                        processTimeline(whileBlockItem.timeline);
                        instructions.push({
                            type: 'IfGoto',
                            cond: () => true,
                            marker: startMarker,
                        });
                        markers[endMarker] = instructions.length;
                        isControlFlow = true;
                        break;
                    }
                }
            }

            if (!isControlFlow) {
                instructions.push({
                    type: 'ExecuteContent',
                    content: item,
                });
            }
        }
    }

    processTimeline(timeline);

    return { instructions, markers };
}
import { freezeInDevelopment } from './development';
import type { Store } from './store';
import type { TimelineContext } from './timeline';

export const BLOCK: unique symbol = Symbol('reactive.block');

type Condition = (context: TimelineContext) => boolean;

/** A block of control flow. */
export type BlockSpec =
  | { kind: 'if'; cond: Condition; items: readonly unknown[]; else?: readonly unknown[] }
  | { kind: 'while'; cond: Condition; body: readonly unknown[] }
  | { kind: 'updateStore'; update: (context: TimelineContext) => Record<string, any> }
  | { kind: 'marker'; id: string }
  | { kind: 'ifGoto'; cond: Condition; marker: string }
  | { kind: 'fullscreen'; items: readonly unknown[] };

export function isBlock(item: unknown): item is { [BLOCK]: BlockSpec } {
  return typeof item === 'object' && item !== null && BLOCK in item;
}

// IfGoto jumps when its condition holds, UnlessGoto when it does not
type Instruction<Content> =
  | { type: 'ExecuteContent'; content: Content }
  | { type: 'Goto'; marker: string }
  | { type: 'IfGoto'; cond: Condition; marker: string }
  | { type: 'UnlessGoto'; cond: Condition; marker: string }
  | { type: 'UpdateStore'; update: (context: TimelineContext) => Record<string, any> };

/** A compiled timeline: instructions over content of type `Content`. */
export interface Bytecode<Content> {
  instructions: Instruction<Content>[];
  markers: Record<string, number>;
  /** The spans of instructions that run in fullscreen, each from its first to just after its last. */
  fullscreen: [number, number][];
}

// The if-branches an item sits in, from the outside in
export type BranchPath = readonly { block: number; arm: 'then' | 'else' }[];

/**
 * Lowers a timeline to bytecode. Nested lists are flattened and `false`, `null` and `undefined`
 * are skipped; everything that is not a block becomes content through `toContent`.
 */
export function compileTimeline<Content>(
  timeline: readonly unknown[],
  toContent: (item: unknown, branch: BranchPath) => Content,
): Bytecode<Content> {
  const instructions: Instruction<Content>[] = [];
  const markers: Record<string, number> = {};
  const fullscreen: [number, number][] = [];
  const gotoTargets: string[] = [];
  let blockCount = 0;

  function emit(items: readonly unknown[], branch: BranchPath) {
    for (const item of items) {
      if (item === false || item === null || item === undefined) continue;
      if (Array.isArray(item)) {
        emit(item, branch);
        continue;
      }
      if (!isBlock(item)) {
        instructions.push({ type: 'ExecuteContent', content: toContent(item, branch) });
        continue;
      }

      const block = item[BLOCK];
      const id = blockCount++;
      switch (block.kind) {
        case 'marker':
          if (`user_${block.id}` in markers) {
            throw new Error(`The marker '${block.id}' is in the timeline twice, so ifGoto could not tell which one to jump to.`);
          }
          markers[`user_${block.id}`] = instructions.length;
          break;
        case 'ifGoto':
          instructions.push({ type: 'IfGoto', cond: block.cond, marker: `user_${block.marker}` });
          gotoTargets.push(block.marker);
          break;
        case 'updateStore':
          instructions.push({ type: 'UpdateStore', update: block.update });
          break;
        case 'if': {
          const end = `if_end_${id}`;
          const elseStart = `if_else_${id}`;
          instructions.push({ type: 'UnlessGoto', cond: block.cond, marker: block.else ? elseStart : end });
          emit(block.items, [...branch, { block: id, arm: 'then' }]);
          if (block.else) {
            instructions.push({ type: 'Goto', marker: end });
            markers[elseStart] = instructions.length;
            emit(block.else, [...branch, { block: id, arm: 'else' }]);
          }
          markers[end] = instructions.length;
          break;
        }
        case 'fullscreen': {
          const start = instructions.length;
          emit(block.items, branch);
          fullscreen.push([start, instructions.length]);
          break;
        }
        case 'while': {
          const start = `while_start_${id}`;
          const end = `while_end_${id}`;
          markers[start] = instructions.length;
          instructions.push({ type: 'UnlessGoto', cond: block.cond, marker: end });
          emit(block.body, branch);
          instructions.push({ type: 'Goto', marker: start });
          markers[end] = instructions.length;
          break;
        }
      }
    }
  }

  emit(timeline, []);

  for (const target of gotoTargets) {
    if (!(`user_${target}` in markers)) {
      throw new Error(`ifGoto jumps to the marker '${target}', which is not in the timeline.`);
    }
  }

  return { instructions, markers, fullscreen };
}

// No timeline runs this many steps of control flow between two trials or slides unless it loops forever
const MAX_CONTROL_STEPS = 100_000;

// What a jump back to the marker repeats, as the timeline was written
const repeated = (marker: string) =>
  marker.startsWith('user_') ? `the ifGoto back to the marker '${marker.slice('user_'.length)}'` : 'a whileBlock';

/**
 * Runs control flow from `fromPointer` on. Returns the pointer of the next content instruction,
 * or the length of the bytecode once the timeline is finished, and the store as the store
 * updates on the way left it.
 */
export function advanceToNextContent<Content>(
  bytecode: Bytecode<Content>,
  fromPointer: number,
  fromStore: Store,
  contextFor: (store: Store) => TimelineContext,
): { pointer: number; store: Store } {
  let pointer = fromPointer;
  let store = fromStore;
  let steps = 0;
  let loop = '';
  while (pointer < bytecode.instructions.length) {
    const instruction = bytecode.instructions[pointer];
    if (instruction.type === 'ExecuteContent') break;
    // It always throws, since a timeline that never reaches its next trial cannot go on
    if (++steps > MAX_CONTROL_STEPS) {
      throw new Error(
        `The timeline repeats ${loop} without reaching anything to show, so it would never end. Its condition has to change, or a trial or slide has to run inside it.`,
      );
    }
    const from = pointer;

    if (instruction.type === 'Goto') {
      pointer = bytecode.markers[instruction.marker];
    } else if (instruction.type === 'IfGoto') {
      pointer = instruction.cond(contextFor(store)) ? bytecode.markers[instruction.marker] : pointer + 1;
    } else if (instruction.type === 'UnlessGoto') {
      pointer = instruction.cond(contextFor(store)) ? pointer + 1 : bytecode.markers[instruction.marker];
    } else {
      const updates = instruction.update(contextFor(store));
      if (typeof updates === 'object' && updates !== null) {
        store = freezeInDevelopment({ ...store, ...updates });
      } else {
        console.warn('A store update did not return an object, so the store is unchanged.');
      }
      pointer++;
    }
    if (pointer <= from && 'marker' in instruction) loop = repeated(instruction.marker);
  }
  return { pointer, store };
}

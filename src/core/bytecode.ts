export const BLOCK: unique symbol = Symbol('reactive.block');

type Condition<C> = (context: C) => boolean;

/** A block of control flow, with conditions that read a context of type `C`. */
export type BlockSpec<C> =
  | { kind: 'if'; cond: Condition<C>; items: readonly unknown[]; else?: readonly unknown[] }
  | { kind: 'while'; cond: Condition<C>; body: readonly unknown[] }
  | { kind: 'updateStore'; update: (context: C) => Record<string, any> }
  | { kind: 'marker'; id: string }
  | { kind: 'ifGoto'; cond: Condition<C>; marker: string };

export function isBlock(item: unknown): item is { [BLOCK]: BlockSpec<any> } {
  return typeof item === 'object' && item !== null && BLOCK in item;
}

export interface ExecuteContentInstruction<Content> {
  type: 'ExecuteContent';
  content: Content;
}
export interface IfGotoInstruction<C> {
  type: 'IfGoto';
  cond: Condition<C>;
  marker: string;
}
export interface UpdateStoreInstruction<C> {
  type: 'UpdateStore';
  update: (context: C) => Record<string, any>;
}
export type Instruction<Content, C> =
  | ExecuteContentInstruction<Content>
  | IfGotoInstruction<C>
  | UpdateStoreInstruction<C>;

/** A compiled timeline: instructions over content of type `Content`, whose conditions read a context of type `C`. */
export interface Bytecode<Content, C> {
  instructions: Instruction<Content, C>[];
  markers: Record<string, number>;
}

// The if-branches an item sits in, from the outside in, e.g. ['if0:then', 'if2:else']
export type BranchPath = readonly string[];

/**
 * Lowers a timeline to bytecode. Nested lists are flattened and `false`, `null` and `undefined`
 * are skipped; everything that is not a block becomes content through `toContent`.
 */
export function compileTimeline<Content, C>(
  timeline: readonly unknown[],
  toContent: (item: unknown, branch: BranchPath) => Content,
): Bytecode<Content, C> {
  const instructions: Instruction<Content, C>[] = [];
  const markers: Record<string, number> = {};
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

      const block: BlockSpec<C> = item[BLOCK];
      const id = blockCount++;
      switch (block.kind) {
        case 'marker':
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
          instructions.push({
            type: 'IfGoto',
            cond: (context) => !block.cond(context),
            marker: block.else ? elseStart : end,
          });
          emit(block.items, [...branch, `if${id}:then`]);
          if (block.else) {
            instructions.push({ type: 'IfGoto', cond: () => true, marker: end });
            markers[elseStart] = instructions.length;
            emit(block.else, [...branch, `if${id}:else`]);
          }
          markers[end] = instructions.length;
          break;
        }
        case 'while': {
          const start = `while_start_${id}`;
          const end = `while_end_${id}`;
          markers[start] = instructions.length;
          instructions.push({ type: 'IfGoto', cond: (context) => !block.cond(context), marker: end });
          emit(block.body, branch);
          instructions.push({ type: 'IfGoto', cond: () => true, marker: start });
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

  return { instructions, markers };
}

/**
 * Runs control flow from `fromPointer` on and returns the pointer of the next content
 * instruction, or the length of the bytecode once the timeline is finished.
 */
export function advanceToNextContent<Content, C>(
  bytecode: Bytecode<Content, C>,
  fromPointer: number,
  getContext: () => C,
  applyStoreUpdates: (updates: Record<string, any>) => void,
): number {
  let pointer = fromPointer;
  while (pointer < bytecode.instructions.length) {
    const instruction = bytecode.instructions[pointer];
    if (instruction.type === 'ExecuteContent') return pointer;

    if (instruction.type === 'IfGoto') {
      pointer = instruction.cond(getContext()) ? bytecode.markers[instruction.marker] : pointer + 1;
    } else {
      const updates = instruction.update(getContext());
      if (typeof updates === 'object' && updates !== null) {
        applyStoreUpdates(updates);
      } else {
        console.warn('A store update did not return an object, so the store is unchanged.');
      }
      pointer++;
    }
  }
  return pointer;
}

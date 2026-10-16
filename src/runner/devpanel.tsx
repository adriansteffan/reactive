import React, { useState } from 'react';
import type { TrialData } from '../core/rows';
import type { Store } from '../core/store';
import type { TrialContent } from '../core/timeline';

// React elements in props refer back to React's internals, which JSON cannot hold
const showJson = (value: unknown) =>
  JSON.stringify(value, (_key, v) => (React.isValidElement(v) ? '<element>' : v), 2);

// Props and metadata given as functions of the timeline context are only known once the trial runs
const showSetting = (value: unknown) => showJson(typeof value === 'function' ? '(dynamic)' : value);

/** The ?dev=true panel: the trial on screen, the store, and every row recorded so far. */
export function DevPanel({
  content,
  store,
  data,
}: {
  content: TrialContent | null;
  store: Store;
  data: TrialData[];
}) {
  const [open, setOpen] = useState(false);
  const [showData, setShowData] = useState(false);

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='fixed top-2 right-2 z-50 px-3 py-1 bg-white text-black text-xs font-bold border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none cursor-pointer'
      >
        {open ? '✕' : 'DEV'}
      </button>
      {open && content && (
        <div className='fixed top-10 right-2 z-50 w-96 max-h-[80vh] overflow-auto bg-white text-black text-xs font-mono border-2 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] p-3'>
          <div className='font-bold mb-2 text-sm'>
            {content.type} {content.name ? `(${content.name})` : ''}
          </div>
          <div className='mb-2'>
            <span className='font-bold'>Props:</span>
            <pre className='mt-1 whitespace-pre-wrap break-all'>{showSetting(content.props)}</pre>
          </div>
          {content.metadata && (
            <div className='mb-2'>
              <span className='font-bold'>Metadata:</span>
              <pre className='mt-1 whitespace-pre-wrap break-all'>{showSetting(content.metadata)}</pre>
            </div>
          )}
          <div className='mb-2'>
            <span className='font-bold'>Store:</span>
            <pre className='mt-1 whitespace-pre-wrap break-all'>{showJson(store)}</pre>
          </div>
          <button type='button' className='font-bold cursor-pointer' onClick={() => setShowData(!showData)}>
            Data ({data.length}) {showData ? '▾' : '▸'}
          </button>
          {showData && <pre className='mt-1 whitespace-pre-wrap break-all'>{showJson(data)}</pre>}
        </div>
      )}
    </>
  );
}

// Developer Panel → Business migration: how one collection's row reads.
// Before the switch the copy should match the old collection. After it
// (live) the old collection is frozen and the business keeps receiving new
// docs, so more on the business is expected and fewer is a real warning.
export function migrationRowState({ source, target }, live){
  const counts = `Current: ${source} · Copied: ${target}`;
  if(!live){
    return target === source
      ? { state: 'ok', pill: 'OK', detail: counts }
      : { state: 'pending', pill: 'Pending', detail: counts };
  }
  if(target >= source){
    return { state: 'ok', pill: 'OK', detail: counts, note: 'Live on business data (old collection frozen)' };
  }
  const missing = source - target;
  return {
    state: 'warning',
    pill: 'Fewer on business',
    detail: counts,
    note: `The business has ${missing} fewer doc${missing === 1 ? '' : 's'} than the old collection`
  };
}

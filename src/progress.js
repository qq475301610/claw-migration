export function emitProgress(target, step, detail = '') {
  const reporter = typeof target === 'function' ? target : target?.onProgress;
  if (typeof reporter !== 'function') {
    return;
  }
  reporter({ step, detail, at: new Date().toISOString() });
}

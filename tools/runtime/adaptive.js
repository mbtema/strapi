  function tune(wave, failures, transient) {
    const A = CFG.adaptive;
    if (transient) {
      state.concurrency = Math.max(A.min, Math.floor(state.concurrency / 2));
      Object.assign(state, {
        stageDone: 0, stageMs: 0, locked: false, underperforming: 0,
        bestSpeed: 0, bestConcurrency: state.concurrency
      });
      return 'backoff';
    }
    if (failures) {
      state.stageDone = 0;
      state.stageMs = 0;
      return 'hold-error';
    }
    if (!wave.full) return 'hold';
    if (state.locked) {
      state.stableDone = (state.stableDone || 0) + wave.completed;
      if (state.stableDone < 500) return 'hold';
      state.stableDone = 0;
      state.locked = false;
      state.concurrency = Math.max(A.min, state.bestConcurrency - A.step);
      state.bestSpeed = 0;
      state.stageDone = 0;
      state.stageMs = 0;
      state.underperforming = 0;
      return 'rebenchmark';
    }
    state.stageDone += wave.completed;
    state.stageMs += wave.ms;
    if (state.stageDone < A.sampleSize) return 'sampling';

    const speed = state.stageDone / Math.max(0.001, state.stageMs / 1000);
    let action;
    if (!state.bestSpeed || speed >= state.bestSpeed * (1 + A.minGain)) {
      state.bestSpeed = speed;
      state.bestConcurrency = state.concurrency;
      state.underperforming = 0;
      action = 'new-best';
    } else {
      state.underperforming++;
      action = 'probe-next';
    }
    if (state.underperforming >= A.lockAfter || state.concurrency >= A.max) {
      state.concurrency = state.bestConcurrency;
      state.locked = true;
      action = 'lock-best';
    } else {
      state.concurrency = Math.min(A.max, state.concurrency + A.step);
    }
    state.stageDone = 0;
    state.stageMs = 0;
    return action;
  }

  async function adaptiveRun(items, handler) {
    const results = new Array(items.length);
    let cursor = 0;
    while (cursor < items.length && !state.stopped) {
      const concurrency = state.concurrency;
      const batch = items.slice(cursor, cursor + concurrency);
      const started = performance.now();
      const outcomes = await Promise.all(batch.map(async (item, index) => {
        try { return { ok: true, value: await handler(item), index }; }
        catch (error) { return { ok: false, error, index }; }
      }));
      const ms = Math.max(1, performance.now() - started);
      const speed = batch.length / (ms / 1000);
      let failures = 0, transient = 0;
      for (const outcome of outcomes) {
        const position = cursor + outcome.index;
        if (outcome.ok) results[position] = outcome.value;
        else {
          failures++;
          state.errors++;
          if (outcome.error.transient || outcome.error instanceof TypeError) transient++;
          results[position] = null;
        }
      }
      state.done += batch.length;
      state.lastSpeed = speed;
      state.waves++;
      const action = tune({
        completed: batch.length - failures,
        ms, full: batch.length === concurrency
      }, failures, transient);
      state.benchmark.push({
        phase: state.phase, wave: state.waves, concurrency,
        count: batch.length, ms: Math.round(ms),
        speed: +speed.toFixed(2), failures, action,
        nextConcurrency: state.concurrency
      });
      cursor += batch.length;
      render();
      if (action !== 'sampling' && action !== 'hold') {
        console.log(PREFIX, state.phase, `${state.done}/${state.total}`,
          `C=${concurrency}→${state.concurrency}`, `${speed.toFixed(1)}/сек`, action);
      }
      if (failures) {
        const error = outcomes.find(item => !item.ok)?.error;
        console.error(PREFIX, `Ошибок в волне: ${failures}`, error);
        if (state.phase.startsWith('Загрузка Product')) throw error;
      }
      if (transient) await sleep(1000);
    }
    if (state.stopped) throw new Error('STOPPED');
    return results;
  }


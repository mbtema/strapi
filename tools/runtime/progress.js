  const panel = document.createElement('div');
  panel.id = 'tm-attributes-audit';
  Object.assign(panel.style, {
    position: 'fixed', right: '24px', bottom: '24px', width: '370px',
    padding: '18px', background: '#171923', color: '#fff',
    border: '1px solid #4945ff', borderRadius: '12px',
    boxShadow: '0 8px 35px #0008', font: '13px system-ui, sans-serif',
    zIndex: '2147483647'
  });
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <b>Product attributes · RU → KK</b>
      <button data-stop style="background:#4945ff;color:white;border:0;padding:6px 10px;border-radius:5px;cursor:pointer">Стоп</button>
    </div>
    <div data-phase style="margin-top:14px">Подготовка</div>
    <div style="margin-top:9px;height:10px;background:#363846;border-radius:8px;overflow:hidden">
      <div data-bar style="width:0%;height:100%;background:#7b79ff;transition:width .2s"></div>
    </div>
    <div data-progress style="margin-top:8px">0 / 0</div>
    <div data-speed style="margin-top:8px;color:#b8bacb">—</div>
    <div data-tune style="margin-top:5px;color:#b8bacb">—</div>
    <div data-eta style="margin-top:5px;color:#b8bacb">—</div>
  `;
  document.body.appendChild(panel);
  const el = selector => panel.querySelector(selector);
  el('[data-stop]').onclick = () => {
    state.stopped = true;
    el('[data-stop]').disabled = true;
    el('[data-stop]').textContent = 'Остановка...';
  };

  function render() {
    const percent = state.total ? Math.min(100, 100 * state.done / state.total) : 0;
    const elapsed = (performance.now() - state.phaseStarted) / 1000;
    const speed = elapsed > 0 ? state.done / elapsed : 0;
    el('[data-phase]').textContent = state.phase;
    el('[data-bar]').style.width = percent.toFixed(1) + '%';
    el('[data-progress]').textContent = `${state.done.toLocaleString()} / ${state.total.toLocaleString()} (${percent.toFixed(1)}%)`;
    el('[data-speed]').textContent = `Скорость: ${speed.toFixed(1)} операций/сек`;
    el('[data-tune]').textContent = `Concurrency: ${state.concurrency} · best: ${state.bestConcurrency} (${state.bestSpeed.toFixed(1)}/сек)` +
      (state.locked ? ' · оптимизировано' : ' · подбор');
    el('[data-eta]').textContent = `ETA: ${formatSeconds(speed ? (state.total - state.done) / speed : Infinity)} · время: ${formatSeconds((performance.now() - state.started) / 1000)} · ошибок: ${state.errors}`;
  }

  function beginPhase(phase, total) {
    Object.assign(state, {
      phase, total, done: 0, lastSpeed: 0, phaseStarted: performance.now(),
      concurrency: CFG.adaptive.start, bestConcurrency: CFG.adaptive.start,
      bestSpeed: 0, stageDone: 0, stageMs: 0, underperforming: 0, locked: false
    });
    render();
  }


import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Check } from 'lucide-react';
import { useStore } from './store';
import {
  preset, validate, generate, nodeId, fixedDofs, parseConfig,
  avoidedElementIds, resizeMesh,
  type Load, type Support, type AvoidRegion,
} from './model';
import { copyObject, pasteObject, serializeCopiedObject, parseCopiedObject } from './clipboard';
import './style.css';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const editingText = (target: EventTarget | null) => target instanceof Element &&
  !!target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');

type Point = { x: number; y: number; rawX: number; rawY: number };
type Drag = {
  id: string;
  kind: 'load' | 'force' | 'support' | 'support-resize' | 'region' | 'region-resize';
  start: Point;
  support?: Support;
  region?: AvoidRegion;
};
type CodeTab = 'full' | 'section' | 'domain' | 'command';

function App() {
  const { config: c, set, replace } = useStore();
  const [selected, select] = useState('L1');
  const [regionId, selectRegion] = useState('');
  const [tab, setTab] = useState<CodeTab>('full');
  const [notice, msg] = useState('');
  const [grid, showGrid] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pastes = useRef({ text: '', count: 0 });
  const errors = validate(c);
  const code = errors.length ? null : generate(c);
  const load = c.loads.find(item => item.id === selected);
  const support = c.supports.find(item => item.id === selected);
  const region = c.avoidedRegions.find(item => item.id === selected) ??
    c.avoidedRegions.find(item => item.id === regionId) ?? c.avoidedRegions[0];
  const avoidedCount = avoidedElementIds(c).length;
  const availableCount = c.nelx * c.nely - avoidedCount;
  const W = 720, H = 360, ox = 72, oy = 65;
  const scale = Math.min(576 / c.nelx, 230 / c.nely);
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + y * scale;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => msg(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function onCopy(event: ClipboardEvent) {
      if (editingText(event.target) || window.getSelection()?.toString()) return;
      const object = copyObject(useStore.getState().config, selected);
      if (!object || !event.clipboardData) return;
      const text = serializeCopiedObject(object);
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('application/x-top88-object', text);
      event.preventDefault();
      pastes.current = { text, count: 0 };
      msg(`${object.kind === 'load' ? 'Load' : 'Support'} copied. Paste to duplicate.`);
    }
    function onPaste(event: ClipboardEvent) {
      if (editingText(event.target) || !event.clipboardData) return;
      const text = event.clipboardData.getData('application/x-top88-object') ||
        event.clipboardData.getData('text/plain');
      const object = parseCopiedObject(text);
      if (!object) return;
      event.preventDefault();
      if (pastes.current.text !== text) pastes.current = { text, count: 0 };
      const result = pasteObject(useStore.getState().config, object, pastes.current.count + 1);
      if (!result) {
        msg('Cannot paste: the object must fit the mesh and stay within the 100-object limit.');
        return;
      }
      pastes.current.count += 1;
      set(result.patch);
      select(result.selected);
      msg(`${object.kind === 'load' ? 'Load' : 'Support'} pasted as ${result.selected}.`);
    }
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [c, selected, set]);

  function newId(prefix: string) {
    const ids = new Set([...c.loads, ...c.supports, ...c.avoidedRegions].map(item => item.id));
    let number = 1;
    while (ids.has(`${prefix}${number}`)) number += 1;
    return `${prefix}${number}`;
  }

  function updateLoad(patch: Partial<Load>) {
    set({ loads: c.loads.map(item => item.id === selected ? { ...item, ...patch } : item) });
  }

  function updateSupport(patch: Partial<Support>) {
    set({ supports: c.supports.map(item => item.id === selected ? { ...item, ...patch } : item) });
  }

  function updateRegion(patch: Partial<AvoidRegion>) {
    if (!region) return;
    set({ avoidedRegions: c.avoidedRegions.map(item => item.id === region.id ? { ...item, ...patch } : item) });
    select(region.id);
    selectRegion(region.id);
  }

  function addRegion() {
    const width = Math.max(1, Math.round(c.nelx / 5));
    const height = Math.max(1, Math.round(c.nely / 4));
    const id = newId('R');
    set({ avoidedRegions: [...c.avoidedRegions, {
      id, x: Math.floor((c.nelx - width) / 2), y: Math.floor((c.nely - height) / 2), width, height,
    }] });
    select(id);
    selectRegion(id);
  }

  function removeObject(id = selected) {
    const loads = c.loads.filter(item => item.id !== id);
    const supports = c.supports.filter(item => item.id !== id);
    const avoidedRegions = c.avoidedRegions.filter(item => item.id !== id);
    set({ loads, supports, avoidedRegions });
    if (selected === id) select(loads[0]?.id ?? supports[0]?.id ?? avoidedRegions[0]?.id ?? '');
    if (regionId === id) selectRegion(avoidedRegions[0]?.id ?? '');
  }

  function position(event: React.PointerEvent): Point {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return {
      x: clamp(Math.round((transformed.x - ox) / scale), 0, c.nelx),
      y: clamp(Math.round((transformed.y - oy) / scale), 0, c.nely),
      rawX: transformed.x, rawY: transformed.y,
    };
  }

  function begin(event: React.PointerEvent, id: string, kind: Drag['kind'], item?: Support | AvoidRegion) {
    event.preventDefault();
    event.stopPropagation();
    select(id);
    if (kind.startsWith('region')) selectRegion(id);
    window.getSelection()?.removeAllRanges();
    svg.current!.focus({ preventScroll: true });
    svg.current!.setPointerCapture(event.pointerId);
    drag.current = {
      id, kind, start: position(event),
      support: kind.startsWith('support') ? item as Support : undefined,
      region: kind.startsWith('region') ? item as AvoidRegion : undefined,
    };
  }

  function move(event: React.PointerEvent) {
    const current = drag.current;
    if (!current) return;
    const point = position(event);
    if (current.kind === 'load') {
      set({ loads: c.loads.map(item => item.id === current.id ? { ...item, x: point.x, y: point.y } : item) });
    } else if (current.kind === 'force') {
      set({ loads: c.loads.map(item => item.id === current.id ? {
        ...item,
        fx: clamp(Math.round((point.rawX - px(item.x)) / 55 * 10) / 10, -100, 100),
        fy: clamp(Math.round((py(item.y) - point.rawY) / 55 * 10) / 10, -100, 100),
      } : item) });
    } else if (current.support) {
      const initial = current.support;
      if (current.kind === 'support-resize') {
        set({ supports: c.supports.map(item => item.id === current.id ? {
          ...item, x2: Math.max(initial.x, point.x), y2: Math.max(initial.y, point.y),
        } : item) });
      } else {
        const dx = clamp(point.x - current.start.x, -initial.x, c.nelx - initial.x2);
        const dy = clamp(point.y - current.start.y, -initial.y, c.nely - initial.y2);
        set({ supports: c.supports.map(item => item.id === current.id ? {
          ...initial, x: initial.x + dx, x2: initial.x2 + dx, y: initial.y + dy, y2: initial.y2 + dy,
        } : item) });
      }
    } else if (current.region) {
      const initial = current.region;
      const patch = current.kind === 'region-resize' ? {
        width: clamp(point.x - initial.x, 1, c.nelx - initial.x),
        height: clamp(point.y - initial.y, 1, c.nely - initial.y),
      } : {
        x: clamp(initial.x + point.x - current.start.x, 0, c.nelx - initial.width),
        y: clamp(initial.y + point.y - current.start.y, 0, c.nely - initial.height),
      };
      set({ avoidedRegions: c.avoidedRegions.map(item => item.id === current.id ? { ...initial, ...patch } : item) });
    }
  }

  function slider(label: string, key: 'nelx' | 'nely' | 'volfrac' | 'penal' | 'rmin', min: number, max: number, step: number, unit = '') {
    return <label className="slider">{label}<output>{c[key]}{unit}</output>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={c[key]}
        onChange={event => key === 'nelx' || key === 'nely'
          ? set(resizeMesh(c, key, +event.target.value))
          : set({ [key]: +event.target.value })} />
    </label>;
  }

  function regionSlider(label: string, key: 'x' | 'y' | 'width' | 'height', min: number, max: number) {
    if (!region) return null;
    return <label className="slider regionSlider">{label}<output>{region[key]}</output>
      <input aria-label={label} type="range" min={min} max={max} step={1} value={region[key]}
        onChange={event => updateRegion({ [key]: +event.target.value })} />
    </label>;
  }

  function field(label: string, value: number, min: number, max: number, change: (number: number) => void) {
    return <label className="field">{label}
      <input aria-label={label} type="number" min={min} max={max} value={value} onChange={event => {
        const number = +event.target.value;
        if (Number.isFinite(number) && number >= min && number <= max) change(number);
      }} />
    </label>;
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code[tab]);
      msg('Code copied to clipboard.');
    } catch {
      msg('Clipboard unavailable. Use Download instead.');
    }
  }

  const exportNames = { full: 'top88.m', section: 'loads_supports.m', domain: 'design_domain.m', command: 'run_top88.m' };
  const handoff = tab === 'full'
    ? 'Save this complete file as top88.m, then run top88() in MATLAB to use this configuration. Loads, supports, and avoided regions are already included. The command tab also works. Regenerate the file after changing the design.'
    : tab === 'domain'
    ? 'Apply all three design-domain blocks in top88.m. They initialize avoided cells, update sensitivities, and keep those cells empty during every optimization step. Volume fraction uses the available domain. Check the stability of disconnected regions in MATLAB.'
    : tab === 'command'
      ? `Run this after applying Loads & supports${c.avoidedRegions.length ? ' and Design domain' : ''} to top88.m. Regenerate all code after changing the mesh.`
      : `Replace DEFINE LOADS AND SUPPORTS through freedofs in top88.m. All forces belong to one simultaneous load case.${c.avoidedRegions.length ? ' Apply the Design domain code as well to enforce avoided regions.' : ''}`;

  return <main>
    <h1 className="appTitle">MATLAB TopOpt Configurator &amp; Exporter</h1>
    <div className="workspace">
      <aside>
        <div className="panelTitle"><h2>Parameters</h2></div>
        <div className="sectionLabel">Design domain</div>
        {slider('Horizontal elements', 'nelx', 2, 200, 1)}
        {slider('Vertical elements', 'nely', 2, 100, 1)}
        <section className="regionControls" aria-label="Avoided regions">
          <div className="sectionLabel domainSectionTitle"><span>Avoided regions</span>
            <button onClick={addRegion} disabled={c.avoidedRegions.length >= 100}><Plus size={12} />Region</button>
          </div>
          {region ? <>
            <div className="regionChoice">
              <select aria-label="Avoided region" value={region.id} onChange={event => {
                select(event.target.value); selectRegion(event.target.value);
              }}>{c.avoidedRegions.map(item => <option key={item.id}>{item.id}</option>)}</select>
              <button onClick={() => removeObject(region.id)} aria-label={`Remove region ${region.id}`}>Remove</button>
            </div>
            {regionSlider('Region x', 'x', 0, c.nelx - region.width)}
            {regionSlider('Region y', 'y', 0, c.nely - region.height)}
            {regionSlider('Region width', 'width', 1, c.nelx - region.x)}
            {regionSlider('Region height', 'height', 1, c.nely - region.y)}
            <p className="regionNote">{avoidedCount} cells avoided; {availableCount} available. Regions stay empty.</p>
          </> : <p className="regionNote">Add a rectangle to keep part of the domain empty.</p>}
        </section>
        <div className="sectionLabel">Material & filter</div>
        {slider('Volume fraction', 'volfrac', .05, 1, .01)}
        {slider('Penalization', 'penal', 1, 6, .1)}
        {slider('Filter radius', 'rmin', 1, 10, .1, ' el')}
        <label className="selectLabel">Filter method
          <select value={c.ft} onChange={event => set({ ft: +event.target.value as 1 | 2 })}>
            <option value={1}>Sensitivity filter · ft = 1</option>
            <option value={2}>Density filter · ft = 2</option>
          </select>
        </label>
        <div className="material"><small>{Math.round(c.volfrac * 100)}% of {availableCount} available cells</small></div>
        <div className="projectActions">
          <button onClick={() => download('top88-config.json', JSON.stringify(c, null, 2))}>Save project</button>
          <label className="button">Open JSON
            <input type="file" accept=".json" className="visuallyHidden" onChange={async event => {
              try {
                const file = event.target.files?.[0];
                if (file) {
                  const config = parseConfig(await file.text());
                  replace(config);
                  select(config.loads[0]?.id ?? config.supports[0]?.id ?? config.avoidedRegions[0]?.id ?? '');
                  selectRegion(config.avoidedRegions[0]?.id ?? '');
                  msg('Project loaded.');
                }
              } catch (error) { msg(String(error)); }
              event.target.value = '';
            }} />
          </label>
        </div>
      </aside>
      <section className="editor">
        <div className="panelTitle"><h2>Loads, supports & domain</h2>
          <select aria-label="Preset" defaultValue="Cantilever" onChange={event => {
            replace(preset(event.target.value)); select('L1'); selectRegion('');
          }}><option>Cantilever</option><option>Half MBB</option><option>Simply supported</option></select>
        </div>
        <div className="canvasToolbar"><span><b className="dot loadSymbol" />Load <b className="dot supportSymbol" />Support <b className="dot avoidSymbol" />Avoided</span>
          <label><input type="checkbox" checked={grid} onChange={event => showGrid(event.target.checked)} />Mesh</label>
        </div>
        <svg ref={svg} tabIndex={0} viewBox={`0 0 ${W} ${H}`} onPointerMove={move}
          onPointerUp={() => drag.current = null} onPointerCancel={() => drag.current = null}
          aria-label="Interactive design domain. Select loads, supports, or avoided regions. Use Command C and Command V to duplicate a selected load or support."
          role="img">
          <defs>
            <pattern id="mesh" width={scale} height={scale} patternUnits="userSpaceOnUse" x={ox} y={oy}>
              <path d={`M ${scale} 0 L 0 0 0 ${scale}`} fill="none" stroke="#b8b8b8" strokeWidth=".5" />
            </pattern>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 6L6 0" stroke="#000" strokeWidth="1" />
            </pattern>
            <pattern id="avoidHatch" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="10" height="10" fill="#fff" />
              <path d="M3 3L7 7M7 3L3 7" stroke="#000" strokeWidth=".6" />
            </pattern>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0 0L6 3L0 6" fill="none" stroke="#000" strokeWidth="1.5" />
            </marker>
          </defs>
          <rect x={ox} y={oy} width={c.nelx * scale} height={c.nely * scale} fill="#fff" stroke="#000" />
          <rect x={ox} y={oy} width={c.nelx * scale} height={c.nely * scale} fill={grid ? 'url(#mesh)' : 'none'} />
          <path d={`M${ox} 42H${px(c.nelx)}`} stroke="#000" />
          <text x={px(c.nelx / 2)} y="33" textAnchor="middle">{c.nelx} ELEMENTS</text>
          <text x="24" y={py(c.nely / 2)} transform={`rotate(-90 24 ${py(c.nely / 2)})`} textAnchor="middle">{c.nely} ELEMENTS</text>
          {c.avoidedRegions.map(item => <g key={item.id}>
            <rect aria-label={`Avoided region ${item.id}`} onPointerDown={event => begin(event, item.id, 'region', item)}
              x={px(item.x)} y={py(item.y)} width={item.width * scale} height={item.height * scale}
              fill="url(#avoidHatch)" stroke="#000" strokeWidth={selected === item.id ? 2 : 1} strokeDasharray="4 3" className="draggable" />
            <text x={px(item.x) + 4} y={py(item.y) + 12}>{item.id}</text>
            <rect aria-label={`Resize region ${item.id}`} onPointerDown={event => begin(event, item.id, 'region-resize', item)}
              x={px(item.x + item.width) - 4} y={py(item.y + item.height) - 4} width="8" height="8" fill="#fff" stroke="#000" className="resize" />
          </g>)}
          {c.supports.map(item => <g key={item.id}>
            <rect onPointerDown={event => begin(event, item.id, 'support', item)} x={px(item.x) - 5} y={py(item.y) - 5}
              width={Math.max(10, (item.x2 - item.x) * scale + 10)} height={Math.max(10, (item.y2 - item.y) * scale + 10)}
              fill="url(#hatch)" stroke="#000" strokeWidth={selected === item.id ? 2 : 1} className="draggable" />
            <text x={px(item.x) + 10} y={py(item.y) + 16}>{item.id} · {item.ux ? 'X' : ''}{item.uy ? 'Y' : ''}</text>
            <rect aria-label={`Resize ${item.id}`} onPointerDown={event => begin(event, item.id, 'support-resize', item)}
              x={px(item.x2) - 5} y={py(item.y2) - 5} width="10" height="10" fill="#fff" stroke="#000" className="resize" />
          </g>)}
          {c.loads.map(item => {
            const ex = px(item.x) + item.fx * 55, ey = py(item.y) - item.fy * 55;
            return <g key={item.id}>
              <line x1={px(item.x)} y1={py(item.y)} x2={ex} y2={ey} stroke="#000" strokeWidth="2.5" markerEnd="url(#arrow)" />
              <circle onPointerDown={event => begin(event, item.id, 'load')} cx={px(item.x)} cy={py(item.y)}
                r={selected === item.id ? 7 : 5} fill="#fff" stroke="#000" strokeWidth="2" className="draggable" />
              <circle onPointerDown={event => begin(event, item.id, 'force')} cx={ex} cy={ey} r="10" fill="transparent"
                stroke="#000" strokeDasharray="2 3" className="draggable" />
              <text x={ex + 15} y={ey + 4}>{item.id}</text>
            </g>;
          })}
          <text x={ox} y="338">x → / row y ↓ / Fy + ↑</text>
          <text x="648" y="338" textAnchor="end">{availableCount} AVAILABLE CELLS</text>
        </svg>
        <div className="hint">Drag loads, supports, or avoided regions to move them. Drag an arrow to change force; drag a square handle to resize.</div>
        <div className="inspector">
          <div className="objectBar">
            <select aria-label="Selected object" value={selected} onChange={event => {
              select(event.target.value);
              if (c.avoidedRegions.some(item => item.id === event.target.value)) selectRegion(event.target.value);
            }}>
              <option value="" disabled>Select object</option>
              {c.loads.map(item => <option key={item.id}>{item.id}</option>)}
              {c.supports.map(item => <option key={item.id}>{item.id}</option>)}
              {c.avoidedRegions.map(item => <option key={item.id}>{item.id}</option>)}
            </select>
            <button disabled={c.loads.length >= 100} onClick={() => {
              const id = newId('L');
              set({ loads: [...c.loads, { id, x: c.nelx, y: Math.round(c.nely / 2), fx: 0, fy: -1 }] }); select(id);
            }}><Plus size={14} />Load</button>
            <button disabled={c.supports.length >= 100} onClick={() => {
              const id = newId('S');
              set({ supports: [...c.supports, { id, x: 0, y: 0, x2: 0, y2: c.nely, ux: true, uy: true }] }); select(id);
            }}><Plus size={14} />Support</button>
            <button className="delete" disabled={!selected} onClick={() => removeObject()}>Remove</button>
          </div>
          {load && <div className="fields">
            {field('Node x', load.x, 0, c.nelx, x => updateLoad({ x: Math.round(x) }))}
            {field('Row y', load.y, 0, c.nely, y => updateLoad({ y: Math.round(y) }))}
            {field('Fx', load.fx, -100, 100, fx => updateLoad({ fx }))}
            {field('Fy', load.fy, -100, 100, fy => updateLoad({ fy }))}
            <span className="nodeInfo">MATLAB node<b>{nodeId(load.x, load.y, c.nely)}</b></span>
          </div>}
          {support && <div className="fields">
            {field('Start x', support.x, 0, support.x2, x => updateSupport({ x: Math.round(x) }))}
            {field('Start y', support.y, 0, support.y2, y => updateSupport({ y: Math.round(y) }))}
            {field('End x', support.x2, support.x, c.nelx, x2 => updateSupport({ x2: Math.round(x2) }))}
            {field('End y', support.y2, support.y, c.nely, y2 => updateSupport({ y2: Math.round(y2) }))}
            <label><input type="checkbox" checked={support.ux} onChange={event => updateSupport({ ux: event.target.checked })} />Fix X</label>
            <label><input type="checkbox" checked={support.uy} onChange={event => updateSupport({ uy: event.target.checked })} />Fix Y</label>
          </div>}
          {c.avoidedRegions.some(item => item.id === selected) && <p className="selectionNote">Change this region with the domain sliders, or drag its square handle.</p>}
          <div className="shortcutHint">Select a load or support, then <kbd>⌘C</kbd> <kbd>⌘V</kbd> to duplicate. <span>Ctrl+C / Ctrl+V also work.</span></div>
        </div>
      </section>
    </div>
    <details className="output">
      <summary>MATLAB export{errors.length > 0 && <span className="exportWarning"> Needs attention</span>}</summary>
      <div className="codeHead"><p>For top88.m</p><div className="actions">
        <button disabled={!code} onClick={copyCode}>Copy</button>
        <button className="primary" disabled={!code} onClick={() => code && download(exportNames[tab], code[tab])}>Download .m</button>
      </div></div>
      <div className="codeTabs">
        <button className={tab === 'full' ? 'active' : ''} onClick={() => setTab('full')}>Full MATLAB script</button>
        <button className={tab === 'section' ? 'active' : ''} onClick={() => setTab('section')}>Loads & supports</button>
        <button className={tab === 'domain' ? 'active' : ''} onClick={() => setTab('domain')}>Design domain</button>
        <button className={tab === 'command' ? 'active' : ''} onClick={() => setTab('command')}>top88 command</button>
        <span className={errors.length ? 'invalid' : 'valid'}>{errors.length ? '● Needs attention' : <><Check size={13} />Configuration checked</>}</span>
      </div>
      {errors.length ? <div className="errors">{errors.map(error => <p key={error}>{error}</p>)}</div> : <pre><code>{code![tab]}</code></pre>}
      <div className="handoff">{handoff}</div>
    </details>
    <footer><span>{fixedDofs(c).length} constrained DOFs · {c.loads.length} loads · {c.avoidedRegions.length} avoided regions</span><span>Optimization runs in MATLAB.</span></footer>
    <div className="notice" role="status" onClick={() => msg('')}>{notice}</div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

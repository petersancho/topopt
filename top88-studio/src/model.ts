import {TOP88_TEMPLATE} from './top88-template';

export type Load = {id:string;x:number;y:number;fx:number;fy:number};
export type Support = {id:string;x:number;y:number;x2:number;y2:number;ux:boolean;uy:boolean};
export type AvoidRegion = {id:string;x:number;y:number;width:number;height:number};
export type Config = {
  version:1;
  nelx:number;
  nely:number;
  volfrac:number;
  penal:number;
  rmin:number;
  ft:1|2;
  loads:Load[];
  supports:Support[];
  avoidedRegions:AvoidRegion[];
};

export const nodeId = (x:number,y:number,nely:number) => x*(nely+1)+y+1;
export const dofs = (node:number) => [2*node-1,2*node];

export function preset(name='Cantilever'):Config {
  const c:Config = {
    version:1,nelx:60,nely:30,volfrac:.5,penal:3,rmin:1.5,ft:1,
    loads:[{id:'L1',x:60,y:15,fx:0,fy:-1}],
    supports:[{id:'S1',x:0,y:0,x2:0,y2:30,ux:true,uy:true}],
    avoidedRegions:[],
  };
  if (name==='Half MBB') {
    c.loads = [{id:'L1',x:0,y:0,fx:0,fy:-1}];
    c.supports = [
      {id:'S1',x:0,y:0,x2:0,y2:30,ux:true,uy:false},
      {id:'S2',x:60,y:30,x2:60,y2:30,ux:false,uy:true},
    ];
  }
  if (name==='Simply supported') {
    c.loads = [{id:'L1',x:30,y:0,fx:0,fy:-1}];
    c.supports = [
      {id:'S1',x:0,y:30,x2:0,y2:30,ux:true,uy:true},
      {id:'S2',x:60,y:30,x2:60,y2:30,ux:false,uy:true},
    ];
  }
  return c;
}

/** MATLAB element indices: one-based, with rows numbered down each column. */
export function avoidedElementIds(c:Config):number[] {
  const ids = new Set<number>();
  for (const region of c.avoidedRegions) {
    for (let x=region.x;x<region.x+region.width;x++) {
      for (let y=region.y;y<region.y+region.height;y++) ids.add(x*c.nely+y+1);
    }
  }
  return [...ids].sort((a,b)=>a-b);
}

/** Preserve relative positions and at least one cell per region when resizing. */
export function resizeMesh(c:Config,k:'nelx'|'nely',v:number):Partial<Config> {
  if (!Number.isFinite(v)) throw Error('Mesh dimensions must be finite.');
  const next = Math.max(2,Math.min(k==='nelx'?200:100,Math.round(v)));
  const old = c[k];
  const scale = (n:number) => Math.max(0,Math.min(next,Math.round(n*next/old)));
  const loads = c.loads.map(l=>({...l,[k==='nelx'?'x':'y']:scale(k==='nelx'?l.x:l.y)}));
  const supports = c.supports.map(s=>k==='nelx'
    ? {...s,x:scale(s.x),x2:scale(s.x2)}
    : {...s,y:scale(s.y),y2:scale(s.y2)});
  const avoidedRegions = c.avoidedRegions.map(region=>{
    if (k==='nelx') {
      const x = Math.min(next-1,scale(region.x));
      const end = Math.max(x+1,scale(region.x+region.width));
      return {...region,x,width:end-x};
    }
    const y = Math.min(next-1,scale(region.y));
    const end = Math.max(y+1,scale(region.y+region.height));
    return {...region,y,height:end-y};
  });
  return {[k]:next,loads,supports,avoidedRegions};
}

export function fixedDofs(c:Config):number[] {
  const fixed = new Set<number>();
  for (const s of c.supports) {
    for (let x=s.x;x<=s.x2;x++) {
      for (let y=s.y;y<=s.y2;y++) {
        const [a,b] = dofs(nodeId(x,y,c.nely));
        if (s.ux) fixed.add(a);
        if (s.uy) fixed.add(b);
      }
    }
  }
  return [...fixed].sort((a,b)=>a-b);
}

function rank(rows:number[][]):number {
  const a = rows.map(r=>[...r]);
  let k = 0;
  for (let j=0;j<3;j++) {
    const i = a.findIndex((r,i)=>i>=k&&Math.abs(r[j])>1e-8);
    if (i<0) continue;
    [a[k],a[i]] = [a[i],a[k]];
    const divisor = a[k][j];
    a[k] = a[k].map(t=>t/divisor);
    for (let t=k+1;t<a.length;t++) {
      const factor = a[t][j];
      a[t] = a[t].map((v,j)=>v-factor*a[k][j]);
    }
    k++;
  }
  return k;
}

const validId = (id:unknown) => typeof id==='string'&&/^[-a-zA-Z0-9_]{1,80}$/.test(id);

export function validate(c:Config):string[] {
  const errors:string[] = [];
  if (!Number.isInteger(c.nelx)||c.nelx<2||c.nelx>200||
      !Number.isInteger(c.nely)||c.nely<2||c.nely>100) {
    errors.push('Mesh must be 2–200 × 2–100 integer elements.');
  }
  if (![c.volfrac,c.penal,c.rmin,c.ft].every(Number.isFinite)||
      !(c.volfrac>=.05&&c.volfrac<=1)||!(c.penal>=1&&c.penal<=6)||
      !(c.rmin>=1&&c.rmin<=10)||![1,2].includes(c.ft)) {
    errors.push('SIMP parameters are outside their allowed ranges.');
  }
  if (errors.length) return errors;
  if (!Array.isArray(c.loads)||!Array.isArray(c.supports)||!Array.isArray(c.avoidedRegions)) {
    return ['Loads, supports, and avoided regions must be arrays.'];
  }
  if (c.loads.length>100||c.supports.length>100||c.avoidedRegions.length>100) {
    return ['At most 100 loads, 100 supports, and 100 avoided regions are allowed.'];
  }
  const objects = [...c.loads,...c.supports,...c.avoidedRegions];
  if (objects.some(v=>!v||!validId(v.id))||new Set(objects.map(v=>v?.id)).size!==objects.length) {
    return ['Object identifiers must be unique letters, numbers, hyphens, or underscores.'];
  }
  const point = (x:number,y:number) => Number.isInteger(x)&&Number.isInteger(y)&&
    x>=0&&x<=c.nelx&&y>=0&&y<=c.nely;
  if (c.loads.some(l=>!point(l.x,l.y)||
      ![l.fx,l.fy].every(v=>Number.isFinite(v)&&Math.abs(v)<=100))) {
    errors.push('Loads need valid mesh nodes and finite force components within ±100.');
  }
  if (c.supports.some(s=>!point(s.x,s.y)||!point(s.x2,s.y2)||s.x>s.x2||s.y>s.y2||
      typeof s.ux!=='boolean'||typeof s.uy!=='boolean'||(!s.ux&&!s.uy))) {
    errors.push('Support bounds or constrained directions are invalid.');
  }
  if (c.avoidedRegions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isInteger)||
      r.x<0||r.y<0||r.width<1||r.height<1||r.x+r.width>c.nelx||r.y+r.height>c.nely)) {
    errors.push('Avoided regions need integer cell coordinates and positive sizes inside the mesh.');
  }
  if (errors.length) return errors;

  const avoided = new Set(avoidedElementIds(c));
  if (avoided.size===c.nelx*c.nely) {
    return ['Avoided regions cannot cover the entire design domain.'];
  }
  const hasMaterial = (nx:number,ny:number) => {
    for (const x of [nx-1,nx]) {
      for (const y of [ny-1,ny]) {
        if (x>=0&&x<c.nelx&&y>=0&&y<c.nely&&!avoided.has(x*c.nely+y+1)) return true;
      }
    }
    return false;
  };
  if (c.supports.some(s=>{
    for (let x=s.x;x<=s.x2;x++) {
      for (let y=s.y;y<=s.y2;y++) if (!hasMaterial(x,y)) return true;
    }
    return false;
  })) errors.push('Support nodes must touch at least one available design element.');

  const fixed = fixedDofs(c);
  const rows = fixed.map(d=>{
    const n = Math.ceil(d/2)-1;
    const x = Math.floor(n/(c.nely+1));
    const y = n%(c.nely+1);
    return d%2?[1,0,-y]:[0,1,x];
  });
  if (rank(rows)<3) errors.push('Supports allow rigid-body motion. Constrain all three planar rigid modes.');
  const forces = new Map<number,number>();
  for (const l of c.loads) {
    const [a,b] = dofs(nodeId(l.x,l.y,c.nely));
    forces.set(a,(forces.get(a)||0)+l.fx);
    forces.set(b,(forces.get(b)||0)+l.fy);
  }
  const nonzeroForces = [...forces].filter(([,v])=>Math.abs(v)>1e-12);
  if (!nonzeroForces.length) errors.push('Add a nonzero resultant nodal load.');
  if (nonzeroForces.some(([d])=>fixed.includes(d))) {
    errors.push('A load acts on a constrained degree of freedom.');
  }
  if (nonzeroForces.some(([d])=>{
    const n = Math.ceil(d/2)-1;
    return !hasMaterial(Math.floor(n/(c.nely+1)),n%(c.nely+1));
  })) errors.push('Nonzero resultant loads must touch at least one available design element.');
  return errors;
}

type DomainBlocks = {initialization:string;sensitivity:string;oc:string};

/** Shared by the hand-applied patch and the complete top88.m export. */
function domainBlocks(c:Config):DomainBlocks {
  const initialization = ['passive = false(nely,nelx);'];
  for (const r of c.avoidedRegions) {
    initialization.push(`% ${r.id}: cells x=${r.x}, y=${r.y}, width=${r.width}, height=${r.height}`,
      `passive(${r.y+1}:${r.y+r.height},${r.x+1}:${r.x+r.width}) = true;`);
  }
  initialization.push(
    'active = ~passive;',
    'targetVolume = volfrac*nnz(active);',
    'x = volfrac*ones(nely,nelx);',
    'x(passive) = 0;',
    'if ft == 1',
    '  xPhys = x;',
    'elseif ft == 2',
    '  xPhys = reshape((H*x(:))./Hs,nely,nelx);',
    'end',
    'xPhys(passive) = 0;',
  );
  const sensitivity = [
    '% Mask physical derivatives BEFORE the density-filter chain rule.',
    'dc(passive) = 0;',
    'dv(passive) = 0;',
    'if ft == 1',
    '  dc(:) = H*(x(:).*dc(:))./Hs./max(1e-3,x(:));',
    'elseif ft == 2',
    '  dc(:) = H*(dc(:)./Hs);',
    '  dv(:) = H*(dv(:)./Hs);',
    'end',
  ];
  const oc = [
    'l1 = 0;',
    '% Scale the upper bracket so large load sensitivities remain feasible.',
    'l2 = max(1e9,max(-dc(active)./dv(active)));',
    'move = 0.2;',
    '% Bound the search when the volume constraint is inactive (e.g. volfrac = 1).',
    'ocIterations = 0;',
    'while (l2-l1)/max(l1+l2,eps) > 1e-3 && ocIterations < 100',
    '  ocIterations = ocIterations+1;',
    '  lmid = 0.5*(l2+l1);',
    '  xnew = zeros(nely,nelx);',
    '  % Update only available variables; avoid 0/0 on frozen passive cells.',
    '  xnew(active) = max(0,max(x(active)-move,min(1,min(x(active)+move, ...',
    '    x(active).*sqrt(-dc(active)./dv(active)/lmid)))));',
    '  xnew(passive) = 0;',
    '  if ft == 1',
    '    xPhys = xnew;',
    '  elseif ft == 2',
    '    xPhys(:) = (H*xnew(:))./Hs;',
    '  end',
    '  % Enforce voids AFTER filtering, inside EVERY volume bisection.',
    '  xPhys(passive) = 0;',
    '  if sum(xPhys(:)) > targetVolume',
    '    l1 = lmid;',
    '  else',
    '    l2 = lmid;',
    '  end',
    'end',
    'change = max(abs(xnew(:)-x(:)));',
    'x = xnew;',
  ];
  return {
    initialization:initialization.join('\n'),
    sensitivity:sensitivity.join('\n'),
    oc:oc.join('\n'),
  };
}

function generateDomain(blocks:DomainBlocks):string {
  return [
    '% AVOIDED DESIGN REGIONS — passive voids for the official DTU top88.m',
    '% Source: https://www.topopt.mek.dtu.dk/apps-and-software/efficient-topology-optimization-in-matlab',
    '% Apply all three replacements below, plus the generated loads/supports section.',
    '% Coordinates are zero-based cells; MATLAB rows follow y downward.',
    '% volfrac applies to available cells, excluding the union of avoided regions.',
    '% Emin remains in the FE model; these voids are not removed mesh elements.',
    '% Check connectivity and conditioning in MATLAB; global support checks do not',
    '% establish stability of disconnected components or the final optimized shape.',
    '',
    '% 1. Under INITIALIZE ITERATION, replace the x and xPhys initialization',
    '% (keep the following loop = 0 and change = 1 lines).',
    blocks.initialization,
    '',
    '% 2. Replace the complete FILTERING/MODIFICATION OF SENSITIVITIES block',
    '% (after dc and dv are computed; before the OC update).',
    blocks.sensitivity,
    '',
    '% 3. Replace the complete OPTIMALITY CRITERIA UPDATE block, from l1 = 0',
    '% through x = xnew (leave PRINT RESULTS and subsequent code in place).',
    blocks.oc,
  ].join('\n');
}

function runtimeParameters(c:Config):string {
  const lines = [
    '% Configured by MATLAB TopOpt Configurator & Exporter.',
    '% Save as top88.m. Run top88() or the generated six-argument command.',
    '% Mesh coordinates are compiled below; regenerate to change the mesh.',
    '% volfrac applies to available cells. Passive cells retain Emin stiffness.',
    '% Check disconnected-component stability and conditioning in MATLAB.',
    'if nargin == 0',
    `  nelx = ${c.nelx};`,
    `  nely = ${c.nely};`,
    `  volfrac = ${c.volfrac};`,
    `  penal = ${c.penal};`,
    `  rmin = ${c.rmin};`,
    `  ft = ${c.ft};`,
    'elseif nargin ~= 6',
    "  error('FORM:Arguments','Use top88() or top88(nelx,nely,volfrac,penal,rmin,ft).');",
    'end',
    'if ~(isnumeric(nelx) && isreal(nelx) && isscalar(nelx) && isfinite(nelx) && ...',
    '     isnumeric(nely) && isreal(nely) && isscalar(nely) && isfinite(nely) && ...',
    `     nelx == ${c.nelx} && nely == ${c.nely})`,
    `  error('FORM:Mesh','This export requires nelx=${c.nelx} and nely=${c.nely}. Regenerate for another mesh.');`,
    'end',
  ];
  for (const [key,min,max] of [['volfrac',.05,1],['penal',1,6],['rmin',1,10]] as const) {
    lines.push(
      `if ~(isnumeric(${key}) && isreal(${key}) && isscalar(${key}) && isfinite(${key}) && ...`,
      `     ${key} >= ${min} && ${key} <= ${max})`,
      `  error('FORM:Parameters','${key} must be a finite real scalar between ${min} and ${max}.');`,
      'end',
    );
  }
  lines.push(
    'if ~(isnumeric(ft) && isreal(ft) && isscalar(ft) && isfinite(ft) && ismember(ft,[1 2]))',
    "  error('FORM:Parameters','ft must be 1 (sensitivity) or 2 (density).');",
    'end',
    '% Use floating-point arithmetic even when called with integer numeric inputs.',
  );
  for (const key of ['nelx','nely','volfrac','penal','rmin','ft']) lines.push(`${key} = double(${key});`);
  return lines.join('\n');
}

/** Replace one verified source interval, retaining all other upstream bytes. */
function replaceSourceBlock(source:string,startMarker:string,endMarker:string,replacement:string):string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker,start+startMarker.length);
  if (start<0||end<0||source.indexOf(startMarker,start+1)>=0||
      source.indexOf(endMarker,end+1)>=0) {
    throw Error(`Cannot locate unique top88 source block: ${startMarker}`);
  }
  return source.slice(0,start)+replacement+'\n'+source.slice(end);
}

const indent = (text:string) => text.split('\n').map(line=>'  '+line).join('\n');

function generateFull(c:Config,section:string,blocks:DomainBlocks):string {
  const signature = 'function top88(nelx,nely,volfrac,penal,rmin,ft)';
  const filtering = '  %% FILTERING/MODIFICATION OF SENSITIVITIES';
  const oc = '  %% OPTIMALITY CRITERIA UPDATE OF DESIGN VARIABLES AND PHYSICAL DENSITIES';
  let source = replaceSourceBlock(TOP88_TEMPLATE,signature,'%% MATERIAL PROPERTIES',
    signature+'\n'+runtimeParameters(c));
  source = replaceSourceBlock(source,'% DEFINE LOADS AND SUPPORTS (HALF MBB-BEAM)',
    '%% PREPARE FILTER',section);
  source = replaceSourceBlock(source,'x = repmat(volfrac,nely,nelx);','loop = 0;',blocks.initialization);
  source = replaceSourceBlock(source,filtering,oc,filtering+'\n'+indent(blocks.sensitivity));
  return replaceSourceBlock(source,oc,'  %% PRINT RESULTS',oc+'\n'+indent(blocks.oc));
}

export function generate(c:Config):{command:string;section:string;domain:string;full:string} {
  const errors = validate(c);
  if (errors.length) throw Error(errors.join('\n'));
  const lines = [
    '% DEFINE LOADS AND SUPPORTS (generated by FORM)',
    '% Coordinates: x right, row y down; positive Fy is upward.',
    'ndof = 2*(nelx+1)*(nely+1);','F = sparse(ndof,1);','U = zeros(ndof,1);',
  ];
  for (const l of c.loads) {
    lines.push(`% ${l.id}: mesh node (${l.x}, ${l.y})`,
      `n = ${l.x}*(nely+1)+${l.y}+1;`,
      `F(2*n-1) = F(2*n-1) + (${l.fx});`,
      `F(2*n) = F(2*n) + (${l.fy});`);
  }
  lines.push('fixeddofs = [];');
  for (const s of c.supports) {
    lines.push(`[sx,sy] = meshgrid(${s.x}:${s.x2},${s.y}:${s.y2});`,
      'sn = sx(:)*(nely+1)+sy(:)+1;');
    if (s.ux) lines.push('fixeddofs = [fixeddofs; 2*sn-1];');
    if (s.uy) lines.push('fixeddofs = [fixeddofs; 2*sn];');
  }
  lines.push('fixeddofs = unique(fixeddofs);','alldofs = 1:ndof;',
    'freedofs = setdiff(alldofs,fixeddofs);');
  const section = lines.join('\n');
  const blocks = domainBlocks(c);
  return {
    command:`top88(${c.nelx},${c.nely},${c.volfrac},${c.penal},${c.rmin},${c.ft});`,
    section,
    domain:generateDomain(blocks),
    full:generateFull(c,section,blocks),
  };
}

type RecordValue = Record<string,unknown>;
const record = (v:unknown):v is RecordValue => !!v&&typeof v==='object'&&!Array.isArray(v);
const exactKeys = (v:RecordValue,keys:string[]) =>
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const numericFields = (v:RecordValue,keys:string[]) =>
  keys.every(k=>typeof v[k]==='number'&&Number.isFinite(v[k]));

export function parseConfig(text:string):Config {
  const value:unknown = JSON.parse(text);
  const configKeys = ['version','nelx','nely','volfrac','penal','rmin','ft','loads','supports'];
  if (!record(value)||value.version!==1||
      !exactKeys(value,Object.hasOwn(value,'avoidedRegions')?[...configKeys,'avoidedRegions']:configKeys)||
      !numericFields(value,['nelx','nely','volfrac','penal','rmin','ft'])||
      !Array.isArray(value.loads)||!Array.isArray(value.supports)||
      (Object.hasOwn(value,'avoidedRegions')&&!Array.isArray(value.avoidedRegions))) {
    throw Error('Invalid FORM v1 configuration.');
  }
  const regions = value.avoidedRegions??[];
  if (value.loads.some(l=>!record(l)||!exactKeys(l,['id','x','y','fx','fy'])||
      !validId(l.id)||!numericFields(l,['x','y','fx','fy']))||
      value.supports.some(s=>!record(s)||!exactKeys(s,['id','x','y','x2','y2','ux','uy'])||
      !validId(s.id)||!numericFields(s,['x','y','x2','y2'])||
      typeof s.ux!=='boolean'||typeof s.uy!=='boolean')||
      !Array.isArray(regions)||regions.some(r=>!record(r)||
      !exactKeys(r,['id','x','y','width','height'])||!validId(r.id)||
      !numericFields(r,['x','y','width','height']))) {
    throw Error('Invalid numeric fields or object identifiers.');
  }
  const c = {...value,avoidedRegions:regions} as Config;
  const errors = validate(c);
  if (errors.length) throw Error(errors.join(' '));
  return c;
}

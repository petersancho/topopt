import {describe,it,expect,vi} from 'vitest';
import {
  nodeId,dofs,preset,fixedDofs,validate,generate,parseConfig,
  avoidedElementIds,resizeMesh,type Config,type AvoidRegion,
} from './model';
import {TOP88_TEMPLATE} from './top88-template';

function smallConfig():Config {
  return {
    ...preset(),nelx:6,nely:4,
    loads:[{id:'L1',x:6,y:2,fx:0,fy:-1}],
    supports:[{id:'S1',x:0,y:0,x2:0,y2:4,ux:true,uy:true}],
  };
}
const region = (changes:Partial<AvoidRegion>={}):AvoidRegion =>
  ({id:'R1',x:2,y:1,width:2,height:2,...changes});

describe('top88',()=>{
  it('numbers nodes down columns and maps DOFs',()=>{
    expect(nodeId(0,0,2)).toBe(1);
    expect(nodeId(0,2,2)).toBe(3);
    expect(nodeId(1,0,2)).toBe(4);
    expect(nodeId(2,2,2)).toBe(9);
    expect(dofs(9)).toEqual([17,18]);
  });
  it('deduplicates supports',()=>{
    const c=preset();
    c.supports.push({...c.supports[0],id:'S2'});
    expect(fixedDofs(c)).toHaveLength(62);
  });
  it.each(['Cantilever','Half MBB','Simply supported'])('accepts %s',name=>{
    expect(validate(preset(name))).toEqual([]);
    expect(preset(name).avoidedRegions).toEqual([]);
  });
  it('rejects free rotation',()=>{
    const c=preset();
    c.supports=[{id:'S',x:0,y:0,x2:0,y2:0,ux:true,uy:true}];
    expect(validate(c).join()).toContain('rigid-body');
  });
  it('rejects constrained loads',()=>{
    const c=preset();
    c.loads[0].x=0;
    expect(validate(c).join()).toContain('constrained degree');
  });
  it('rejects invalid nodes and NaN',()=>{
    const c=preset();
    c.loads[0].x=61;
    expect(validate(c).length).toBeGreaterThan(0);
    c.volfrac=NaN;
    expect(validate(c).length).toBeGreaterThan(0);
  });
  it('rejects cancelling loads',()=>{
    const c=preset();
    c.loads.push({...c.loads[0],id:'L2',fy:1});
    expect(validate(c).join()).toContain('nonzero');
  });
  it('adds duplicate nodal forces',()=>{
    const c=preset();
    c.loads.push({...c.loads[0],id:'L2'});
    const out=generate(c);
    expect(out.section.match(/F\(2\*n\) = F\(2\*n\) \+ \(-1\);/g)).toHaveLength(2);
    expect(out.command).toBe('top88(60,30,0.5,3,1.5,1);');
    expect(out.section).toContain('U = zeros(ndof,1)');
  });
  it('blocks unstable export',()=>{
    const c=preset();
    c.supports=[];
    expect(()=>generate(c)).toThrow();
  });
  it('round trips and rejects malformed JSON',()=>{
    expect(parseConfig(JSON.stringify(preset()))).toEqual(preset());
    expect(()=>parseConfig('{"version":2}')).toThrow();
    expect(()=>parseConfig(JSON.stringify({...preset(),loads:[null]}))).toThrow();
  });
});

describe('avoided design regions',()=>{
  it('numbers cells down columns, separate from node numbering',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    expect(avoidedElementIds(c)).toEqual([10,11,14,15]);
    expect(validate(c)).toEqual([]);
  });
  it('counts the union of overlapping rectangles only once',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region(),region({id:'R2',x:3,y:2})];
    expect(avoidedElementIds(c)).toEqual([10,11,14,15,16,19,20]);
  });
  it('accepts a single cell touching the far mesh boundary',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region({x:5,y:3,width:1,height:1})];
    expect(validate(c)).toEqual([]);
    expect(avoidedElementIds(c)).toEqual([24]);
    expect(parseConfig(JSON.stringify(c))).toEqual(c);
    expect(generate(c).domain).toContain('passive(4:4,6:6) = true;');
  });
  it.each([
    {x:-1},{y:-1},{x:6},{y:4},{width:0},{height:0},
    {width:5},{height:4},{x:1.5},{y:1.5},{width:1.5},{height:1.5},
    {x:NaN},{y:Infinity},{width:Infinity},{height:NaN},
  ])('rejects invalid region bounds %j',changes=>{
    const c=smallConfig();
    c.avoidedRegions=[region(changes)];
    expect(validate(c).join()).toContain('integer cell coordinates');
    expect(()=>parseConfig(JSON.stringify(c))).toThrow();
  });
  it('rejects more than 100 regions',()=>{
    const c=smallConfig();
    c.avoidedRegions=Array.from({length:101},(_,i)=>region({id:`R${i}`}));
    expect(validate(c).join()).toContain('At most 100');
  });
  it('rejects a fully avoided domain formed by multiple overlapping regions',()=>{
    const c=smallConfig();
    c.avoidedRegions=[
      region({x:0,y:0,width:4,height:4}),
      region({id:'R2',x:3,y:0,width:3,height:4}),
    ];
    expect(validate(c).join()).toContain('entire design domain');
    expect(()=>generate(c)).toThrow('entire design domain');
  });
  it('rejects nonzero loads on nodes surrounded only by avoided cells',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    c.loads[0]={...c.loads[0],x:3,y:2};
    expect(validate(c).join()).toContain('Nonzero resultant loads must touch');
  });
  it('accepts loads on the boundary of an avoided region with an available adjacent cell',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    c.loads[0]={...c.loads[0],x:2,y:2};
    expect(validate(c)).toEqual([]);
  });
  it('uses resultant forces when checking loads surrounded by avoided cells',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    c.loads.push({id:'L2',x:3,y:2,fx:1,fy:1},{id:'L3',x:3,y:2,fx:-1,fy:-1});
    expect(validate(c)).toEqual([]);
  });
  it('rejects constrained nodes that touch no available cells',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region({x:0,y:0,width:1,height:1})];
    expect(validate(c).join()).toContain('Support nodes must touch');
  });
  it('does not claim to check cut-domain connectivity',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region({x:2,y:0,width:1,height:4})];
    expect(validate(c)).toEqual([]);
    expect(generate(c).domain).toContain('stability of disconnected components');
  });
});

describe('configuration schema',()=>{
  it('migrates old version 1 configurations with no avoided regions',()=>{
    const {avoidedRegions,...legacy}=preset();
    expect(avoidedRegions).toEqual([]);
    expect(parseConfig(JSON.stringify(legacy))).toEqual(preset());
  });
  it('round trips region coordinates and preserves their identifiers',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    expect(parseConfig(JSON.stringify(c))).toEqual(c);
  });
  it.each(['loads','supports','avoidedRegions'] as const)('rejects malformed %s arrays',key=>{
    expect(()=>parseConfig(JSON.stringify({...preset(),[key]:null}))).toThrow();
    expect(()=>parseConfig(JSON.stringify({...preset(),[key]:[null]}))).toThrow();
  });
  it('rejects duplicate identifiers across object kinds',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region({id:'L1'})];
    expect(()=>parseConfig(JSON.stringify(c))).toThrow('unique');
    expect(validate(c).join()).toContain('unique');
  });
  it('rejects duplicate region identifiers',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region(),region()];
    expect(()=>parseConfig(JSON.stringify(c))).toThrow('unique');
  });
  it.each(['','bad id','x\n% arbitrary MATLAB',';disp(1)'])('rejects unsafe identifier %j',id=>{
    const c=smallConfig();
    c.avoidedRegions=[region({id})];
    expect(()=>parseConfig(JSON.stringify(c))).toThrow();
  });
  it('rejects unexpected fields and incomplete records',()=>{
    const c=smallConfig();
    expect(()=>parseConfig(JSON.stringify({...c,unexpected:true}))).toThrow();
    expect(()=>parseConfig(JSON.stringify({...c,loads:[{...c.loads[0],unexpected:true}]}))).toThrow();
    expect(()=>parseConfig(JSON.stringify({...c,supports:[{...c.supports[0],unexpected:true}]}))).toThrow();
    expect(()=>parseConfig(JSON.stringify({...c,avoidedRegions:[{...region(),unexpected:true}]}))).toThrow();
    const {height,...incomplete}=region();
    expect(height).toBe(2);
    expect(()=>parseConfig(JSON.stringify({...c,avoidedRegions:[incomplete]}))).toThrow();
  });
  it('requires numeric region fields and boolean support directions',()=>{
    const c=smallConfig();
    expect(()=>parseConfig(JSON.stringify({...c,avoidedRegions:[{...region(),width:'2'}]}))).toThrow();
    expect(()=>parseConfig(JSON.stringify({...c,supports:[{...c.supports[0],ux:1}]}))).toThrow();
  });
});

describe('mesh resizing',()=>{
  it('scales load and anchor nodes and both region endpoints',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    const wide={...c,...resizeMesh(c,'nelx',12)};
    expect(wide.loads[0]).toMatchObject({x:12,y:2});
    expect(wide.supports[0]).toMatchObject({x:0,x2:0,y2:4});
    expect(wide.avoidedRegions[0]).toMatchObject({x:4,y:1,width:4,height:2});
    const tall={...wide,...resizeMesh(wide,'nely',8)};
    expect(tall.loads[0]).toMatchObject({x:12,y:4});
    expect(tall.supports[0]).toMatchObject({x:0,x2:0,y2:8});
    expect(tall.avoidedRegions[0]).toMatchObject({x:4,y:2,width:4,height:4});
    expect(validate(tall)).toEqual([]);
  });
  it('preserves a one-cell region on the far boundary when shrinking either axis',()=>{
    const c=preset();
    c.avoidedRegions=[region({x:59,y:29,width:1,height:1})];
    const short={...c,...resizeMesh(c,'nelx',2)};
    const small={...short,...resizeMesh(short,'nely',2)};
    expect(small.avoidedRegions[0]).toEqual(region({x:1,y:1,width:1,height:1}));
    expect(small.loads[0]).toMatchObject({x:2,y:1});
    expect(small.supports[0]).toMatchObject({y2:2});
    expect(validate(small)).toEqual([]);
  });
  it('rounds and clamps mesh dimensions without mutating the input',()=>{
    const c=preset();
    expect(resizeMesh(c,'nelx',999).nelx).toBe(200);
    expect(resizeMesh(c,'nely',999).nely).toBe(100);
    expect(resizeMesh(c,'nelx',0).nelx).toBe(2);
    expect(resizeMesh(c,'nely',3.6).nely).toBe(4);
    expect(c).toEqual(preset());
    expect(()=>resizeMesh(c,'nely',NaN)).toThrow();
  });
});

describe('passive-void MATLAB export',()=>{
  it.each([1,2] as const)('exports all enforcement blocks for filter %i',ft=>{
    const c=smallConfig();
    c.ft=ft;
    c.avoidedRegions=[region()];
    const out=generate(c);
    const domain=out.domain;
    expect(out.command).toBe(`top88(6,4,0.5,3,1.5,${ft});`);
    expect(domain).toContain('passive = false(nely,nelx);');
    expect(domain).toContain('passive(2:3,3:4) = true;');
    expect(domain).toContain('active = ~passive;');
    expect(domain).toContain('targetVolume = volfrac*nnz(active);');
    expect(domain).toContain('x(passive) = 0;');
    expect(domain.match(/xPhys\(passive\) = 0;/g)).toHaveLength(2);
    expect(domain).toContain('xnew(active) = max(');
    expect(domain).toContain('dc(active)./dv(active)');
    expect(domain).not.toContain('sqrt(-dc./dv');
    const filtering=domain.indexOf('% 2.');
    const oc=domain.indexOf('% 3.');
    const sensitivity=domain.slice(filtering,oc);
    expect(sensitivity.indexOf('dc(passive) = 0;')).toBeLessThan(sensitivity.indexOf('dc(:) = H*(dc(:)./Hs);'));
    expect(sensitivity.indexOf('dv(passive) = 0;')).toBeLessThan(sensitivity.indexOf('dv(:) = H*(dv(:)./Hs);'));
    const iteration=domain.slice(oc);
    const start=iteration.indexOf('while (l2-l1)');
    const zeroDesign=iteration.indexOf('xnew(passive) = 0;');
    const densityFilter=iteration.indexOf('xPhys(:) = (H*xnew(:))./Hs;');
    const zeroPhysical=iteration.indexOf('xPhys(passive) = 0;');
    const volumeCheck=iteration.indexOf('if sum(xPhys(:)) > targetVolume');
    expect(start).toBeLessThan(zeroDesign);
    expect(zeroDesign).toBeLessThan(densityFilter);
    expect(densityFilter).toBeLessThan(zeroPhysical);
    expect(zeroPhysical).toBeLessThan(volumeCheck);
    expect(iteration).toContain('change = max(abs(xnew(:)-x(:)));\nx = xnew;');
  });
  it('exports overlapping rectangles as assignments into a logical union',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region(),region({id:'R2',x:3,y:2})];
    const domain=generate(c).domain;
    expect(domain).toContain('passive(2:3,3:4) = true;');
    expect(domain).toContain('passive(3:4,4:5) = true;');
    expect(domain).toContain('volfrac*nnz(active)');
    expect(domain).not.toContain('volfrac*nelx*nely');
  });
  it.each([1,2] as const)('bounds an inactive volume search for filter %i',ft=>{
    const c=smallConfig();
    c.ft=ft;
    c.volfrac=1;
    c.avoidedRegions=[region()];
    const domain=generate(c).domain;
    expect(domain).toContain('ocIterations = 0;');
    expect(domain).toContain('while (l2-l1)/max(l1+l2,eps) > 1e-3 && ocIterations < 100');
    expect(domain).toContain('ocIterations = ocIterations+1;');
    // If every candidate fits under an unattainable upper volume bound, l1
    // remains zero. Exercise the emitted stopping rule in that exact case.
    const limit=Number(domain.match(/ocIterations < (\d+)/)?.[1]);
    let l1=0,l2=1e9,iterations=0;
    while ((l2-l1)/Math.max(l1+l2,Number.EPSILON)>1e-3&&iterations<limit) {
      iterations++;
      l2=(l2+l1)/2;
    }
    expect(iterations).toBeGreaterThan(0);
    expect(iterations).toBeLessThanOrEqual(100);
    expect(l2).toBeGreaterThan(0);
    expect(Number.isFinite(l2)).toBe(true);
    expect((l2-l1)/Math.max(l1+l2,Number.EPSILON)).toBeLessThanOrEqual(1e-3);
  });
  it.each([
    ['constant sensitivity',Array(20).fill(1e12) as number[]],
    // Independent dense Python solve of the supplied KE/edof formulas for this
    // 10x2 cantilever, in MATLAB column-major order. This is not a MATLAB run.
    ['10x2 cantilever sensitivity',[
      283612924136.8443,283612924136.83954,
      238030864383.8663,238030864383.862,
      183387975557.253,183387975557.24878,
      138905738840.594,138905738840.5865,
      100288350891.88667,100288350891.89417,
      68180302273.33721,68180302273.35971,
      42496827074.65318,42496827074.63818,
      23181411106.148594,23181411106.118595,
      10499352902.31065,10499352902.430649,
      4527369190.172632,4527369190.352632,
    ]],
  ] as const)('brackets the OC volume target with large %s',(_name,ratios)=>{
    const c:Config={
      ...preset(),nelx:10,nely:2,volfrac:.05,rmin:1,
      loads:[{id:'L1',x:10,y:1,fx:0,fy:-100}],
      supports:[{id:'S1',x:0,y:0,x2:0,y2:2,ux:true,uy:true}],
    };
    const output=generate(c);
    const bracket='l2 = max(1e9,max(-dc(active)./dv(active)));';
    expect(output.domain).toContain(bracket);
    expect(output.full).toContain(bracket);

    // The constant case has an exact solution at multiplier 1e12. Both cases
    // require a multiplier beyond the old 1e9 bound to meet the volume target.
    const target=c.volfrac*ratios.length;
    const candidate=(multiplier:number) => ratios.map(ratio=>
      Math.max(0,Math.max(c.volfrac-.2,Math.min(1,Math.min(c.volfrac+.2,
        c.volfrac*Math.sqrt(ratio/multiplier))))));
    const upper=Math.max(1e9,...ratios);
    expect(candidate(upper).every(x=>x<=c.volfrac)).toBe(true);
    expect(candidate(1e9).reduce((sum,x)=>sum+x,0)).toBeGreaterThan(4*target);

    const update=(initialUpper:number) => {
      let lower=0,upper=initialUpper,iterations=0;
      let volume=0;
      while ((upper-lower)/Math.max(lower+upper,Number.EPSILON)>1e-3&&iterations<100) {
        iterations++;
        const multiplier=(lower+upper)/2;
        volume=candidate(multiplier).reduce((sum,x)=>sum+x,0);
        if (volume>target) lower=multiplier;
        else upper=multiplier;
      }
      return {volume,iterations};
    };
    expect(update(1e9).volume).toBeGreaterThan(4*target);
    const result=update(upper);
    expect(Math.abs(result.volume-target)/target).toBeLessThan(.001);
    expect(result.iterations).toBeLessThan(100);
  });
  it('supports the uncut mesh and documents exact insertion locations',()=>{
    const domain=generate(preset()).domain;
    expect(domain).toContain('passive = false(nely,nelx);');
    expect(domain).not.toMatch(/passive\(\d/);
    expect(domain).toContain('Under INITIALIZE ITERATION');
    expect(domain).toContain('Replace the complete FILTERING/MODIFICATION OF SENSITIVITIES block');
    expect(domain).toContain('Replace the complete OPTIMALITY CRITERIA UPDATE block');
    expect(domain).toContain('through x = xnew');
    expect(domain).toContain('Emin remains in the FE model');
  });
});

describe('complete MATLAB top88.m export',()=>{
  const originalBlock=(start:string,end?:string) => {
    const from=TOP88_TEMPLATE.indexOf(start);
    const to=end===undefined?TOP88_TEMPLATE.length:TOP88_TEMPLATE.indexOf(end,from);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    return TOP88_TEMPLATE.slice(from,to);
  };
  const deindent=(text:string) => text.split('\n').map(line=>line.replace(/^  /,'')).join('\n');

  it('retains one original function signature and replaces all default MBB constraints',()=>{
    const c=smallConfig();
    c.loads.push({id:'L2',x:5,y:1,fx:2,fy:0});
    const {full,section}=generate(c);
    expect(full.match(/^function top88\(nelx,nely,volfrac,penal,rmin,ft\)$/gm)).toHaveLength(1);
    expect(full).toContain(section+'\n%% PREPARE FILTER');
    expect(full).not.toContain('DEFINE LOADS AND SUPPORTS (HALF MBB-BEAM)');
    expect(full).not.toContain('F = sparse(2,1,-1,2*(nely+1)*(nelx+1),1);');
    expect(full).not.toContain('fixeddofs = union(');
    expect(full.match(/^F = sparse\(ndof,1\);$/gm)).toHaveLength(1);
    expect(full.match(/^fixeddofs = \[\];$/gm)).toHaveLength(1);
    expect(full).toContain('F(2*n-1) = F(2*n-1) + (2);');
    expect(full).toContain('F(2*n) = F(2*n) + (-1);');
    expect(full).not.toMatch(/\{\{|\}\}|\$\{|TODO|PLACEHOLDER/);
  });

  it.each([1,2] as const)('embeds exactly the three manual domain blocks for filter %i',ft=>{
    const c=smallConfig();
    c.ft=ft;
    c.avoidedRegions=[region()];
    const {full,domain}=generate(c);
    const initialization=domain.slice(domain.indexOf('passive = false(nely,nelx);'),domain.indexOf('\n\n% 2.'));
    const sensitivity=domain.slice(domain.indexOf('% Mask physical derivatives'),domain.indexOf('\n\n% 3.'));
    const oc=domain.slice(domain.indexOf('l1 = 0;'));
    expect(full).toContain('%% INITIALIZE ITERATION\n'+initialization+'\nloop = 0;\nchange = 1;');
    expect(deindent(full)).toContain('%% FILTERING/MODIFICATION OF SENSITIVITIES\n'+sensitivity);
    expect(deindent(full)).toContain('%% OPTIMALITY CRITERIA UPDATE OF DESIGN VARIABLES AND PHYSICAL DENSITIES\n'+oc);
    expect(full.match(/^passive = false\(nely,nelx\);$/gm)).toHaveLength(1);
    expect(full.match(/^  dc\(passive\) = 0;$/gm)).toHaveLength(1);
    expect(full.match(/^  l1 = 0;$/gm)).toHaveLength(1);
    expect(full.match(/^  ocIterations = 0;$/gm)).toHaveLength(1);
    expect(full).toContain('while (l2-l1)/max(l1+l2,eps) > 1e-3 && ocIterations < 100');
    const filterReady=full.indexOf('Hs = sum(H,2);');
    const initialized=full.indexOf('passive = false(nely,nelx);');
    const iteration=full.indexOf('while change > 0.01');
    expect(filterReady).toBeLessThan(initialized);
    expect(initialized).toBeLessThan(full.indexOf('xPhys = reshape((H*x(:))./Hs,nely,nelx);'));
    expect(full.indexOf('xPhys(passive) = 0;')).toBeLessThan(iteration);
    const ocStart=full.indexOf('  ocIterations = 0;');
    const physicalMask=full.indexOf('    xPhys(passive) = 0;',ocStart);
    expect(physicalMask).toBeGreaterThan(full.indexOf('xPhys(:) = (H*xnew(:))./Hs;',ocStart));
    expect(physicalMask).toBeLessThan(full.indexOf('if sum(xPhys(:)) > targetVolume',ocStart));
  });

  it('preserves all untouched material, FE, filter, objective, reporting, plotting, and credit sections',()=>{
    const full=generate(smallConfig()).full;
    for (const [start,end] of [
      ['%% MATERIAL PROPERTIES','% DEFINE LOADS AND SUPPORTS (HALF MBB-BEAM)'],
      ['%% PREPARE FILTER','%% INITIALIZE ITERATION'],
      ['%% START ITERATION','  %% FILTERING/MODIFICATION OF SENSITIVITIES'],
      ['  %% PRINT RESULTS',undefined],
    ]) expect(full).toContain(originalBlock(start!,end));
    expect(full).toContain('% This Matlab code was written by E. Andreassen, A. Clausen, M. Schevenels,%');
    expect(full).toContain('% Disclaimer:');
    expect(full.endsWith(originalBlock('%\n%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%'))).toBe(true);
  });

  it('keeps the MATLAB solve backslash and fprintf escaped newline literal',()=>{
    const full=generate(smallConfig()).full;
    expect(full).toContain(String.raw`U(freedofs) = K(freedofs,freedofs)\F(freedofs);`);
    expect(full).not.toContain(String.raw`K(freedofs,freedofs)\\F(freedofs)`);
    expect(full).toContain(String.raw`fprintf(' It.:%5i Obj.:%11.4f Vol.:%7.3f ch.:%7.3f\n',loop,c, ...`);
    expect(full).not.toContain("ch.:%7.3f\n',loop,c");
    expect(full).toContain('xnew(active) = max(0,max(x(active)-move,min(1,min(x(active)+move, ...\n      x(active).*sqrt(-dc(active)./dv(active)/lmid)))));');
  });

  it('encodes configured defaults and guards the compiled mesh before FE setup',()=>{
    const c=smallConfig();
    c.volfrac=.37;
    c.penal=2.4;
    c.rmin=3.1;
    c.ft=2;
    const full=generate(c).full;
    expect(full).toContain('if nargin == 0\n  nelx = 6;\n  nely = 4;\n  volfrac = 0.37;\n  penal = 2.4;\n  rmin = 3.1;\n  ft = 2;\nelseif nargin ~= 6');
    expect(full).toContain("error('FORM:Arguments','Use top88() or top88(nelx,nely,volfrac,penal,rmin,ft).');");
    expect(full).toContain('nelx == 6 && nely == 4)');
    expect(full).toContain('This export requires nelx=6 and nely=4. Regenerate for another mesh.');
    expect(full.indexOf("error('FORM:Mesh'")).toBeLessThan(full.indexOf('%% MATERIAL PROPERTIES'));
    for (const key of ['nelx','nely','volfrac','penal','rmin','ft']) {
      expect(full).toContain(`isnumeric(${key}) && isreal(${key}) && isscalar(${key}) && isfinite(${key})`);
      expect(full).toContain(`${key} = double(${key});`);
    }
    expect(full).toContain('volfrac >= 0.05 && volfrac <= 1)');
    expect(full).toContain('penal >= 1 && penal <= 6)');
    expect(full).toContain('rmin >= 1 && rmin <= 10)');
    expect(full).toContain('ismember(ft,[1 2])');
  });

  it('supports an uncut full mesh without residual region assignments',()=>{
    const full=generate(preset()).full;
    expect(full).toContain('passive = false(nely,nelx);\nactive = ~passive;');
    expect(full).not.toMatch(/passive\(\d/);
    expect(full).toContain('targetVolume = volfrac*nnz(active);');
    expect(full).not.toContain('volfrac*nelx*nely');
  });

  it('has balanced control-flow blocks with matching indentation at source boundaries',()=>{
    const c=smallConfig();
    c.avoidedRegions=[region()];
    const full=generate(c).full;
    const stack:{kind:string;indentation:number}[]=[];
    for (const line of full.split('\n')) {
      const text=line.trim();
      const indentation=line.length-line.trimStart().length;
      const opener=/^(if|for|while)\b/.exec(text);
      if (opener) stack.push({kind:opener[1],indentation});
      else if (/^(else|elseif)\b/.test(text)) {
        expect(stack.at(-1)).toEqual({kind:'if',indentation});
      } else if (text==='end') {
        expect(stack.pop()?.indentation).toBe(indentation);
      }
    }
    expect(stack).toEqual([]);
  });

  it.each([
    TOP88_TEMPLATE.replace('%% MATERIAL PROPERTIES','%% RENAMED MATERIAL PROPERTIES'),
    TOP88_TEMPLATE.replace('loop = 0;','loop = 1;'),
    TOP88_TEMPLATE+'\nx = repmat(volfrac,nely,nelx);',
    TOP88_TEMPLATE+'\n%% PREPARE FILTER',
  ])('fails loudly when source replacement markers disappear or become ambiguous',async template=>{
    vi.resetModules();
    vi.doMock('./top88-template',()=>({TOP88_TEMPLATE:template}));
    try {
      const freshModel=await import('./model');
      expect(()=>freshModel.generate(smallConfig())).toThrow('Cannot locate unique top88 source block:');
    } finally {
      vi.doUnmock('./top88-template');
      vi.resetModules();
    }
  });
});

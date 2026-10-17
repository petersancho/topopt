# MATLAB TopOpt Configurator & Exporter

A local Vite + React + TypeScript configurator using Zustand. It generates inputs for the MATLAB top88 educational SIMP solver. It does not solve finite element equations or display optimized topology.

## Setup

Install Node.js 20.19+ (or Node 22 LTS), then open a terminal in this folder:

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. For verification and a production build:

```sh
npm test
npm run build
npm run preview
```

A pnpm lockfile is included; alternatively use `pnpm install --frozen-lockfile`.

## Workflow

1. Choose Cantilever, Half MBB, or Simply supported. A preset replaces the current configuration.
2. Adjust mesh and SIMP sliders. Mesh changes scale and snap load, support, and avoided-region coordinates.
3. Under Avoided regions, choose **+ Region** to add a rectangular area that stays empty. Select a region, then adjust its x, y, width, and height sliders. Drag its crosshatched body to move it or its square handle to resize it. Overlapping regions count only once.
4. Select a load or support using its dropdown or diagram. Drag a load's outlined circle to a node; drag the dotted arrow endpoint to adjust force components. Drag a support's hatched body to move it, or its square handle to resize its inclusive rectangular node region. The inspector also provides numeric fields, constraint direction checkboxes, and add/remove controls. Use **Command-C / Command-V** (or Ctrl-C / Ctrl-V) to duplicate a selected load or support. Copies retain forces or constraints, get unique IDs, and shift within the mesh. Repeated pastes offset successive copies. Shortcuts leave text fields and selected text to the browser.
5. Expand MATLAB export and resolve validation messages. **Full MATLAB script**, **Loads & supports**, **Design domain**, and **top88 command** each have Copy and Download controls. Invalid configurations are flagged even while the export is collapsed.
6. The simplest export is **Full MATLAB script**: save it as `top88.m`, then run `top88()` in MATLAB. It includes the complete solver supplied in the conversation, configured loads/supports, avoided regions, and all optimization updates. Calling with no arguments uses the exported settings; the six-argument command also works. The file rejects a different mesh size, since object coordinates belong to the exported mesh. Regenerate it after editing the design. Original authorship and disclaimer are preserved.
7. To patch an existing copy instead, start with the original [top88.m from DTU](https://www.topopt.mek.dtu.dk/apps-and-software/efficient-topology-optimization-in-matlab). Replace `% DEFINE LOADS AND SUPPORTS ...` through `freedofs` with the Loads & supports export. For avoided regions, also apply **all three** numbered replacements in Design domain: initialization, sensitivity filtering, and the complete OC update. These individual sections are patches to separate parts of `top88.m`, not a standalone script. Their comments identify exact replacement boundaries. Run the exported command from the folder containing the patched solver. Regenerate all sections after changing the mesh.
8. Save/open a JSON project to transfer the full configuration. Existing version 1 JSON without avoided regions still imports, with an empty region list. Files are processed locally; there is no backend.

## Conventions and validation

Mesh coordinates are integer **node** coordinates: x = 0…nelx from left to right; row y = 0…nely from top to bottom. MATLAB node ID is `x*(nely+1)+y+1`, with DOFs `[2*n-1, 2*n]`. Fx is positive right and Fy is positive up. All forces are dimensionless relative forces in one simultaneous load case. Coincident loads add, including cancellation. Supports select every node in inclusive bounds and independently constrain X/Y displacements.

Avoided rectangles use integer **cell** coordinates: x = 0…nelx−1 and y = 0…nely−1, with positive width and height measured in elements. A rectangle covers cells x…x+width−1 and y…y+height−1. MATLAB element ID is `x*nely+y+1`. The export writes the union to a logical passive mask. Volume fraction is the material budget relative to **available cells**, excluding avoided cells.

The design-domain export freezes both design variables and physical densities to zero in avoided cells. For density filtering, physical sensitivities are masked before the filter chain rule, and passive physical densities are reset after filtering inside every OC volume bisection. The OC search updates only available variables, uses the available-cell volume target, and has a bounded iteration count. The FE mesh retains the original solver's small `Emin` stiffness in empty cells; elements are not removed from assembly.

The generator checks parameter ranges, finite values, bounds, nonzero summed nodal forces, forces on constrained DOFs, and rank of the support constraint matrix against the three planar rigid motions. Overlapping supports are deduplicated. Avoided regions cannot fill the entire domain; load resultants and support nodes must touch an available cell. Import requires version 1, the documented numeric/boolean schema, unique safe object IDs across all kinds, and a valid model. Up to 100 loads, supports, and avoided regions are allowed per kind. These checks do not establish the stability of separate components created by holes or the final optimized shape. MATLAB remains responsible for solver convergence, conditioning, connectivity, and interpreting optimized results.

A small filter radius can produce mesh-dependent designs. Support boxes are boundary constraints; use Avoided regions for passive voids. Rectangular support interiors may intentionally constrain many nodes. Penalization and filter settings are passed directly to top88; the available-cell volume convention requires applying the Design domain patch when regions exist. No projection, continuation, passive-solid regions, or multiple load-case solver changes are implied.

Tests cover column-major cell/node numbering, region overlap and bounds, mesh scaling, legacy JSON migration, load/support validation, domain export enforcement, bounded volume bisection, and clipboard snapshots, identifiers, repeated paste offsets, dimensions, bounds, and malformed payloads. No MATLAB runtime is bundled; generated snippets require verification in your MATLAB environment.

The UI uses Helvetica with an Arial fallback, a black-and-white palette, and a minimal workspace inspired by early Macintosh controls. It has a plain app title; project controls are beside the parameters, and MATLAB export opens on demand. All functional features work locally after dependencies are installed.

Design reference: Apple's [Human Interface Guidelines (1987)](https://andymatuschak.org/files/papers/Apple%20Human%20Interface%20Guidelines%201987.pdf), especially simplicity, aesthetic integrity, and standard controls. Helvetica is a deliberate adaptation to the requested typeface.

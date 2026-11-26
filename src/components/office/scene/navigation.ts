import { GLASS_THICKNESS, WALL_THICKNESS, type FloorPlan, type Rect, type Vec2, type WallSegment } from "./plan";

const SQRT2 = Math.SQRT2;

function segmentsIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
  const cx = a.x + dx * t, cz = a.z + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

/** Minimal binary min-heap keyed by f-score, storing cell indices. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() { return this.items.length; }
  clear() { this.items.length = 0; this.keys.length = 0; }
  push(item: number, key: number) {
    const items = this.items, keys = this.keys;
    let i = items.length;
    items.push(item); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p]; keys[i] = keys[p];
      i = p;
    }
    items[i] = item; keys[i] = key;
  }
  pop(): number {
    const items = this.items, keys = this.keys;
    const top = items[0];
    const lastItem = items.pop()!, lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        items[i] = items[m]; keys[i] = keys[m];
        i = m;
      }
      items[i] = lastItem; keys[i] = lastKey;
    }
    return top;
  }
}

/**
 * Static occupancy grid over the office floor (precomputed once). Walls, glass partitions and furniture are
 * inflated by the character radius; doorways stay open. A* runs 8-connected without corner cutting and the
 * result is string-pulled with line-of-sight checks.
 */
export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;
  private readonly heap = new Heap();
  private readonly walls: WallSegment[];

  readonly bounds: Rect;

  constructor(floor: Pick<FloorPlan, "bounds" | "walls" | "obstacles" | "doorways">, cell = 0.4, radius = 0.3) {
    const { bounds, walls, obstacles, doorways } = floor;
    this.cell = cell;
    this.bounds = bounds;
    this.walls = walls;
    this.cols = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cell));
    this.rows = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / cell));
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = bounds.minX + (c + 0.5) * cell, z = bounds.minZ + (r + 0.5) * cell;
        let block = false;
        for (const w of walls) {
          const half = (w.kind === "glass" ? GLASS_THICKNESS : WALL_THICKNESS) / 2;
          if (distToSegment(x, z, w.a, w.b) < half + radius) { block = true; break; }
        }
        if (!block) {
          for (const o of obstacles) {
            if (x > o.minX - radius && x < o.maxX + radius && z > o.minZ - radius && z < o.maxZ + radius) { block = true; break; }
          }
        }
        this.blocked[r * this.cols + c] = block ? 1 : 0;
      }
    }
    // Guarantee doorways are passable even if the inflated frame posts touch them.
    for (const d of doorways) {
      const steps = Math.ceil(Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z) / (cell / 2));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = d.a.x + (d.b.x - d.a.x) * t, z = d.a.z + (d.b.z - d.a.z) * t;
        if (Math.min(distToSegment(x, z, d.a, d.a), distToSegment(x, z, d.b, d.b)) < radius) continue;
        const idx = this.indexAt(x, z);
        if (idx >= 0) this.blocked[idx] = 0;
      }
    }
  }

  /** True if the segment a→b intersects any wall or partition (doorways are gaps between segments). */
  crossesWall(ax: number, az: number, bx: number, bz: number): boolean {
    for (const w of this.walls) {
      const pad = (w.kind === "glass" ? GLASS_THICKNESS : WALL_THICKNESS) / 2 + 0.12;
      // Extend each wall slightly past its ends so characters cannot clip door jambs.
      const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = (dx / len) * pad, uz = (dz / len) * pad;
      if (segmentsIntersect(ax, az, bx, bz, w.a.x - ux, w.a.z - uz, w.b.x + ux, w.b.z + uz)) return true;
    }
    return false;
  }

  indexAt(x: number, z: number): number {
    const c = Math.floor((x - this.bounds.minX) / this.cell), r = Math.floor((z - this.bounds.minZ) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  centerOf(idx: number): Vec2 {
    const c = idx % this.cols, r = (idx / this.cols) | 0;
    return { x: this.bounds.minX + (c + 0.5) * this.cell, z: this.bounds.minZ + (r + 0.5) * this.cell };
  }

  walkable(x: number, z: number): boolean {
    const idx = this.indexAt(x, z);
    return idx >= 0 && this.blocked[idx] === 0;
  }

  /** Nearest walkable cell to a point (spiral search), or -1. */
  nearestWalkable(x: number, z: number, maxRings = 8, extra?: (idx: number) => boolean): number {
    const c0 = Math.floor((x - this.bounds.minX) / this.cell), r0 = Math.floor((z - this.bounds.minZ) / this.cell);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring <= maxRings; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const idx = r * this.cols + c;
          if (this.blocked[idx] || (extra && extra(idx))) continue;
          const p = this.centerOf(idx);
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Straight segment stays on walkable cells (sampled every ~cell/3). */
  lineOfSight(ax: number, az: number, bx: number, bz: number, extra?: (idx: number) => boolean): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (this.cell / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const idx = this.indexAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (idx < 0 || this.blocked[idx] || (extra && extra(idx))) return false;
    }
    return true;
  }

  /**
   * A* from (sx, sz) to (gx, gz). Start/goal snap to the nearest walkable cell; the returned path begins at the
   * exact start and ends at the exact goal. `extra` marks temporarily blocked cells (e.g. standing characters).
   */
  findPath(sx: number, sz: number, gx: number, gz: number, extra?: (idx: number) => boolean): Vec2[] | null {
    const start = this.nearestWalkable(sx, sz, 6);
    const goal = this.nearestWalkable(gx, gz, 8, extra) >= 0 ? this.nearestWalkable(gx, gz, 8, extra) : this.nearestWalkable(gx, gz, 8);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: sx, z: sz }, { x: gx, z: gz }];

    const cols = this.cols, rows = this.rows;
    const blocked = this.blocked, g = this.g, parent = this.parent, stamp = this.stamp, closed = this.closed;
    const id = ++this.search;
    const goalC = goal % cols, goalR = (goal / cols) | 0;
    const h = (idx: number) => {
      const dc = Math.abs((idx % cols) - goalC), dr = Math.abs(((idx / cols) | 0) - goalR);
      return (dc + dr) + (SQRT2 - 2) * Math.min(dc, dr);
    };
    const isFree = (idx: number) => blocked[idx] === 0 && (idx === goal || idx === start || !extra || !extra(idx));

    const heap = this.heap;
    heap.clear();
    stamp[start] = id; g[start] = 0; parent[start] = -1;
    heap.push(start, h(start));
    let found = false;
    let iterations = 0;
    while (heap.size > 0 && iterations++ < 60000) {
      const cur = heap.pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === goal) { found = true; break; }
      const c = cur % cols, r = (cur / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const nIdx = nr * cols + nc;
          if (!isFree(nIdx) || closed[nIdx] === id) continue;
          if (dr && dc && (!isFree(r * cols + nc) || !isFree(nr * cols + c))) continue; // no corner cutting
          const ng = g[cur] + (dr && dc ? SQRT2 : 1);
          if (stamp[nIdx] !== id || ng < g[nIdx]) {
            stamp[nIdx] = id; g[nIdx] = ng; parent[nIdx] = cur;
            heap.push(nIdx, ng + h(nIdx));
          }
        }
      }
    }
    if (!found) return null;

    const cells: Vec2[] = [];
    for (let idx = goal; idx !== -1; idx = parent[idx]) cells.push(this.centerOf(idx));
    cells.reverse();
    const raw: Vec2[] = [{ x: sx, z: sz }, ...cells, { x: gx, z: gz }];
    return this.stringPull(raw, extra);
  }

  /** Greedy string-pulling: keep the farthest visible waypoint from each anchor. Endpoints are preserved. */
  private stringPull(path: Vec2[], extra?: (idx: number) => boolean): Vec2[] {
    if (path.length <= 3) return path;
    const inner = path.slice(1, -1);
    const out: Vec2[] = [path[0], inner[0]];
    let anchor = 0;
    while (anchor < inner.length - 1) {
      let next = anchor + 1;
      for (let j = inner.length - 1; j > anchor + 1; j--) {
        if (this.lineOfSight(inner[anchor].x, inner[anchor].z, inner[j].x, inner[j].z, extra)) { next = j; break; }
      }
      out.push(inner[next]);
      anchor = next;
    }
    out.push(path[path.length - 1]);
    // Drop the first snapped cell if the start can see the second waypoint directly.
    if (out.length > 2 && this.lineOfSight(out[0].x, out[0].z, out[2].x, out[2].z, extra)) out.splice(1, 1);
    // Likewise the last snapped cell before the exact goal.
    const L = out.length;
    if (L > 2 && this.lineOfSight(out[L - 3].x, out[L - 3].z, out[L - 1].x, out[L - 1].z, extra)) out.splice(L - 2, 1);
    return out;
  }
}

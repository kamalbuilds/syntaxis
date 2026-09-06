import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
const SPHERE = new THREE.SphereGeometry(0.5, 24, 16);

function materialOf(spec, wear = 0) {
  const params = {
    color: new THREE.Color(spec.color),
    roughness: THREE.MathUtils.clamp(spec.roughness + wear * 0.25, 0.02, 1),
    metalness: spec.metalness,
  };
  if (spec.emissive > 0) {
    params.emissive = new THREE.Color(spec.color);
    params.emissiveIntensity = spec.emissive;
  }
  if (spec.transmission > 0) {
    return new THREE.MeshPhysicalMaterial({
      ...params,
      transmission: spec.transmission,
      thickness: 1.2,
      ior: 1.4,
      transparent: true,
      opacity: spec.opacity,
    });
  }
  return new THREE.MeshStandardMaterial({
    ...params,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
  });
}

// Labels are not decoration. The whole claim of the project is that a syntactic
// role became a piece of geometry, and the label is the receipt for that claim.
function makeLabel(word, relation) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 160);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '600 62px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(word, 256, 72);
  ctx.fillStyle = '#c86a3a';
  ctx.font = '500 30px "SF Mono", ui-monospace, Menlo, monospace';
  ctx.fillText(relation.toUpperCase(), 256, 122);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: true, depthWrite: false,
  }));
  sprite.scale.set(6.4, 2, 1);
  return sprite;
}

/** Floor profile per verb topology. The ground itself carries the predicate. */
export function floorSampler(plan) {
  const kind = plan.floor;
  // A low, slow swell under every topology. Without it the ground reads as an
  // untouched default plane, which is the tell of a scene nobody art-directed.
  const relief = (x, z) => Math.sin(x * 0.031) * Math.cos(z * 0.037) * 0.85
    + Math.sin((x + z) * 0.017) * 0.55;
  return (x, z) => relief(x, z) + (() => {
    switch (kind) {
      case 'runway':
        return THREE.MathUtils.clamp(z, -30, 30) * -0.055;
      case 'gap':
        return Math.abs(x) < 6 ? -6 : 0;
      case 'dome':
        return -Math.max(0, 1 - (x * x + z * z) / 900) * 2.2;
      case 'terraces':
        return Math.floor((x + z + 40) / 9) * 0.95 - 4.2;
      case 'fracture': {
        const c = Math.sin(x * 0.21) * Math.cos(z * 0.19);
        return c > 0.55 ? -5.5 : c * 1.1;
      }
      case 'rings': {
        const r = Math.hypot(x, z);
        return -Math.floor(r / 6) * 0.55;
      }
      default:
        return Math.hypot(x, z) < 5 ? 0.55 : 0;
    }
  })();
}

function buildGround(plan, sample) {
  const extent = Math.max(90, plan.scene.extent * 2.6);
  const seg = 120;
  const geo = new THREE.PlaneGeometry(extent, extent, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    pos.setY(i, sample(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x6c665b, roughness: 0.96, metalness: 0,
  }));
  mesh.receiveShadow = true;
  return mesh;
}

function shellOf(room, mat) {
  // Five slabs: floor, back, two sides, roof. The face toward the hall centre is
  // left open so the volume is enterable rather than a sealed box.
  const g = new THREE.Group();
  const [w, h, d] = room.size;
  const t = Math.min(0.42, w * 0.09);
  const add = (sx, sy, sz, px, py, pz) => {
    const m = new THREE.Mesh(BOX, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(w, t, d, 0, -h / 2 + t / 2, 0);
  if (!room.hollow) add(w, t, d, 0, h / 2 - t / 2, 0);
  add(t, h, d, -w / 2 + t / 2, 0, 0);
  add(t, h, d, w / 2 - t / 2, 0, 0);

  if (room.bored) {
    // A bored wall is built as two jambs and a lintel, which is a real opening
    // rather than a texture of one.
    const openW = Math.min(w * 0.42, 3.4);
    const openH = Math.min(h * 0.62, 4.6);
    const side = (w - openW) / 2;
    add(side, h, t, -(w - side) / 2, 0, -d / 2 + t / 2);
    add(side, h, t, (w - side) / 2, 0, -d / 2 + t / 2);
    add(openW, h - openH, t, 0, h / 2 - (h - openH) / 2, -d / 2 + t / 2);
  } else {
    add(w, h, t, 0, 0, -d / 2 + t / 2);
  }
  return g;
}

function fractureShards(room, mat, rand) {
  const g = new THREE.Group();
  const n = 5;
  for (let i = 0; i < n; i += 1) {
    const m = new THREE.Mesh(BOX, mat);
    const s = Math.max(...room.size) * (0.12 + rand() * 0.2);
    m.scale.set(s, s * (0.4 + rand()), s);
    m.position.set(
      (rand() - 0.5) * room.size[0] * 1.9,
      -room.size[1] * 0.5 + s * 0.5 + rand() * 0.4,
      (rand() - 0.5) * room.size[2] * 1.9,
    );
    m.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function buildRoom(room, sample, rand) {
  const group = new THREE.Group();
  const mat = materialOf(room.material, room.wear);
  const y = sample(room.position[0], room.position[2]) + room.position[1] + room.size[1] / 2;
  group.position.set(room.position[0], y, room.position[2]);
  group.rotation.y = room.yaw;
  group.rotation.z = room.skew * 0.22;

  if (room.ring) {
    // "around": an actual ring of instances encircling the head volume.
    const { radius, count } = room.ring;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const m = new THREE.Mesh(room.form === 'round' ? CYL : BOX, mat);
      m.scale.set(room.size[0] * 0.5, room.size[1], room.size[2] * 0.5);
      m.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      m.rotation.y = -a;
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  } else {
    const instances = room.straddle ? 2 : Math.min(room.count, 12);
    for (let i = 0; i < instances; i += 1) {
      let node;
      if (room.voidRoom) {
        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(BOX),
          new THREE.LineBasicMaterial({ color: 0x8a8f96, transparent: true, opacity: 0.5 }),
        );
        wire.scale.set(...room.size);
        node = wire;
      } else if (room.form === 'shell') {
        node = shellOf(room, mat);
      } else if (room.form === 'round') {
        const m = new THREE.Mesh(room.size[1] < room.size[0] ? SPHERE : CYL, mat);
        m.scale.set(room.size[0], room.size[1], room.size[2]);
        m.castShadow = true;
        m.receiveShadow = true;
        node = m;
      } else {
        const m = new THREE.Mesh(BOX, mat);
        m.scale.set(room.size[0] * room.taper, room.size[1], room.size[2] * room.taper);
        m.castShadow = true;
        m.receiveShadow = true;
        node = m;
      }
      if (instances > 1) {
        const spanX = room.straddle ? room.size[0] * 2.2 : room.size[0] * 1.35;
        node.position.x = (i - (instances - 1) / 2) * spanX;
        node.position.z = room.straddle ? 0 : (i % 2) * room.size[2] * 0.4;
      }
      group.add(node);
    }
  }

  if (room.fracture) group.add(fractureShards(room, mat, rand));

  if (room.material.emissive > 0.4 && !room.voidRoom) {
    const light = new THREE.PointLight(new THREE.Color(room.material.color), room.material.emissive * 14, Math.max(...room.size) * 6, 2);
    group.add(light);
  }

  // Relations like encircle and nest put two volumes at one point, so labels
  // are staggered by depth and pushed out to the ring to stay readable.
  const label = makeLabel(room.word, room.relation);
  label.position.set(
    room.ring ? room.ring.radius : 0,
    room.size[1] / 2 + 1.9 + room.depth * 1.5,
    0,
  );
  group.add(label);

  return { group, worldY: y };
}

function buildLink(kind, a, b, aY, bY) {
  const from = new THREE.Vector3(a.position[0], aY, a.position[2]);
  const to = new THREE.Vector3(b.position[0], bY, b.position[2]);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const length = from.distanceTo(to);
  if (length < 0.4) return null;

  const mat = new THREE.MeshStandardMaterial({
    color: kind === 'bridge' ? 0x8d8578 : 0x4a4844,
    roughness: 0.85,
    metalness: kind === 'bridge' ? 0.2 : 0,
  });

  if (kind === 'shaft') {
    const m = new THREE.Mesh(BOX, mat);
    m.scale.set(1.4, Math.abs(aY - bY) + 0.6, 1.4);
    m.position.copy(mid);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  if (kind === 'tunnel') {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 1.7, length, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x33312e, roughness: 0.95, side: THREE.BackSide }),
    );
    tube.position.copy(mid);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    return tube;
  }

  const deck = new THREE.Mesh(BOX, mat);
  deck.scale.set(kind === 'bridge' ? 3.6 : 2.6, 0.34, length);
  deck.position.copy(mid);
  deck.position.y -= 0.1;
  deck.lookAt(to.x, deck.position.y, to.z);
  deck.castShadow = true;
  deck.receiveShadow = true;

  if (kind !== 'bridge') return deck;

  const group = new THREE.Group();
  group.add(deck);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(BOX, mat);
    rail.scale.set(0.22, 1.0, length);
    rail.position.copy(deck.position);
    rail.position.y += 0.6;
    rail.quaternion.copy(deck.quaternion);
    rail.translateX(side * 1.7);
    group.add(rail);
  }
  return group;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Instantiates a spatial plan. Returns the group to add to the scene, the
 * colliders a walker must respect, the floor sampler, and the waypoints the
 * reader agent follows in dependency order.
 */
export function buildWorld(plan) {
  const root = new THREE.Group();
  const rand = mulberry32(plan.seed ^ 0x9e3779b9);
  const sample = floorSampler(plan);

  root.add(buildGround(plan, sample));

  const built = new Map();
  for (const room of plan.rooms) {
    const { group, worldY } = buildRoom(room, sample, rand);
    root.add(group);
    built.set(room.id, { room, group, worldY });
  }

  for (const link of plan.links) {
    const a = built.get(link.from);
    const b = built.get(link.to);
    if (!a || !b) continue;
    const mesh = buildLink(link.kind, a.room, b.room, a.worldY - a.room.size[1] / 2 + 0.2, b.worldY - b.room.size[1] / 2 + 0.2);
    if (mesh) root.add(mesh);
  }

  // Only solid volumes block the walker. Shells are meant to be entered, which
  // is the point of building them as shells.
  const colliders = [];
  for (const { room, group } of built.values()) {
    if (room.form !== 'solid' || room.voidRoom || room.ring) continue;
    colliders.push(new THREE.Box3().setFromCenterAndSize(
      group.position.clone(),
      new THREE.Vector3(room.size[0] * 1.05, room.size[1], room.size[2] * 1.05),
    ));
  }

  const waypoints = plan.path
    .map((id) => built.get(id))
    .filter(Boolean)
    .map(({ room, group, worldY }) => ({
      id: room.id,
      word: room.word,
      relation: room.relation,
      adjectives: room.adjectives,
      position: new THREE.Vector3(
        group.position.x,
        worldY - room.size[1] / 2,
        group.position.z + Math.max(4.5, room.size[2] * 0.85),
      ),
      look: group.position.clone(),
    }));

  return { root, colliders, sample, waypoints, built };
}

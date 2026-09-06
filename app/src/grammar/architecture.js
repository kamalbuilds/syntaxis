import { NOUNS, ADJECTIVES, ADVERBS, ELEMENTS, DEFAULT_NOUN } from './lexicon.js';

// Deterministic PRNG. The same sentence must produce the same building on every
// machine and every reload, which is what makes a permalink meaningful.
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

const UNIT = 3.4;          // metres per unit of noun scale
const HALL_RADIUS = 15;

// One topology per verb class. The hall is the sentence's predicate made
// walkable, so a sentence about collapse cannot produce the same room as a
// sentence about building.
const TOPOLOGY = {
  motion: {
    name: 'axial run',
    subject: [0, 0, -HALL_RADIUS],
    object: [0, -1.6, HALL_RADIUS],
    slope: -1.6,
    floor: 'runway',
  },
  transfer: {
    name: 'spanned pair',
    subject: [-HALL_RADIUS, 1.2, 0],
    object: [HALL_RADIUS, 1.2, 0],
    slope: 0,
    floor: 'gap',
  },
  perception: {
    name: 'aperture chamber',
    subject: [0, 0, 4],
    object: [0, 7.5, -HALL_RADIUS - 4],
    slope: 0,
    floor: 'dome',
  },
  creation: {
    name: 'ascending terraces',
    subject: [-8, 0, 6],
    object: [7, 5.5, -6],
    slope: 0,
    floor: 'terraces',
  },
  destruction: {
    name: 'fractured ground',
    subject: [-9, 0, 5],
    object: [8, -2.4, -5],
    slope: 0,
    floor: 'fracture',
  },
  utterance: {
    name: 'concentric rings',
    subject: [0, 0.6, 0],
    object: [0, 0, -HALL_RADIUS + 2],
    slope: 0,
    floor: 'rings',
  },
  state: {
    name: 'plinth chamber',
    subject: [0, 1.1, 0],
    object: [HALL_RADIUS - 3, 0, 0],
    slope: 0,
    floor: 'plinth',
  },
};

// Every preposition resolves to a real offset plus the connective geometry that
// makes the relation legible.
//
// The frame is figure and ground. In "the lamp rests on a table" the lamp is the
// figure and the table is the ground, and it is the *ground* that the parser
// hands over as the child. So the offsets below place the child relative to its
// head as a landmark, which is why `stack` moves the child down: a thing you
// stand on is underneath you.
const RELATIONS = {
  stack:    { offset: (p, c) => [0, -(p.size[1] / 2 + c.size[1] / 2), 0], link: 'shaft' },
  float:    { offset: (p, c) => [0, -(p.size[1] / 2 + c.size[1] / 2 + 3.2), 0], link: 'shaft' },
  sink:     { offset: (p, c) => [0, p.size[1] / 2 + c.size[1] / 2 + 0.6, 0], link: 'shaft' },
  nest:     { offset: () => [0, 0, 0], link: null, container: true },
  pierce:   { offset: (p, c) => [0, 0, -(p.size[2] / 2 + c.size[2] / 2 + 3)], link: 'tunnel', bore: true },
  span:     { offset: (p, c) => [0, -2.6, -(p.size[2] / 2 + c.size[2] / 2 + 7)], link: 'bridge' },
  flank:    { offset: (p, c) => [p.size[0] / 2 + c.size[0] / 2 + 1.4, 0, 0], link: null, elongate: true },
  adjacent: { offset: (p, c) => [p.size[0] / 2 + c.size[0] / 2 + 2.4, 0, 0], link: 'corridor' },
  behind:   { offset: (p, c) => [0, 0, -(p.size[2] / 2 + c.size[2] / 2 + 3)], link: 'corridor' },
  front:    { offset: (p, c) => [0, 0, p.size[2] / 2 + c.size[2] / 2 + 3], link: 'corridor' },
  approach: { offset: (p, c) => [0, 0, -(p.size[2] / 2 + c.size[2] / 2 + 6)], link: 'corridor' },
  depart:   { offset: (p, c) => [0, 0, p.size[2] / 2 + c.size[2] / 2 + 8], link: 'corridor' },
  far:      { offset: (p, c) => [0, 0, -(p.size[2] / 2 + c.size[2] / 2 + 14)], link: 'corridor' },
  encircle: { offset: () => [0, 0, 0], link: null, encircled: true },
  straddle: { offset: () => [0, 0, 0], link: null, straddle: true },
  absent:   { offset: (p, c) => [p.size[0] / 2 + c.size[0] / 2 + 3, 0, 0], link: null, void: true },
  parallel: { offset: (p, c) => [p.size[0] / 2 + c.size[0] / 2 + 3.6, 0, 0], link: 'corridor' },
  oblique:  { offset: (p, c) => [0, 0, p.size[2] / 2 + c.size[2] / 2 + 5], link: 'corridor' },
  sequel:   { offset: () => [0, 0, 0], link: null },
};

function materialFor(profile, adjectives) {
  const base = ELEMENTS[profile.element] || ELEMENTS.plaster;
  const mat = {
    color: base.color,
    roughness: base.roughness,
    metalness: base.metalness,
    transmission: base.transmission || 0,
    emissive: base.emissive || 0,
    opacity: 1,
  };
  for (const adj of adjectives) {
    const a = ADJECTIVES.get(adj);
    if (!a) continue;
    if (a.color !== undefined) mat.color = a.color;
    if (a.roughness !== undefined) mat.roughness = a.roughness;
    if (a.metalness !== undefined) mat.metalness = a.metalness;
    if (a.transmission !== undefined) mat.transmission = a.transmission;
    if (a.emissive !== undefined) mat.emissive = a.emissive;
    if (a.opacity !== undefined) mat.opacity = a.opacity;
  }
  return mat;
}

function sizeFor(profile, adjectives) {
  let s = profile.scale;
  // A column is not a cube. Nouns whose proportion is part of their meaning
  // carry it, and adjectives stretch that rather than replace it.
  const [ax, ay, az] = profile.aspect || [1, 1, 1];
  let sx = ax;
  let sy = ay;
  let sz = az;
  for (const adj of adjectives) {
    const a = ADJECTIVES.get(adj);
    if (!a) continue;
    if (a.scale !== undefined) s *= a.scale;
    if (a.stretchX !== undefined) sx *= a.stretchX;
    if (a.stretchY !== undefined) sy *= a.stretchY;
    if (a.stretchZ !== undefined) sz *= a.stretchZ;
  }
  const base = Math.max(0.9, s) * UNIT;
  return [base * sx, base * sy * 0.85, base * sz];
}

function flagsFor(adjectives) {
  const f = { hollow: false, fracture: false, round: false, skew: 0, float: 0, sink: false, taper: 1, wear: 0, repeat: null, far: 1 };
  for (const adj of adjectives) {
    const a = ADJECTIVES.get(adj);
    if (!a) continue;
    if (a.hollow) f.hollow = true;
    if (a.fracture) f.fracture = true;
    if (a.round) f.round = true;
    if (a.skew !== undefined) f.skew = Math.max(f.skew, a.skew);
    if (a.float !== undefined) f.float = Math.max(f.float, a.float);
    if (a.sink) f.sink = true;
    if (a.taper !== undefined) f.taper = a.taper;
    if (a.wear !== undefined) f.wear = Math.max(f.wear, a.wear);
    if (a.repeat !== undefined) f.repeat = a.repeat;
    if (a.far !== undefined) f.far = a.far;
  }
  return f;
}

function sceneModifiers(adverbs) {
  const scene = { fog: 1, exposure: 1, agentSpeed: 1, cluster: 1, repeatWorld: 1, opacity: 1 };
  for (const adv of adverbs) {
    const a = ADVERBS[adv];
    if (!a) continue;
    if (a.fog !== undefined) scene.fog *= a.fog;
    if (a.exposure !== undefined) scene.exposure *= a.exposure;
    if (a.agentSpeed !== undefined) scene.agentSpeed *= a.agentSpeed;
    if (a.cluster !== undefined) scene.cluster *= a.cluster;
    if (a.repeatWorld !== undefined) scene.repeatWorld = Math.max(scene.repeatWorld, a.repeatWorld);
    if (a.opacity !== undefined) scene.opacity *= a.opacity;
  }
  return scene;
}

/**
 * Turns a dependency tree into a spatial plan: rooms with world positions and
 * materials, connective geometry between them, and the order the reader agent
 * walks them in. No renderer types appear here, so the plan is testable on its
 * own and could drive a different backend.
 */
export function planFrom(parsed) {
  const rnd = mulberry32(parsed.seed);
  const topo = TOPOLOGY[parsed.root.verbClass] || TOPOLOGY.state;
  const scene = sceneModifiers(parsed.scene.adverbs);
  const rooms = [];
  const links = [];
  const path = [];

  const makeRoom = (node, position, depth) => {
    const profile = NOUNS.get(node.lemma) || DEFAULT_NOUN;
    const flags = flagsFor(node.adjectives);
    const size = sizeFor(profile, node.adjectives);
    const material = materialFor(profile, node.adjectives);
    if (node.negated) material.opacity = Math.min(material.opacity, 0.22);

    const room = {
      id: node.id,
      word: node.word,
      lemma: node.lemma,
      relation: node.relation,
      depth,
      count: Math.max(1, flags.repeat ?? node.count),
      position: position.slice(),
      size,
      material,
      mass: profile.mass,
      element: profile.element,
      adjectives: node.adjectives.slice(),
      negated: node.negated,
      known: node.known,
      // A volume tall enough to stand inside is built as an open shell you can
      // walk into. Anything smaller stays a solid mass you walk around.
      form: flags.round ? 'round' : (size[1] >= 3.6 && profile.mass > 0.25 ? 'shell' : 'solid'),
      hollow: flags.hollow || node.negated,
      fracture: flags.fracture || parsed.root.verbClass === 'destruction',
      skew: flags.skew + (parsed.root.verbClass === 'destruction' ? 0.18 : 0),
      wear: flags.wear,
      taper: flags.taper,
      voidRoom: false,
      bored: false,
      yaw: (rnd() - 0.5) * 0.5 * (1 + flags.skew * 3),
    };
    if (flags.float) room.position[1] += flags.float;
    if (flags.sink) room.position[1] -= size[1] * 0.4;
    rooms.push(room);
    path.push(room.id);
    return room;
  };

  const place = (node, parentRoom, depth) => {
    const rel = RELATIONS[node.relation] || RELATIONS.adjacent;
    const profile = NOUNS.get(node.lemma) || DEFAULT_NOUN;
    const provisional = { size: sizeFor(profile, node.adjectives) };
    const off = rel.offset(parentRoom, provisional);
    const spread = scene.cluster;
    const pos = [
      parentRoom.position[0] + off[0] * spread,
      parentRoom.position[1] + off[1],
      parentRoom.position[2] + off[2] * spread,
    ];
    const room = makeRoom(node, pos, depth);

    if (rel.container) {
      // "in", "inside", "of": the child is the container. It is grown until the
      // figure genuinely fits inside it, and opened so you can walk in.
      const needed = Math.max(...parentRoom.size) * 2.1 + 3;
      room.size = room.size.map((v) => Math.max(v, needed));
      room.position = parentRoom.position.slice();
      room.hollow = true;
      room.form = 'shell';
      // The figure sits on the container's floor rather than hovering in it.
      parentRoom.position[1] = room.position[1] - room.size[1] * 0.5 + parentRoom.size[1] * 0.5 + 0.25;
    }
    if (rel.bore) {
      // "through": the hole is bored in the thing passed through, which is the
      // child, and the tunnel runs from the figure into it.
      room.bored = true;
      room.form = 'shell';
      room.hollow = true;
    }
    if (rel.encircled) {
      // "around": the figure is what encircles, so the ring is built from the
      // head and the child sits at its centre.
      room.position = parentRoom.position.slice();
      if (parentRoom.id !== 'hall') {
        parentRoom.size = parentRoom.size.map((v) => v * 0.44);
        const count = Math.max(6, parentRoom.count);
        // The ring has to be wide enough for its members to stand apart. Sized
        // off the landmark alone they fuse into a wall as the count climbs.
        const spacing = parentRoom.size[0] * 1.9;
        parentRoom.ring = {
          of: room.id,
          radius: Math.max(Math.max(...room.size) * 0.75 + 4, (spacing * count) / (2 * Math.PI)),
          count,
        };
        parentRoom.position = room.position.slice();
        parentRoom.count = 1;
      }
    }
    if (rel.straddle) {
      room.straddle = parentRoom.id;
      room.count = 2;
      room.position = parentRoom.position.slice();
    }
    if (rel.elongate) room.size[2] *= 2.4;
    if (rel.void) {
      room.voidRoom = true;
      room.material.opacity = 0.16;
      room.material.emissive = 0;
      room.hollow = true;
    }
    if (rel.link) {
      links.push({ from: parentRoom.id, to: room.id, kind: rel.link, relation: node.relation });
    }
    return room;
  };

  // Subject and object are placed by the verb's topology; everything else hangs
  // off whichever head the parser attached it to.
  const walk = (node, parentRoom, depth) => {
    let room = parentRoom;
    if (node.kind === 'entity') {
      if (node.relation === 'subject') room = makeRoom(node, topo.subject, depth);
      else if (node.relation === 'object' && depth <= 1) room = makeRoom(node, topo.object, depth);
      else room = place(node, parentRoom, depth);
    }
    for (const child of node.children) walk(child, room, depth + 1);
    return room;
  };

  const anchor = {
    id: 'hall',
    position: [0, 0, 0],
    size: [HALL_RADIUS * 1.2, 6, HALL_RADIUS * 1.2],
  };
  for (const child of parsed.root.children) walk(child, anchor, 1);

  // Subject and object are joined by the predicate itself: the hall's spine.
  const subjectRoom = rooms.find((r) => r.relation === 'subject');
  const objectRoom = rooms.find((r) => r.relation === 'object');
  if (subjectRoom && objectRoom) {
    links.push({
      from: subjectRoom.id,
      to: objectRoom.id,
      kind: parsed.root.verbClass === 'transfer' ? 'bridge' : 'corridor',
      relation: 'predicate',
      label: parsed.root.word,
    });
  }

  const spread = rooms.length ? Math.max(...rooms.map((r) => Math.hypot(r.position[0], r.position[2]) + Math.max(...r.size))) : HALL_RADIUS;

  return {
    text: parsed.text,
    seed: parsed.seed,
    verb: parsed.root.word,
    verbClass: parsed.root.verbClass,
    negated: parsed.root.negated,
    topology: topo,
    floor: topo.floor,
    rooms,
    links,
    path,
    scene: { ...scene, extent: Math.max(spread, HALL_RADIUS) },
    unknown: parsed.scene.unknown,
  };
}

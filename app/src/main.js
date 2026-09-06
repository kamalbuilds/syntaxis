import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { parse } from './grammar/parse.js';
import { planFrom } from './grammar/architecture.js';
import { buildWorld } from './world/build.js';
import Player from './world/player.js';
import Reader from './world/agent.js';

const EXAMPLES = [
  'a child carries one gold lantern through the ruined cathedral',
  'the old library sinks under a black river',
  'twelve silent columns stand around a black tower',
  'the machine builds a bridge over the frozen lake',
  'memory burns quietly inside a vast white cathedral',
  'no ship arrives at the distant island',
];

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 900);

// Sky is a single dome with a hand-mixed gradient rather than an HDRI download,
// so the whole build stays under a second on a cold cache.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(420, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1d2c40) },
      horizon: { value: new THREE.Color(0x93a1ad) },
      base: { value: new THREE.Color(0x272219) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = normalize(wp.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 base;
      varying float vH;
      void main() {
        float h = vH;
        vec3 c = h > 0.0
          ? mix(horizon, top, pow(h, 0.55))
          : mix(horizon, base, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
sky.frustumCulled = false;
scene.add(sky);

const key = new THREE.DirectionalLight(0xfff0d6, 3.1);
key.position.set(28, 46, -22);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 190;
key.shadow.camera.left = -70;
key.shadow.camera.right = 70;
key.shadow.camera.top = 70;
key.shadow.camera.bottom = -70;
key.shadow.bias = -0.0009;
key.shadow.normalBias = 0.035;
scene.add(key, key.target);

scene.add(new THREE.HemisphereLight(0xaec6d8, 0x5b5348, 2.0));
const rim = new THREE.DirectionalLight(0x8fb4cc, 1.2);
rim.position.set(-34, 18, 30);
scene.add(rim);

const player = new Player(camera, canvas);
scene.add(player.rig);

const reader = new Reader(scene);

let world = null;
let plan = null;

const els = {
  veil: document.getElementById('veil'),
  enter: document.getElementById('enter'),
  form: document.getElementById('composer'),
  input: document.getElementById('sentence'),
  tokens: document.getElementById('tokens'),
  planList: document.getElementById('plan'),
  unknown: document.getElementById('unknown'),
  caption: document.getElementById('caption'),
  examples: document.getElementById('examples'),
  readout: document.getElementById('readout'),
  toggle: document.getElementById('toggle-readout'),
  share: document.getElementById('share'),
  vrSlot: document.getElementById('vr-slot'),
};

function disposeWorld() {
  if (!world) return;
  scene.remove(world.root);
  world.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
  world = null;
}

function renderReadout(parsed, built) {
  els.tokens.replaceChildren(...parsed.tagged
    .filter((t) => t.pos !== 'PUNCT')
    .map((t) => {
      const el = document.createElement('span');
      el.className = `tok pos-${t.pos}${t.known ? '' : ' guess'}`;
      el.innerHTML = `<b>${t.word}</b><i>${t.pos}</i>`;
      return el;
    }));

  const relations = built.rooms
    .filter((r) => r.relation !== 'subject' && r.relation !== 'object')
    .map((r) => `${r.word} → ${r.relation}`);

  const rows = [
    ['verb', `${built.verb} (${built.verbClass})`],
    ['topology', built.topology.name],
    ['rooms', String(built.rooms.length)],
    ['links', String(built.links.length)],
    ['relations', relations.length ? relations.join(', ') : 'subject · object only'],
    ['seed', built.seed.toString(16)],
  ];
  els.planList.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    return [dt, dd];
  }));

  els.unknown.textContent = built.unknown.length
    ? `outside lexicon, built as generic volume: ${[...new Set(built.unknown)].join(', ')}`
    : '';
}

let captionTimer = 0;
function caption(text) {
  els.caption.textContent = text;
  els.caption.classList.add('on');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => els.caption.classList.remove('on'), 3600);
}

reader.onArrive = (wp, i, total) => {
  const adj = wp.adjectives.length ? `${wp.adjectives.join(' ')} ` : '';
  caption(`${String(i + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}  ${adj}${wp.word} — ${wp.relation}`);
};

function build(sentence) {
  const text = sentence.trim();
  if (!text) return;

  const parsed = parse(text);
  plan = planFrom(parsed);

  disposeWorld();
  world = buildWorld(plan);
  scene.add(world.root);

  player.setWorld(world);

  // Open on the whole build rather than inside it: stand back along +Z from the
  // centroid by enough to fit the widest volume in frame, then face it.
  const centre = new THREE.Vector3();
  for (const r of plan.rooms) centre.add(new THREE.Vector3(r.position[0], 0, r.position[2]));
  if (plan.rooms.length) centre.divideScalar(plan.rooms.length);
  const reach = plan.rooms.reduce(
    (m, r) => Math.max(
      m,
      Math.hypot(r.position[0] - centre.x, r.position[2] - centre.z)
        + Math.max(...r.size) * 0.6
        + (r.ring ? r.ring.radius : 0),
    ),
    8,
  );
  const standoff = THREE.MathUtils.clamp(reach * 1.45 + 6, 16, 66);

  // Some topologies cut a chasm through the middle of the site, so a fixed
  // +Z standoff can drop the viewer into it. Try a ring of vantage points and
  // take the one standing on the highest ground.
  let best = null;
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const x = centre.x + Math.sin(a) * standoff;
    const z = centre.z + Math.cos(a) * standoff;
    const height = world.sample(x, z);
    const facingBonus = Math.cos(a) * 0.35;
    const score = height + facingBonus;
    if (!best || score > best.score) best = { x, z, score };
  }
  player.teleport(best.x, best.z);
  player.yaw = Math.atan2(-(centre.x - best.x), -(centre.z - best.z));

  // Aim at the middle of the build rather than the horizon, so the opening shot
  // is not half empty ground.
  const midY = plan.rooms.length
    ? plan.rooms.reduce((sum, r) => sum + r.position[1] + r.size[1] * 0.5, 0) / plan.rooms.length
    : 2;
  player.pitch = THREE.MathUtils.clamp(Math.atan2(midY - 1.68, standoff), -0.25, 0.5);

  reader.load(world.waypoints, plan.scene.agentSpeed);

  renderer.toneMappingExposure = THREE.MathUtils.clamp(plan.scene.exposure * 1.08, 0.5, 1.8);
  scene.fog = new THREE.FogExp2(0x93a1ad, 0.0036 * plan.scene.fog);
  key.target.position.set(0, 0, 0);

  els.input.value = text;
  renderReadout(parsed, plan);
  history.replaceState(null, '', `#${encodeURIComponent(text)}`);
  caption(`${plan.topology.name} · ${plan.rooms.length} volumes`);
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  build(els.input.value);
  els.input.blur();
});

els.examples.replaceChildren(...EXAMPLES.map((ex) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = ex;
  b.addEventListener('click', () => build(ex));
  return b;
}));

els.toggle.addEventListener('click', () => {
  const collapsed = els.readout.classList.toggle('collapsed');
  els.toggle.textContent = collapsed ? 'show' : 'hide';
});

els.share.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    els.share.textContent = 'copied';
  } catch {
    els.share.textContent = location.href;
  }
  setTimeout(() => { els.share.textContent = 'Copy link'; }, 1800);
});

els.enter.addEventListener('click', () => {
  els.veil.classList.add('gone');
  player.requestLock();
});

canvas.addEventListener('click', () => {
  if (!els.veil.classList.contains('gone')) return;
  player.requestLock();
});

els.vrSlot.appendChild(VRButton.createButton(renderer));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addEventListener('hashchange', () => {
  const text = decodeURIComponent(location.hash.slice(1));
  if (text && text !== plan?.text) build(text);
});

// A public handle, so the build can be driven from the console or a script
// rather than only by typing into the field.
window.syntaxis = {
  build,
  reader,
  player,
  renderer,
  get plan() { return plan; },
  frames: 0,
};

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  window.syntaxis.frames += 1;
  player.update(dt, renderer.xr.getSession());
  reader.update(dt, elapsed);
  sky.position.copy(player.rig.position);
  key.target.position.set(player.rig.position.x, 0, player.rig.position.z);
  key.position.set(player.rig.position.x + 28, 46, player.rig.position.z - 22);
  renderer.render(scene, camera);
});

const initial = decodeURIComponent(location.hash.slice(1)) || EXAMPLES[0];
build(initial);

import assert from 'node:assert/strict';
import { parse } from '../src/grammar/parse.js';
import { planFrom } from '../src/grammar/architecture.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

const build = (s) => planFrom(parse(s));
const room = (plan, word) => plan.rooms.find((r) => r.word === word);

// A preposition must move geometry, not just label it. Each of these compares
// the child's world position against its head, so a mapping that silently
// stopped working fails here instead of looking fine in a screenshot.

check('on puts the supporting volume underneath the figure', () => {
  const plan = build('the lamp rests on a stone table');
  const figure = room(plan, 'lamp');
  const ground = room(plan, 'table');
  assert.ok(figure && ground, `both volumes exist, got ${plan.rooms.map((r) => r.word).join(', ')}`);
  assert.equal(ground.relation, 'stack');
  assert.ok(ground.position[1] < figure.position[1], `table y ${ground.position[1]} must sit below lamp y ${figure.position[1]}`);
  assert.ok(ground.adjectives.includes('stone'), 'the noun modifier reached the material');
});

check('under puts the figure beneath the landmark', () => {
  const plan = build('the library sinks under a black river');
  const above = plan.rooms.find((r) => r.relation === 'sink');
  assert.ok(above, 'a sink relation was produced');
  assert.equal(above.word, 'river', 'the river is the thing being under-ed');
  const figure = plan.rooms.find((r) => r.id !== above.id);
  assert.ok(above.position[1] > figure.position[1], `river y ${above.position[1]} must be above library y ${figure.position[1]}`);
  assert.ok(above.material.color === 0x121214 || above.adjectives.includes('black'), 'the adjective reached the river');
});

check('through bores the volume passed through and builds a tunnel', () => {
  const plan = build('a child walks through the ancient wall');
  const bored = plan.rooms.find((r) => r.bored);
  assert.ok(bored, 'the pierced volume is marked bored');
  assert.equal(bored.word, 'wall', 'the wall is what gets the hole, not the walker');
  assert.equal(bored.form, 'shell', 'a bored volume must be enterable');
  assert.ok(plan.links.some((l) => l.kind === 'tunnel'), 'a tunnel link was emitted');
});

check('around raises a ring of instances', () => {
  const plan = build('the tower stands around a garden');
  const ringed = plan.rooms.find((r) => r.ring);
  assert.ok(ringed, 'an encircle relation produced a ring');
  assert.ok(ringed.ring.count >= 6, `ring count ${ringed.ring.count} must be at least 6`);
});

check('inside grows a container the figure actually fits in', () => {
  const plan = build('a fire burns inside the cathedral');
  const container = plan.rooms.find((r) => r.relation === 'nest');
  assert.ok(container, 'a nest relation was produced');
  assert.equal(container.word, 'cathedral', 'the container is the object of "inside"');
  assert.ok(container.hollow && container.form === 'shell', 'the container is opened so it can be entered');
  const figure = plan.rooms.find((r) => r.id !== container.id);
  assert.ok(
    Math.max(...figure.size) < Math.min(...container.size),
    `figure ${Math.max(...figure.size).toFixed(1)} must fit inside container ${Math.min(...container.size).toFixed(1)}`,
  );
  const floor = container.position[1] - container.size[1] / 2;
  assert.ok(figure.position[1] - figure.size[1] / 2 >= floor - 0.01, 'the figure rests on the container floor');
});

check('without renders an absent volume rather than a solid one', () => {
  const plan = build('the city stands without light');
  const absent = plan.rooms.find((r) => r.voidRoom);
  assert.ok(absent, 'an absent relation produced a void volume');
  assert.ok(absent.material.opacity < 0.3, `void opacity ${absent.material.opacity} must read as absent`);
});

// Verb class must change the ground, not only the caption.
check('verb class selects a distinct topology', () => {
  const seen = new Map();
  for (const s of [
    'a man walks to the river',
    'a man gives the key to the child',
    'a man watches the distant tower',
    'a man builds a house',
    'a man burns the house',
    'a man says a name',
    'a man is a house',
  ]) {
    const plan = build(s);
    seen.set(plan.verbClass, plan.topology.name);
  }
  assert.equal(seen.size, 7, `expected 7 distinct verb classes, got ${[...seen.keys()].join(', ')}`);
  assert.equal(new Set(seen.values()).size, 7, 'each class must map to its own topology');
  assert.notEqual(seen.get('motion'), seen.get('destruction'));
});

check('floor profile differs between motion and destruction', () => {
  assert.notEqual(build('a man walks to the river').floor, build('a man burns the house').floor);
});

// Adjectives must reach the material and the volume.
check('adjectives change colour and size', () => {
  const plain = build('a house stands');
  const gold = build('a gold house stands');
  const huge = build('a vast house stands');
  assert.notEqual(room(gold, 'house').material.color, room(plain, 'house').material.color);
  assert.ok(room(huge, 'house').size[0] > room(plain, 'house').size[0] * 1.5, 'vast must enlarge the volume');
});

check('counts instance the volume', () => {
  const plan = build('the tower stands beside twelve silent columns');
  const columns = room(plan, 'columns');
  assert.ok(columns, 'the plural noun resolved to a volume');
  assert.equal(columns.count, 12, `expected 12 instances, got ${columns.count}`);
});

check('negation makes the volume read as absent', () => {
  const plan = build('no ship arrives at the island');
  const negated = plan.rooms.find((r) => r.negated);
  assert.ok(negated, 'the negated noun is marked');
  assert.ok(negated.material.opacity < 0.3, 'a negated volume is not built solid');
});

check('adverbs modify the scene rather than a room', () => {
  const quiet = build('a man walks quietly to the river');
  const quick = build('a man walks quickly to the river');
  assert.ok(quiet.scene.fog > quick.scene.fog, 'quietly must thicken the air relative to quickly');
  assert.ok(quick.scene.agentSpeed > quiet.scene.agentSpeed, 'quickly must speed the reader up');
});

// The permalink promise: same sentence, same building, forever.
check('the same sentence produces an identical plan', () => {
  const a = JSON.stringify(build('a child carries one gold lantern through the ruined cathedral'));
  const b = JSON.stringify(build('a child carries one gold lantern through the ruined cathedral'));
  assert.equal(a, b, 'two builds of one sentence must be byte-identical');
});

check('different sentences produce different seeds and plans', () => {
  const a = build('the tower falls');
  const b = build('the tower rises');
  assert.notEqual(a.seed, b.seed);
});

// The blind spot must be visible, not silent.
check('out-of-lexicon nouns are reported', () => {
  const plan = build('the zorblat sits beside a river');
  assert.ok(plan.unknown.includes('zorblat'), `unknown list was ${JSON.stringify(plan.unknown)}`);
  assert.ok(room(plan, 'zorblat'), 'the unknown noun still gets a generic volume');
});

check('every room lands in the reader path exactly once', () => {
  const plan = build('a child carries one gold lantern through the ruined cathedral');
  assert.equal(plan.path.length, plan.rooms.length);
  assert.equal(new Set(plan.path).size, plan.rooms.length);
});

check('a bare noun phrase still builds something walkable', () => {
  const plan = build('rain');
  assert.ok(plan.rooms.length >= 1, 'a one-word input still produces a volume');
  assert.ok(plan.topology.name.length > 0);
});

check('empty-ish input does not throw', () => {
  const plan = build('the');
  assert.ok(Array.isArray(plan.rooms));
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.error(`FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
